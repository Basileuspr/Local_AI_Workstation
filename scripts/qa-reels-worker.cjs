const {app,BrowserWindow,WebContentsView,session,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createViewerBrowser}=require('../electron/viewerBrowser'),{createReelsAnalyzer}=require('../electron/reelsAnalyzer');
const work=process.env.LAW_REELS_QA_WORK,site=process.env.LAW_REELS_QA_SITE,phase=process.env.LAW_REELS_QA_PHASE;
app.setPath('userData',path.join(work,'profile'));app.commandLine.appendSwitch('host-resolver-rules','MAP browser.example.com 127.0.0.1');app.commandLine.appendSwitch('no-proxy-server');
let win,browser,remote,analyzer;
const timer=setTimeout(()=>app.exit(1),120000),sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<600;i++){if(await fn())return;await sleep(50);}throw Error('Fixture did not settle.');}
async function api(route,method='POST',body) {
    const r=await fetch(`http://127.0.0.1:${process.env.LAW_REELS_QA_PORT}${route}`,{method,headers:{'Content-Type':'application/json','x-law-session':'fixture-session','x-local-files':'fixture-native'},body:body?JSON.stringify(body):undefined});
    const data=await r.json();if(!r.ok)throw Error(data.detail||'Fixture API failed');return data;
}
const request=(action,value={})=>{
    if(action==='state')return api('/reels/state','GET');
    if(action==='create')return api('/reels/batches','POST',value);
    if(action==='preflight')return api('/reels/preflight','POST',value);
    if(action==='clear')return api('/reels/clear-cache','POST',{});
    const {batchId,index,...body}=value;
    return api(`/reels/batches/${batchId}/${action==='analyze'?`items/${index}/analyze`:action}`,'POST',action==='checkpoint'?{...body,...(index!==undefined?{index}:{})}:body);
};
app.whenReady().then(async()=>{
    win=new BrowserWindow({show:false,width:1100,height:850,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:path.resolve(__dirname,'../electron/preload.js')}});
    ipcMain.on('app:connection',e=>{e.returnValue={base:`http://127.0.0.1:${process.env.LAW_REELS_QA_PORT}`,token:'fixture-session'};});
    const View=class extends WebContentsView{constructor(options){super(options);remote=this.webContents;}};
    // Fixture-only certificate exception, pinned to the generated certificate.
    const fixtureSessions={fromPartition:(...args)=>{const ses=session.fromPartition(...args);ses.setCertificateVerifyProc((req,callback)=>{
        const fingerprint=new (require('node:crypto').X509Certificate)(req.certificate.data).fingerprint256.replaceAll(':','').toLowerCase();
        callback(req.hostname==='browser.example.com'&&fingerprint===process.env.LAW_REELS_QA_CERT?0:-3);
    });return ses;}};
    browser=createViewerBrowser({WebContentsView:View,session:fixtureSessions,getWindow:()=>win,profileDirectory:path.join(work,'profile'),workflowDirectory:path.join(work,'workflows'),
        allowRequest:raw=>new URL(raw).origin===site,prepareMedia:(id,body)=>api(`/browser-media/${id}/verify`,'POST',body),cancelMedia:id=>api(`/browser-media/${id}/cancel`)});
    await browser.navigate(site+'/conversation');await until(()=>!browser.state().loading);
    if(phase==='write') {
        await remote.session.cookies.set({url:site,name:'qa_account',value:'Owned',secure:true,expirationDate:Date.now()/1000+3600});
        await remote.executeJavaScript("localStorage.setItem('owned-account','preserve')");
    }
    analyzer=createReelsAnalyzer({browser,request});
    const trusted=e=>e.sender===win.webContents&&e.senderFrame===win.webContents.mainFrame;
    for(const action of ['state','controls','discover','start','pause','resume','cancel','clear'])ipcMain.handle(`reels:${action}`,async(e,v)=>{
        if(!trusted(e))return {error:'Desktop access required.'};try{return await analyzer[action](v);}catch(error){return {error:error.message};}
    });
    for(const action of ['start','state','place','navigate','profiles','selectProfile','createProfile','command'])ipcMain.handle(`viewer-browser:${action}`,async(e,v)=>{
        if(!trusted(e))return {error:'Desktop access required.'};try{return await browser[action](v);}catch(error){return {error:error.message};}
    });
    const found=await analyzer.discover({profileId:'default'});assert.equal(found.reels.length,2);assert(!JSON.stringify(found).includes('SECRET'));
    const started=await analyzer.start({visionModel:'fixture',whisperModel:'small',videoName:'Selected reel'});
    if(phase==='write')await analyzer.pause();
    await until(async()=>!(await analyzer.state()).active);
    if(phase==='write') {
        const paused=await analyzer.state();assert.equal(paused.summaries.length,1);assert.equal(paused.batches[0].status,'paused');
        await browser.navigate(site+'/reel/first/');await until(()=>!browser.state().loading);
        await analyzer.resume({batchId:started.batchId,videoName:'Selected reel'});
        await until(async()=>!(await analyzer.state()).active);
    }
    let state=await analyzer.state();assert.equal(state.error,null,JSON.stringify(state));assert.equal(state.summaries.length,2);
    assert(state.summaries.every(r=>r.repository==='https://github.com/fixture/owned-tool'));
    assert.equal(browser.state().url,site+'/conversation');
    assert.equal(fs.readdirSync(path.join(work,'workflows','media')).length,0);
    assert.equal((await remote.session.cookies.get({url:site,name:'qa_account'}))[0].value,'Owned');
    assert.equal(await remote.executeJavaScript("localStorage.getItem('owned-account')"),'preserve');
    await analyzer.clear();state=await analyzer.state();assert.equal(state.summaries.length,2);
    assert.equal((await remote.session.cookies.get({url:site,name:'qa_account'}))[0].value,'Owned');
    if(phase==='read')assert(state.batches.find(b=>b.id===started.batchId).items.every(i=>i.status==='duplicate'));
    if(phase==='write') {
        const fixture=path.resolve(__dirname,'../tmp/viewer-hardening-qa/tests/fixtures/reels.html');
        assert(fs.existsSync(fixture),'Build the owned React fixture first.');
        await win.loadFile(fixture);
        await until(()=>win.webContents.executeJavaScript("document.querySelectorAll('.reels-results article').length===2"));
        await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='Check account').click()");
        await until(()=>win.webContents.executeJavaScript("document.querySelector('.browser-account-check')?.textContent.includes('Signed-in account identified.')"));
        assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('[aria-label=\"Current account control\"]')"),false);
        await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='Hide account browser').click()");
        await until(()=>win.webContents.executeJavaScript("!document.querySelector('.viewer-browser')"));
        const view=await win.webContents.executeJavaScript("({links:[...document.querySelectorAll('.reels-results a')].map(a=>a.href),overflow:document.documentElement.scrollWidth>innerWidth,media:document.querySelectorAll('.reels-results img,.reels-results video,.reels-results textarea').length})");
        assert.equal(view.overflow,false);assert.equal(view.media,0);assert.equal(view.links.length,4);
        fs.writeFileSync(path.join(work,'reels-ui.png'),(await win.webContents.capturePage()).toPNG());
        const hostile=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,preload:path.resolve(__dirname,'../electron/preload.js')}});
        await hostile.loadURL('data:text/html,untrusted');
        assert.equal((await hostile.webContents.executeJavaScript('workstationDesktop.reelsState()')).error,'Desktop access required.');hostile.destroy();
    }
    console.log(JSON.stringify({ok:true,phase,checks:['Complete session-authenticated video/audio, local fixture transcript/stills/OCR/summary','Save then media cleanup then exit then next reel','Resume from an open reel restores the saved conversation and skips its saved summary','Separate Electron restart prevents duplicate acquisition','Clear cache preserves Chromium login, site storage and saved summaries','No automatically visited repository']}));
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{clearTimeout(timer);await analyzer?.dispose();await browser?.dispose();win?.destroy();app.exit(process.exitCode||0);});
