// Actual app navigation and Web controls, using only synthetic API responses.
// Builds into a disposable directory and never opens live accounts or app data.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
if(!process.versions.electron){
  const {spawn}=require('node:child_process'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(require('electron'),[__filename],{env,windowsHide:true,stdio:'inherit'});
  child.on('error',error=>{console.error(error);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code;});
}else{
  const {app,BrowserWindow,protocol}=require('electron');
  const {appAsset,APP_HEADERS}=require('../electron/security');
  const root=path.resolve(__dirname,'..'),work=fs.mkdtempSync(path.join(os.tmpdir(),'law-web-navigation-'));
  app.setPath('userData',path.join(work,'profile'));app.disableHardwareAcceleration();
  protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
  let win;const checks=[],sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const timeout=setTimeout(()=>{console.error('Web navigation QA timed out',work);app.exit(1);},120000);
  app.whenReady().then(async()=>{
    const {build}=await import('vite'),react=(await import('@vitejs/plugin-react')).default;
    await build({configFile:false,root,base:'./',plugins:[react()],logLevel:'error',worker:{format:'es'},assetsInclude:['**/*.bin'],
      define:{__LAW_BUILD_INFO__:JSON.stringify({build_id:'web-navigation-diagnostic'})},
      build:{outDir:path.join(work,'dist'),emptyOutDir:true,rollupOptions:{input:path.join(root,'tests/fixtures/workspaceControls.html')}}});
    protocol.handle('app',request=>{const file=appAsset(path.join(work,'dist'),request.url);return new Response(fs.readFileSync(file),{headers:{...APP_HEADERS,
      'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm'}[path.extname(file)]||'application/octet-stream')}});});
    win=new BrowserWindow({show:false,width:1380,height:950,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    const js=code=>win.webContents.executeJavaScript(code);
    const until=async(code,label)=>{for(let i=0;i<200;i++){if(await js(code))return;await sleep(40);}throw Error('Timed out: '+label);};
    const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const route=async id=>{await click(`[data-sidebar-route="${id}"]`);await until(`!!document.querySelector('[data-capture-tab="${id}"]:not([hidden])')`,id);};
    const input=(selector,value)=>js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const mode=label=>click(`.web-mode-tabs [role="tab"][aria-controls$="panel-${label}"]`);
    const key=async keyCode=>{win.webContents.sendInputEvent({type:'keyDown',keyCode});win.webContents.sendInputEvent({type:'keyUp',keyCode});await sleep(60);};
    const capture=async name=>{const [width,height]=win.getSize();win.setSize(width+1,height);await sleep(80);win.setSize(width,height);win.webContents.invalidate();await sleep(180);
      fs.writeFileSync(path.join(work,name),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());};
    await win.loadURL('app://local/tests/fixtures/workspaceControls.html');
    await until("!!document.querySelector('[aria-controls=\"sidebar-group-web\"]')",'Web group');
    await click('[aria-controls="sidebar-group-web"]');
    assert.deepEqual(await js("[...document.querySelectorAll('#sidebar-group-web [data-sidebar-route]')].map(b=>b.dataset.sidebarRoute)"),['browser','web-system','reels-analyzer']);
    assert.equal(await js("document.querySelectorAll('#sidebar-group-workspace [data-sidebar-route=\"web-system\"],#sidebar-group-workspace [data-sidebar-route=\"reels-analyzer\"],#sidebar-group-viewers [data-sidebar-route=\"browser\"]').length"),0);
    checks.push('One Web group contains Browser, Research & Sources and Reels Analyzer, with no duplicate destinations');
    for(const id of ['browser','web-system','reels-analyzer']){
      await route(id);await click('.workspace-navigation .workspace-info-button');
      assert(await js("document.querySelector('.workspace-navigation .workspace-info-dialog').open"));
      const help=await js("document.querySelector('.workspace-navigation .workspace-info-dialog').innerText");
      for(const term of ['Web navigation','Import page','browser cookies'])assert(help.includes(term),`${id}: ${term}`);
      await click('.workspace-navigation .workspace-info-heading button');
    }
    checks.push('Each Web information bubble opens its current navigation, importer and account-boundary guide');
    await route('web-system');await until("document.querySelectorAll('.web-mode-tabs [role=tab]').length===4",'four modes');
    await js("document.querySelector('.web-mode-tabs [aria-selected=true]').focus()");await key('Right');
    assert.equal(await js("document.activeElement.textContent"),'Live research');
    assert(await js("document.activeElement.getAttribute('aria-selected')==='true'"));
    await input('[aria-label="Research question"]','Keep this research draft');
    await js("document.querySelector('.web-mode-tabs [aria-selected=true]').focus()");await key('End');
    assert.equal(await js('document.activeElement.textContent'),'Import page');
    await until("!!document.querySelector('.web-access input[type=url]')",'importer');
    const ids=await js("[...document.querySelectorAll('.web-access input[type=url]')].map(e=>e.id)");assert.equal(new Set(ids).size,ids.length);
    await input('[data-capture-tab="web-system"] .web-access input[type=url]','https://source.example/article');
    await js("document.querySelector('.web-mode-tabs [aria-selected=true]').focus()");await key('Home');
    assert.equal(await js('document.activeElement.textContent'),'Search & preview');
    await key('Left');assert.equal(await js('document.activeElement.textContent'),'Import page');
    assert.equal(await js("document.querySelectorAll('.web-mode-tabs [tabindex=\"0\"]').length"),1);
    assert.equal(await js("document.querySelectorAll('.web-workspace>[role=tabpanel]:not([hidden])').length"),1);
    await mode('research');assert.equal(await js("document.querySelector('[aria-label=\"Research question\"]').value"),'Keep this research draft');
    await route('reels-analyzer');assert.equal(await js("document.querySelectorAll('.reels-step').length"),2);
    assert(await js("!document.querySelector('.reels-maintenance').open"));
    await route('web-system');assert.equal(await js("document.querySelector('[aria-label=\"Research question\"]').value"),'Keep this research draft');
    checks.push('Arrow, Home and End keys move selection and focus; research and import drafts survive mode and workspace changes');
    await mode('search');await capture('web-navigation-desktop.png');
    await route('reels-analyzer');await capture('web-reels-desktop.png');
    win.setSize(420,920);await sleep(160);
    assert(await js('document.documentElement.scrollWidth<=innerWidth'));
    assert(await js("(()=>{const p=document.querySelector('[data-capture-tab=\"reels-analyzer\"]');return p.scrollWidth<=p.clientWidth+1})()"));
    await capture('web-reels-narrow.png');
    await click('[aria-label="Show navigation"]');await until("document.querySelector('[aria-label=\"App navigation\"]').getAttribute('aria-modal')==='true'",'navigation drawer');
    await route('web-system');await mode('import');
    assert(await js('document.documentElement.scrollWidth<=innerWidth'));
    assert(await js("(()=>{const p=document.querySelector('[data-capture-tab=\"web-system\"]');return p.scrollWidth<=p.clientWidth+1})()"));
    await capture('web-import-narrow.png');
    assert.equal(await js("document.querySelector('[data-capture-tab=\"web-system\"] .web-access input[type=url]').value"),'https://source.example/article');
    checks.push('Web navigation drawer, Reels setup and importer fit a 420px viewport without horizontal overflow');
    assert.deepEqual(await js('window.workspaceControlsQA.errors'),[]);
    fs.writeFileSync(path.join(work,'report.json'),JSON.stringify({ok:true,checks},null,2));
    console.log(JSON.stringify({ok:true,checks,artifacts:work},null,2));
  }).catch(async error=>{console.error(error);if(win){fs.writeFileSync(path.join(work,'failure.txt'),await win.webContents.executeJavaScript('document.body.innerText'));fs.writeFileSync(path.join(work,'failure.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());}console.error('Artifacts:',work);process.exitCode=1;})
    .finally(()=>{clearTimeout(timeout);win?.destroy();app.exit(process.exitCode||0);});
}
