// Two independent Electron launches are driven by qa-browser-persistence.cjs.
const {app,BrowserWindow,WebContentsView,session}=require('electron');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {createViewerBrowser}=require('../electron/viewerBrowser');
const {LAW_QA_PROFILE:work,LAW_QA_SITE:site,LAW_QA_PHASE:phase}=process.env;
fs.mkdirSync(path.join(work,'profile'),{recursive:true});
app.setPath('userData',path.join(work,'profile'));
app.commandLine.appendSwitch('host-resolver-rules','MAP browser.example.com 127.0.0.1');
app.commandLine.appendSwitch('no-proxy-server');
let win,browser,remote,permissionAnswer=0;const popups=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<150;i++){if(await fn())return;await sleep(100);}throw Error(`Timed out: ${label}`);}
const timeout=setTimeout(()=>app.exit(1),60000);
app.whenReady().then(async()=>{
  win=new BrowserWindow({show:false,webPreferences:{sandbox:true}});
  const TestView=class extends WebContentsView {constructor(options){super(options);remote=this.webContents;
    const setter=remote.setWindowOpenHandler.bind(remote);remote.setWindowOpenHandler=fn=>setter(details=>{const result=fn(details);if(result.action==='allow')result.overrideBrowserWindowOptions.show=false;return result;});
    remote.on('did-create-window',popup=>popups.push(popup));}};
  const dialog={showMessageBox:async(_win,options)=>({response:options.title==='Website permission'?permissionAnswer:1}),
    showSaveDialog:async()=>({canceled:false,filePath:path.join(work,'download.bin')})};
  browser=createViewerBrowser({WebContentsView:TestView,session,dialog,getWindow:()=>win,allowRequest:url=>{try{return new URL(url).origin===site;}catch{return false;}}});
  await browser.navigate(site);await until(()=>browser.state().title==='Profile QA'&&!browser.state().loading,'page');
  assert.equal(remote.getLastWebPreferences().sandbox,true);assert.equal(remote.getLastWebPreferences().contextIsolation,true);
  assert.equal(remote.getLastWebPreferences().nodeIntegration,false);assert.equal(remote.getLastWebPreferences().webSecurity,true);
  assert.equal(await remote.executeJavaScript('typeof require + ":" + typeof workstationDesktop'),'undefined:undefined');
  assert.equal(remote.debugger.isAttached(),false);assert(remote.session.storagePath.startsWith(path.join(work,'profile')));
  if(phase==='write') {
    await remote.session.cookies.set({url:site,name:'qa_login',value:'owned-fixture-only',expirationDate:Date.now()/1000+3600});
    await remote.executeJavaScript(`localStorage.setItem('qa','survives');new Promise((resolve,reject)=>{const r=indexedDB.open('qa',1);r.onupgradeneeded=()=>r.result.createObjectStore('data');r.onsuccess=()=>{const d=r.result,t=d.transaction('data','readwrite');t.objectStore('data').put('survives','value');t.oncomplete=()=>{d.close();resolve(true)};t.onerror=reject;};r.onerror=reject;})`);
    await remote.executeJavaScript(`window.addEventListener('message',e=>{if(e.origin===location.origin)window.qaMessage=e.data;});window.open('/popup','login');true`,true);
    await until(()=>popups.length===1&&!popups[0].webContents.isLoading(),'popup');
    const popup=popups[0].webContents;assert.equal(popup.session,remote.session);
    assert.equal(await popup.executeJavaScript('typeof require + ":" + typeof workstationDesktop'),'undefined:undefined');
    assert.equal(popup.getLastWebPreferences().sandbox,true);
    await popup.executeJavaScript("window.opener.postMessage('oauth-return',location.origin)");
    await until(()=>remote.executeJavaScript("window.qaMessage==='oauth-return'"),'opener communication');
    assert.equal(await remote.executeJavaScript("window.open('file:///C:/Windows/win.ini')===null"),true);
    await remote.executeJavaScript("const a=document.createElement('a');a.href='/download';a.click()",true);
    await until(()=>fs.existsSync(path.join(work,'download.bin')),'download');
    await until(()=>browser.state().notice==='Download saved.','download complete');
    assert.equal(fs.readFileSync(path.join(work,'download.bin'),'utf8'),'owned fixture download');
    await browser.command('close');assert(popups[0].isDestroyed());
  } else {
    assert((await remote.session.cookies.get({url:site,name:'qa_login'})).length===1);
    assert.equal(await remote.executeJavaScript("localStorage.getItem('qa')"),'survives');
    assert.equal(await remote.executeJavaScript(`new Promise(resolve=>{const r=indexedDB.open('qa');r.onsuccess=()=>{const d=r.result,g=d.transaction('data').objectStore('data').get('value');g.onsuccess=()=>{d.close();resolve(g.result);};};})`),'survives');
    // Clearing only cache must preserve authentication and site storage.
    await browser.clearData('cache');await browser.navigate(site);await until(()=>!browser.state().loading,'cache cleared');
    assert.equal(await remote.executeJavaScript("localStorage.getItem('qa')"),'survives');
    assert.equal((await remote.session.cookies.get({url:site,name:'qa_login'})).length,1);
    const savedSession=remote.session;await browser.clearData('all');assert.equal((await savedSession.cookies.get({url:site,name:'qa_login'})).length,0);
    await browser.navigate(site);await until(()=>!browser.state().loading,'cleared page');
    assert.equal(await remote.executeJavaScript("localStorage.getItem('qa')"),null);
  }
  console.log(JSON.stringify({ok:true,phase,electron:process.versions.electron,profilePath:browser.state().profilePath}));
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{clearTimeout(timeout);await browser?.dispose();win?.destroy();app.exit(process.exitCode||0);});
