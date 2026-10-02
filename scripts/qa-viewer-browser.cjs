// Hidden Electron QA against an owned fixture. Does not use the user's browser,
// profile, backend, or internet. Only this test injects a loopback fixture policy.
// Build tests/fixtures/viewerBrowser.html into tmp/viewer-browser-qa with Vite first.
// Set LAW_BROWSER_PUBLIC_QA=1 to additionally test example.com with the production policy.
const {app,BrowserWindow,WebContentsView,session,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const assert=require('node:assert/strict');
const {createViewerBrowser}=require('../electron/viewerBrowser');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'law-browser-qa-'));
app.setPath('userData',path.join(work,'profile'));
app.commandLine.appendSwitch('host-resolver-rules','MAP browser.example.com 127.0.0.1');
app.commandLine.appendSwitch('no-proxy-server');
let win,browser,vite,server,remote;
const checks=[];
const timeout=setTimeout(()=>{console.error('QA exceeded 90 seconds');app.exit(1);},90000);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<160;i++){if(await fn())return;await sleep(100);}throw Error(`Timed out: ${label}`);}
app.whenReady().then(async()=>{
  console.log('QA: Electron ready');
  const {preview}=await import('vite');
  vite=await preview({configFile:false,root:path.resolve(__dirname,'..'),build:{outDir:'tmp/viewer-hardening-qa'},preview:{host:'127.0.0.1',port:0}});
  const host=`http://127.0.0.1:${vite.httpServer.address().port}`;
  console.log('QA: Vite listening');
  let hits=0,secretHits=0;
  server=http.createServer((req,res)=>{
    hits++;
    if(req.url==='/site.css'){res.setHeader('Content-Type','text/css');return res.end('body { background: rgb(24, 42, 63); color: white; } /* external style */');}
    if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end('document.body.dataset.loaded = "external-script";');}
    if(req.url==='/secret'){secretHits++;return res.end('should not load');}
    res.setHeader('Content-Type','text/html');
    res.end('<!doctype html><title>Browser fixture</title><link rel="stylesheet" href="/site.css"><style>h1 {color: gold}</style><h1>Browser fixture</h1><a href="/second">Next page</a><script src="/app.js"></script><script>window.inlineMarker="inline-script";</script>');
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const site=`http://browser.example.com:${server.address().port}`;
  const TestView=class extends WebContentsView {constructor(options){super(options);remote=this.webContents;}};
  win=new BrowserWindow({show:false,width:1250,height:900,webPreferences:{preload:path.join(__dirname,'../electron/preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  win.webContents.on('console-message',event=>console.log('Renderer:',event.message));
  win.webContents.on('did-fail-load',(_event,code,message)=>console.log('Load failed',code,message));
  win.webContents.on('dom-ready',()=>console.log('QA: DOM ready'));
  const testDialog={showMessageBox:async()=>({response:1})};
  browser=createViewerBrowser({WebContentsView:TestView,session,dialog:testDialog,getWindow:()=>win,allowRequest:url=>{try{return new URL(url).origin===site;}catch{return false;}}});
  const trusted=event=>!win.isDestroyed() && event.sender===win.webContents && event.senderFrame===win.webContents.mainFrame && event.senderFrame.url.startsWith(host+'/');
  ipcMain.on('app:connection',(event)=>{console.log('QA: preload connection');event.returnValue=trusted(event)?{}:null;});
  ipcMain.handle('app:capabilities',()=>({features:{}}));ipcMain.handle('app:startup-status',()=>({state:'ready'}));
  for(const action of ['start','state','place','navigate','inspect','source','command','clearData'])ipcMain.handle(`viewer-browser:${action}`,async(event,value)=>{
    if(!trusted(event))return {error:'Desktop access required.'};
    try{return await browser[action](value);}catch(error){return {error:error.message};}
  });
  const js=code=>win.webContents.executeJavaScript(code);
  const click=async label=>{await until(()=>js(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()===${JSON.stringify(label)} && e.getClientRects().length && !e.disabled)`),`button ${label}`);return js(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)} && e.getClientRects().length);b.click();})()`);};
  const select=(selector,value)=>js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
  await win.loadURL(`${host}/tests/fixtures/viewerBrowser.html`);
  console.log('QA: Host loaded');
  await until(()=>browser.state().ready,'browser startup');
  console.log('QA: Browser started');
  await select('[aria-label="Page address"]',site);await click('Go');
  await until(()=>remote.executeJavaScript('document.body.dataset.loaded === "external-script"'),'page and assets');
  assert.equal(await remote.executeJavaScript('typeof window.workstationDesktop'), 'undefined');
  assert.equal(await remote.executeJavaScript('typeof require'), 'undefined');
  assert.notEqual(remote.session,win.webContents.session);
  await remote.executeJavaScript(`fetch('http://127.0.0.1:${server.address().port}/secret').catch(()=>null)`);
  assert.equal(secretHits,0);checks.push('Real page and scripts load; remote content has no host bridge, Node, host session, or loopback access');
  await until(()=>js("[...document.querySelectorAll('button')].some(e=>e.textContent==='Inspect page' && !e.disabled)"),'browser toolbar catches up');await sleep(100);fs.writeFileSync(path.join(work,'browser.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  await click('Inspect page');
  const snapshot=await browser.snapshot();assert(snapshot.html.includes('data:image/png;base64,') || snapshot.warnings.length);
  await until(()=>js("document.querySelectorAll('[aria-label=\"Detected source\"] option').length>=6"),'source inventory');
  const options=await js("[...document.querySelector('[aria-label=\"Detected source\"]').options].map(e=>({id:e.value,text:e.textContent}))");
  for(const [match,kind,marker] of [['Rendered HTML','html','Browser fixture'],['/site.css','css','external style'],['/app.js','js','external-script']]){
    const option=options.find(o=>o.text.includes(match));assert(option);
    await select('[aria-label="Detected source"]',option.id);
    await until(()=>js(`document.querySelector('[aria-label="Inspected source"]')?.value.includes(${JSON.stringify(marker)})`),`${kind} source`);
    if(kind==='css')fs.writeFileSync(path.join(work,'inspector.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
    await click(`Open in ${kind==='js'?'JavaScript':kind.toUpperCase()} Viewer`);
    await until(()=>js(`!document.querySelector('[data-capture-tab="${kind}-viewer"]').hidden`),'viewer handoff');
    const label=kind==='js'?'JavaScript':kind.toUpperCase();
    assert(await js(`document.querySelector('[aria-label="${label} source"]').value.includes(${JSON.stringify(marker)})`));
    await js("document.querySelector('[data-sidebar-route=browser]').click()");
  }
  checks.push('Rendered HTML, linked CSS, and linked JavaScript open in the matching viewers with exact content');
  await click('Browse page');await browser.navigate(`${site}/second`);
  await until(()=>!browser.state().loading && browser.state().url.endsWith('/second'),'second page');
  assert(browser.state().back);browser.command('back');
  await until(()=>browser.state().url===site+'/','back navigation');
  const prior=options.find(o=>o.text.includes('/app.js')).id;
  await assert.rejects(browser.source(prior),/Inspect the current page/);
  const count=hits;await assert.rejects(browser.navigate(`http://127.0.0.1:${server.address().port}/secret`),/public HTTP/);assert.equal(hits,count);
  checks.push('Back navigation works; old-page source IDs and private navigation are rejected');
  assert.equal(remote.debugger.isAttached(),false);
  await remote.executeJavaScript("localStorage.setItem('qa-persistent','yes');document.cookie='qa=yes; max-age=3600; path=/'");
  const oldSession=remote.session;
  await browser.command('close');assert.equal(browser.state().ready,false);await browser.start();assert.equal(browser.state().url,'about:blank');
  assert.equal(remote.session,oldSession);await browser.navigate(site);await until(()=>!browser.state().loading,'reopened page');
  assert.equal(await remote.executeJavaScript("localStorage.getItem('qa-persistent')"),'yes');
  assert((await remote.executeJavaScript('document.cookie')).includes('qa=yes'));
  await browser.clearData('all');await browser.navigate(site);await until(()=>!browser.state().loading,'cleared page');
  assert.equal(await remote.executeJavaScript("localStorage.getItem('qa-persistent')"),null);
  assert.equal(await remote.executeJavaScript('document.cookie'),'');
  checks.push('Close/reopen preserves profile; explicit clear removes cookies and site storage; inspection debugger detaches');
  if(process.env.LAW_BROWSER_PUBLIC_QA==='1'){
    await browser.dispose();browser=createViewerBrowser({WebContentsView:TestView,session,dialog:testDialog,getWindow:()=>win});
    await browser.navigate('https://example.com');
    await until(()=>!browser.state().loading && browser.state().title==='Example Domain','public page under production policy');
    assert((await browser.inspect()).items.some(item=>item.kind==='html'));
    checks.push('Live example.com loads and can be inspected using the production DNS/request policy');
  }
  console.log(JSON.stringify({ok:true,checks,screenshots:work},null,2));
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  clearTimeout(timeout);
  await browser?.dispose();win?.destroy();vite?.httpServer.close();await new Promise(resolve=>server?server.close(resolve):resolve());app.exit(process.exitCode||0);
});
