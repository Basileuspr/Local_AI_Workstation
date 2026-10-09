// Run the workspaceControls Vite fixture first (default URL below), then run
// node scripts/qa-workspace-coexistence.cjs. This uses a disposable profile,
// generated muted video and simulated inference; it never connects to live data.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
if(!process.versions.electron) {
  const {spawn,spawnSync}=require('node:child_process');
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'law-workspace-coexistence-'));
  const encoded=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24',
    '-t','4','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-threads','1','-movflags','+faststart',path.join(work,'clip.mp4')],
    {windowsHide:true,encoding:'utf8'});
  if(encoded.status!==0)throw Error(encoded.stderr||encoded.error?.message||'Video fixture encoding failed');
  const env={...process.env,LAW_COEXISTENCE_WORK:work};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(require('electron'),[__filename],{env,windowsHide:true,stdio:'inherit'});
  child.on('error',error=>{console.error(error);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code;});
} else {
  const {app,BrowserWindow,WebContentsView,session,ipcMain}=require('electron'),http=require('node:http');
  const {createViewerBrowser}=require('../electron/viewerBrowser');
  const {configureRendering}=require('../electron/windowRendering');
  const work=process.env.LAW_COEXISTENCE_WORK,host=process.env.LAW_COEXISTENCE_URL||'http://127.0.0.1:5299';
  app.setPath('userData',path.join(work,'profile'));configureRendering({app});
  app.commandLine.appendSwitch('host-resolver-rules','MAP coexistence.example.com 127.0.0.1');
  app.commandLine.appendSwitch('no-proxy-server');
  app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
  let win,browser,server,view;const checks=[];
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function until(fn,label){for(let i=0;i<150;i++){if(await fn())return;await sleep(100);}throw Error('Timed out: '+label);}
  const watchdog=setTimeout(()=>{console.error('Coexistence QA exceeded two minutes');app.exit(1);},120000);
  app.whenReady().then(async()=>{
    const bytes=fs.readFileSync(path.join(work,'clip.mp4'));
    server=http.createServer((req,res)=>{
      if(req.url==='/clip.mp4') {
        const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range||''),start=range?Number(range[1]):0,end=range?.[2]?Number(range[2]):bytes.length-1;
        res.writeHead(range?206:200,{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1,
          ...(range?{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}:{})});return res.end(bytes.subarray(start,end+1));
      }
      res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Coexistence video</title><style>body{margin:0;background:#142434;color:white}video{width:100%}</style><h1>Owned video fixture</h1><video controls muted loop src="/clip.mp4"></video>');
    });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const site=`http://coexistence.example.com:${server.address().port}`;
    win=new BrowserWindow({show:false,skipTaskbar:true,title:'Workspace coexistence QA - sample data',width:1440,height:900,webPreferences:{preload:path.join(__dirname,'../electron/preload.js'),
      sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    // A hidden native window intentionally suspends video. Show only this
    // disposable sample window without taking the user's focus.
    win.showInactive();
    win.webContents.on('console-message',event=>{if(['error','warning'].includes(event.level))console.log('Renderer:',event.message);});
    const TestView=class extends WebContentsView{constructor(options){super(options);view=this;}};
    browser=createViewerBrowser({WebContentsView:TestView,session,getWindow:()=>win,profileDirectory:path.join(work,'browser'),
      workflowDirectory:path.join(work,'workflows'),dialog:{showMessageBox:async()=>({response:1})},
      allowRequest:url=>{try{return new URL(url).origin===site;}catch{return false;}}});
    const trusted=event=>event.sender===win.webContents && event.senderFrame===win.webContents.mainFrame && event.senderFrame.url.startsWith(host+'/');
    ipcMain.on('app:connection',event=>{event.returnValue=trusted(event)?{base:'http://127.0.0.1:1',token:''}:null;});
    ipcMain.handle('app:capabilities',()=>({features:{media_manager:{available:false,detail:'QA only'}}}));
    ipcMain.handle('app:startup-status',()=>({state:'ready'}));ipcMain.on('documents:dirty',()=>{});
    for(const name of ['media-manager:place','sound-mixer:configure','linked-content:place','linked-content:close','playback-capture:cancel'])ipcMain.handle(name,()=>({}));
    ipcMain.handle('function-workflows:state',()=>null);
    ipcMain.handle('maintenance:import-status',()=>({active:false}));
    ipcMain.handle('github-publication:state',()=>({running:false}));
    ipcMain.handle('reels:state',()=>({batches:[],summaries:[],active:null}));
    for(const action of ['start','state','place','navigate','command','profiles','createTab','selectTab','closeTab','shortcut','setTabSettings'])
      ipcMain.handle(`viewer-browser:${action}`,async(event,value)=>trusted(event)?browser[action](value):{error:'Desktop access required.'});
    const js=code=>win.webContents.executeJavaScript(code);
    const settled=()=>js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const navigate=async tab=>{await js(`document.querySelector('[data-sidebar-route="${tab}"]').click()`);await settled();};
    const select=(selector,value)=>js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await win.loadURL(`${host}/tests/fixtures/workspaceControls.html?coexistence=1`);
    await until(()=>js("!!document.querySelector('[data-sidebar-route=browser]')"),'app mount');
    await navigate('browser');await until(()=>browser.state().ready,'browser start');await browser.navigate(site);
    await until(()=>!browser.state().loading,'video page');const original=view.webContents;
    await until(()=>view.getVisible(),'video surface shown');
    original.setBackgroundThrottling(false);
    await until(()=>original.executeJavaScript("document.querySelector('video')?.readyState>=2"),'video decode');
    await original.executeJavaScript("document.querySelector('video').play()",true);
    await until(()=>original.executeJavaScript("document.querySelector('video').currentTime>.2"),'video playback');
    await navigate('generate');await select('[aria-label="Side pane workspace"]','browser');
    await until(()=>view.getVisible(),'native browser beside Generate');
    assert.equal(view.webContents,original,'uses the existing browser renderer');
    await select('[aria-label="Image model"]','preview-image');
    await js("(()=>{const e=document.querySelector('#image-studio textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Keep this prompt while watching the video');e.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await until(()=>js("!document.querySelector('.image-generate-btn').disabled"),'Generate enabled');
    await js("document.querySelector('.image-generate-btn').click()");
    await until(()=>js("!!document.querySelector('[aria-label=\"Image denoising steps\"]')"),'generation progress');
    await js('window.workspaceCoexistenceQA.advance(2)');
    await until(()=>js("document.querySelector('[aria-label=\"Image denoising steps\"]').value===2"),'progress while browser stays visible');
    assert(view.getVisible());await original.executeJavaScript("document.querySelector('video').pause()");
    assert(await original.executeJavaScript("document.querySelector('video').paused"));await original.executeJavaScript("document.querySelector('video').play()");
    checks.push('Generation progresses with the original Browser visible and video pause/play available');
    async function boundsCheck(label) {
      await settled();await sleep(150);
      const ui=await js(`(()=>{const box=id=>{const n=document.querySelector('[data-capture-tab="'+id+'"]'),r=n.getBoundingClientRect();return {hidden:n.hidden,x:r.x,y:r.y,width:r.width,height:r.height};};return {main:box('generate'),side:box('browser'),errors:window.workspaceControlsQA.errors};})()`);
      assert(!ui.main.hidden&&!ui.side.hidden,label+' keeps both panes active');assert.deepEqual(ui.errors,[]);
      if(view.getVisible()) {
        const b=view.getBounds(),side=ui.side;
        assert(b.x>=side.x-1&&b.x+b.width<=side.x+side.width+1,label+' browser stays within its pane horizontally');
        assert(b.y>=side.y-1&&b.y+b.height<=side.y+side.height+1,label+' browser stays within its pane vertically');
        const main=ui.main;assert(b.x>=main.x+main.width-1||b.x+b.width<=main.x+1||b.y>=main.y+main.height-1||b.y+b.height<=main.y+1,label+' never covers Generate');
      }
      checks.push(label);
    }
    await boundsCheck('Wide layout');
    const divider='[aria-label="Resize Generate Images and Browser"]';
    const beforeSize=await js(`Number(document.querySelector('${divider}').getAttribute('aria-valuenow'))`);
    await js(`document.querySelector('${divider}').focus()`);
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Right'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Right'});
    await until(()=>js(`Number(document.querySelector('${divider}').getAttribute('aria-valuenow'))>${beforeSize}`),'keyboard pane resize');
    await boundsCheck('Resized layout');
    const savedSize=await js("JSON.parse(localStorage.getItem('local-ai-workstation-layout-v1')).splits['workspace:generate'].horizontal");
    assert(savedSize>50,'tool split size saved independently');
    const originalTab=browser.state().activeTabId;
    await js("[...document.querySelectorAll('.viewer-browser button')].find(n=>n.textContent.trim()==='+ New tab').click()");
    await until(()=>browser.state().activeTabId!==originalTab,'new browser tab while generating');
    await js("document.querySelector('.browser-tabs [role=tab]').click()");
    await until(()=>browser.state().activeTabId===originalTab&&browser.findContents()===original,'original browser tab restored');
    view=win.contentView.children.find(candidate=>candidate.webContents===original);
    assert(await original.executeJavaScript("document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames>0"),'native video decoded frames');
    fs.writeFileSync(path.join(work,'generate-browser.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
    fs.writeFileSync(path.join(work,'browser-video.png'),(await original.capturePage()).toPNG());
    for(const size of [[740,720],[390,720]]) {
      win.setContentSize(...size);await boundsCheck('Stacked '+size.join('x'));
      await js("(()=>{const n=document.getElementById('app-workspace-panes');n.scrollTop=n.scrollHeight;const b=document.querySelector('.viewer-browser');b.scrollTop=b.scrollHeight;})()");
      await boundsCheck('Scrolled '+size.join('x'));
      await js("document.getElementById('app-workspace-panes').scrollTop=0");
    }
    win.setContentSize(1440,900);await settled();await js("document.querySelector('.viewer-browser').scrollTop=0");
    for(const tab of ['markdown','audio','document-editor','reels-analyzer']) {
      await navigate(tab);await select('[aria-label="Side pane workspace"]','browser');
      await until(()=>view.getVisible(),'Browser paired with '+tab);
      assert.equal(view.webContents,original);checks.push('Browser paired with '+tab);
      if(tab==='reels-analyzer') {
        assert(await js("document.querySelector('[data-capture-tab=\"reels-analyzer\"] .viewer-browser [role=status]')?.textContent.includes('another visible workspace')"),'secondary account browser points to the visible Browser instead of hiding it');
        win.webContents.send('viewer-browser:address');
        await until(()=>js("document.activeElement?.closest('[data-capture-tab]')?.dataset.captureTab==='browser'"),'address shortcut focuses the Browser that owns the native page');
      }
    }
    await navigate('generate');await until(()=>view.getVisible(),'restored Generate pair');
    assert.equal(await js(`Number(document.querySelector('${divider}').getAttribute('aria-valuenow'))`),Math.round(savedSize),'saved Generate divider restored');
    assert.equal(await js("document.querySelector('#image-studio textarea').value"),'Keep this prompt while watching the video');
    assert.equal(await js("document.querySelector('[aria-label=\"Image denoising steps\"]').value"),2);
    const options=await js("[...document.querySelector('[aria-label=\"Side pane workspace\"]').options].map(n=>n.value)");
    assert(options.includes('chats')&&options.includes('media-manager')&&!options.includes('generate'));
    await js("document.querySelector('[aria-label=\"Generate information\"]').click()");
    await until(()=>!view.getVisible(),'information dialog hides native browser');
    await js("document.querySelector('[aria-label=\"Close Generate information\"]').click()");
    await until(()=>view.getVisible(),'browser restored after information dialog');
    await js("document.querySelector('[aria-label=\"Close side pane\"]').click()");
    await until(()=>!view.getVisible(),'unpin hides native browser');assert(!original.isDestroyed());
    assert.deepEqual(await js('window.workspaceCoexistenceQA.stopped'),[],'tab changes and unpin never cancel image generation');
    checks.push('Pin choices cover other workspaces; drafts, generation, browser identity and dialog boundaries survive navigation/unpin');
    fs.writeFileSync(path.join(work,'result.json'),JSON.stringify({passed:true,checks,simulatedInference:true,work},null,2));
    console.log(JSON.stringify({passed:true,checks:checks.length,work}));
    clearTimeout(watchdog);await browser.dispose();win.destroy();server.close();app.quit();
  }).catch(async error=>{console.error(error.stack||error);clearTimeout(watchdog);
    if(win&&!win.isDestroyed()) {
      console.error(await win.webContents.executeJavaScript('JSON.stringify({text:document.body.innerText.slice(0,1600),errors:window.workspaceControlsQA?.errors})').catch(()=>''));
      console.error(await win.webContents.executeJavaScript(`JSON.stringify({viewport:[innerWidth,innerHeight],surfaces:[...document.querySelectorAll('.browser-surface')].map(n=>{
        const rows=[];for(let p=n;p;p=p.parentElement){const r=p.getBoundingClientRect(),s=getComputedStyle(p);rows.push({tag:p.tagName,cls:p.className,size:[p.clientWidth,p.clientHeight],box:[r.x,r.y,r.width,r.height],overflow:[s.overflowX,s.overflowY]});}return rows;})})`).catch(()=>''));
      fs.writeFileSync(path.join(work,'failure.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());win.destroy();
    }
    server?.close();app.exit(1);
  });
}
