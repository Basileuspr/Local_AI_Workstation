const {app,BrowserWindow,WebContentsView,session}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createViewerBrowser}=require('../electron/viewerBrowser');
const work=process.env.LAW_FOUNDATION_WORK,site=process.env.LAW_FOUNDATION_SITE,phase=process.env.LAW_FOUNDATION_PHASE;
app.setPath('userData',path.join(work,'profile'));
app.commandLine.appendSwitch('host-resolver-rules','MAP browser.example.com 127.0.0.1');
app.commandLine.appendSwitch('no-proxy-server');
let win,browser,remote,crashExit=false;const checks=[],popups=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label) {const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await sleep(50);}throw Error(`Timed out: ${label}`);}
const timeout=setTimeout(()=>app.exit(1),120000);
async function backend(id,action,body) {
    const response=await fetch(`http://127.0.0.1:${process.env.LAW_FOUNDATION_BACKEND}/browser-media/${id}/${action}`,{method:'POST',headers:{'Content-Type':'application/json','x-law-session':'fixture-session','x-local-files':'fixture-native'},body:body?JSON.stringify(body):undefined});
    if(!response.ok)throw Error('media_verification_failed');return response.json();
}
async function open() {await browser.navigate(site);await until(()=>!browser.state().loading,'page');}
async function start() {return browser.startWorkflow({profileId:browser.state().selected});}
function call(run,action,extra={}) {return browser.browserTool({workflowId:run.workflowId,action,...extra});}
app.whenReady().then(async()=>{
    win=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{sandbox:true}});
    const TestView=class extends WebContentsView {constructor(opts){super(opts);remote=this.webContents;
        const setter=remote.setWindowOpenHandler.bind(remote);remote.setWindowOpenHandler=fn=>setter(details=>{const result=fn(details);if(result.action==='allow')result.overrideBrowserWindowOptions.show=false;return result;});
        remote.on('did-create-window',p=>popups.push(p));}};
    browser=createViewerBrowser({WebContentsView:TestView,session,getWindow:()=>win,dialog:{showMessageBox:async()=>({response:1})},
        profileDirectory:path.join(work,'profile'),workflowDirectory:path.join(work,'workflows'),
        allowRequest:raw=>{try{return new URL(raw).origin===site;}catch{return false;}},
        prepareMedia:(id,body)=>backend(id,'verify',body),cancelMedia:id=>backend(id,'cancel')});
    await open();
    if(phase==='read') {
        const selected=browser.state().selected;assert.notEqual(selected,'default');
        assert.equal((await remote.session.cookies.get({url:site,name:'qa_login'}))[0].value,'Bob');
        assert.equal(await remote.executeJavaScript("localStorage.getItem('account')"),'Bob');
        const history=browser.workflowState().history;
        const interrupted=history.find(r=>r.status==='interrupted');assert(interrupted);
        assert.equal(fs.existsSync(path.join(work,'workflows','media',interrupted.id)),false);
        assert.equal(interrupted.reason,'restart_requires_manual_resume');
        await browser.selectProfile('default');await open();
        assert.equal((await remote.session.cookies.get({url:site,name:'qa_login'}))[0].value,'Alice');
        assert.equal(await remote.executeJavaScript("localStorage.getItem('account')"),'Alice');
        await browser.selectProfile(selected);await open();
        const recovered=await browser.resumeWorkflow({workflowId:interrupted.id,profileId:selected,restorePage:true});
        assert.notEqual(recovered.workflowId,interrupted.id);assert.equal(recovered.page.accountRef,interrupted.accountRef);
        await browser.cancelWorkflow({workflowId:recovered.workflowId});
        await browser.clearWorkflowMedia();await browser.clearData('cache');await open();
        assert.equal((await remote.session.cookies.get({url:site,name:'qa_login'}))[0].value,'Bob');
        assert.equal(await remote.executeJavaScript("localStorage.getItem('account')"),'Bob');
        assert(browser.workflowState().history.some(r=>r.id===interrupted.id));
        checks.push('Separate Electron restart restores profile, isolated login and checkpoint account binding; interrupted workflow resumes with fresh references; cache/media cleanup preserves login/checkpoints');
    } else {
        const cookie=value=>remote.session.cookies.set({url:site,name:'qa_login',value,expirationDate:Date.now()/1000+3600});
        await cookie('Alice');await remote.executeJavaScript("localStorage.setItem('account','Alice')");
        const secondary=browser.createProfile('Fixture second account');await browser.selectProfile(secondary.id);await open();
        const selection=browser.selectProfile(secondary.id),overlapping=browser.selectProfile('default');
        assert.equal((await selection).selected,secondary.id);assert.equal((await overlapping).selected,'default');
        await browser.selectProfile(secondary.id);await open();
        assert.equal((await remote.session.cookies.get({url:site,name:'qa_login'})).length,0);
        assert.equal(await remote.executeJavaScript("localStorage.getItem('account')"),null);
        await cookie('Bob');await remote.executeJavaScript("localStorage.setItem('account','Bob')");await open();
        assert.equal(remote.getLastWebPreferences().sandbox,true);assert.equal(remote.getLastWebPreferences().contextIsolation,true);assert.equal(remote.getLastWebPreferences().nodeIntegration,false);
        assert.equal(await remote.executeJavaScript('typeof require+":"+typeof workstationDesktop'),'undefined:undefined');
        await remote.executeJavaScript("window.addEventListener('message',e=>window.popupReturn=e.data);window.open('/popup','login');true",true);
        await until(()=>popups.length && !popups[0].webContents.isLoading(),'login popup');
        assert.equal(popups[0].webContents.session,remote.session);
        assert.equal(await popups[0].webContents.executeJavaScript('typeof require+":"+typeof workstationDesktop'),'undefined:undefined');
        await popups[0].webContents.executeJavaScript("window.opener.postMessage('returned',location.origin)");await until(()=>remote.executeJavaScript("window.popupReturn==='returned'"),'popup return');popups[0].destroy();
        checks.push('Serialized profile selection, profile isolation, sandbox/Node/host bridge boundaries, popup login/opener communication');

        let run=await start();let page=run.page;
        assert(!JSON.stringify(page).includes('SECRET'));assert(page.untrusted);
        await assert.rejects(browser.startWorkflow({profileId:secondary.id}),/already has a workflow/);
        await assert.rejects(call(run,'executeJavaScript',{value:'alert(1)'}),/Unsupported browser operation/);
        const duplicate=page.elements.find(e=>e.name==='Duplicate');await assert.rejects(call(run,'click',{pageRef:page.pageRef,elementRef:duplicate.elementRef}),/ambiguous_element/);
        const change=page.elements.find(e=>e.name==='Change');await remote.executeJavaScript("document.getElementById('change').textContent='Replaced'");
        await assert.rejects(call(run,'click',{pageRef:page.pageRef,elementRef:change.elementRef}),/stale_element/);
        page=await call(run,'discover',{target:{role:'textbox',name:'Search'}});assert.equal(page.elements.length,1);
        const filled=await call(run,'fill',{pageRef:page.pageRef,elementRef:page.elements[0].elementRef,value:'fixture search'});assert(filled.filled);
        assert.equal(await remote.executeJavaScript("document.querySelector('input[type=search]').value"),'fixture search');
        await assert.rejects(call(run,'fill',{pageRef:page.pageRef,elementRef:page.elements[0].elementRef,value:'again'}),/stale_element/);
        page=filled.page;const scroll=await call(run,'scroll',{pageRef:page.pageRef,amount:500});assert(scroll.scrolled||scroll.atBoundary);
        const pending=call(run,'wait',{condition:'element',target:{role:'button',name:'Missing'},timeoutMs:30000});
        const pendingRejection=assert.rejects(pending,/cancelled/);
        await sleep(100);await assert.rejects(call(run,'read'),/busy/);await browser.cancelWorkflow({workflowId:run.workflowId});await pendingRejection;await open();
        checks.push('Secret-safe page read, named tools only, semantic fill/scroll, stale and ambiguous target rejection, exclusive operation lease and cancellation recovery');

        run=await start();page=run.page;const next=page.elements.find(e=>e.name==='Next');
        const clicked=await call(run,'click',{pageRef:page.pageRef,elementRef:next.elementRef});assert(clicked.clicked);
        assert.equal(clicked.page.source.path,'/next');assert.notEqual(clicked.page.pageRef,page.pageRef);
        await assert.rejects(call(run,'click',{pageRef:page.pageRef,elementRef:next.elementRef}),/stale_document/);
        page=clicked.page;
        await assert.rejects(call(run,'fill',{pageRef:page.pageRef,elementRef:page.elements.find(e=>e.name==='Search').elementRef,value:'password=SECRET'}),/unsafe_field/);
        await remote.executeJavaScript("const b=document.createElement('button');b.textContent='Change';document.body.appendChild(b)");
        await assert.rejects(call(run,'click',{pageRef:page.pageRef,elementRef:page.elements.find(e=>e.name==='Change').elementRef}),/ambiguous_element/);
        await browser.cancelWorkflow({workflowId:run.workflowId});await open();
        checks.push('Verified semantic click/navigation outcome and new-document refs; credential-like input and newly ambiguous DOM targets rejected');

        run=await start();await remote.executeJavaScript("document.querySelector('[aria-label=\"Current account\"]').textContent='Unexpected account'");
        await assert.rejects(call(run,'click',{pageRef:run.page.pageRef,elementRef:run.page.elements.find(e=>e.name==='Change').elementRef}),/account_changed/);
        assert.equal(await remote.executeJavaScript("document.getElementById('change').textContent"),'Change');
        assert.equal(browser.workflowState().active.status,'paused');await browser.cancelWorkflow({workflowId:run.workflowId});await open();
        run=await start();await remote.executeJavaScript("document.body.insertAdjacentHTML('afterbegin','<label>Password<input type=password></label>')");
        await assert.rejects(call(run,'read'),/login_challenge/);assert.equal(browser.workflowState().active.status,'paused');await browser.cancelWorkflow({workflowId:run.workflowId});await open();
        run=await start();await browser.navigate(site+'/manual');assert.equal(browser.workflowState().active.status,'paused');await browser.cancelWorkflow({workflowId:run.workflowId});await open();
        run=await start();await assert.rejects(call(run,'navigate',{url:'http://127.0.0.1/private'}),/blocked_destination/);
        await assert.rejects(call(run,'navigate',{url:'https://other.example.com'}),/blocked_destination|unexpected_origin/);
        await browser.cancelWorkflow({workflowId:run.workflowId});
        run=await start();await assert.rejects(call(run,'wait',{condition:'element',target:{role:'button',name:'Never'},timeoutMs:150}),/timeout/);
        assert.equal(browser.workflowState().active.status,'failed');assert.equal(browser.state().ready,false);await open();
        checks.push('Account change, login/MFA challenge and manual navigation pause; private/foreign destination blocks; timeout closes page and releases workflow');

        await remote.executeJavaScript("const marker=document.querySelector('[aria-label=\"Current account\"]');marker.setAttribute('aria-label','Signed in as');marker.setAttribute('role','button')");
        run=await browser.startWorkflow({profileId:secondary.id,accountTarget:{role:'button',name:'Signed in as'}});
        assert.equal(browser.workflowState().active.accountBound,true);await browser.cancelWorkflow({workflowId:run.workflowId});await open();
        checks.push('Explicit semantic account-marker binding');

        await browser.navigate(site+'/reel/owned-fixture/');await until(()=>!browser.state().loading,'checkpoint reel');
        run=await start();const checkpoint=run;
        await browser.navigate(site+'/different-page');await until(()=>!browser.state().loading,'different recovery page');
        run=await browser.resumeWorkflow({workflowId:checkpoint.workflowId,profileId:secondary.id,restorePage:true});
        assert.equal(browser.state().url,site+'/reel/owned-fixture/');assert.equal(run.restoredPage,true);
        assert.notEqual(run.page.pageRef,checkpoint.page.pageRef);
        await assert.rejects(call(checkpoint,'read'),/not found/);
        await browser.navigate(site+'/reel/owned-fixture');await until(()=>!browser.state().loading,'reel without slash');
        const same=await browser.resumeWorkflow({workflowId:run.workflowId,profileId:secondary.id,restorePage:true});
        assert.equal(same.restoredPage,false);
        await browser.cancelWorkflow({workflowId:same.workflowId});await open();
        checks.push('Saved-page recovery reloads the selected profile, renews references, rejects old refs, and accepts a stable reel ID with an optional trailing slash');

        await until(()=>remote.executeJavaScript("document.querySelector('video').readyState>=1"),'media metadata');
        run=await start();page=run.page;let reel=page.elements.find(e=>e.role==='video');assert(reel);
        const captured=await call(run,'capture',{pageRef:page.pageRef,elementRef:reel.elementRef});
        assert.equal(captured.completeness,'complete');assert.equal(captured.audio,'complete');assert.equal(captured.captions,'complete');assert.equal(captured.decodedFrames,30);
        assert(!JSON.stringify(captured).includes('SECRET'));assert(!JSON.stringify(captured).includes('signature'));
        const folder=path.join(work,'workflows','media',run.workflowId);
        assert(fs.existsSync(path.join(folder,'video.bin')));assert(fs.existsSync(path.join(folder,'audio.m4a')));
        assert(fs.readFileSync(path.join(folder,'captions.json'),'utf8').includes('Owned fixture speech'));
        assert(!fs.readFileSync(path.join(folder,'captions.json'),'utf8').includes('SECRET'));
        await browser.clearWorkflowMedia();assert(!fs.existsSync(folder));
        assert.equal((await remote.session.cookies.get({url:site,name:'qa_login'}))[0].value,'Bob');
        assert(browser.workflowState().history.find(r=>r.id===run.workflowId));
        checks.push('Selected-session authenticated complete video/audio/VTT handoff, full decoder verification and opaque refs; media-only cleanup retains login and checkpoint');
        await remote.executeJavaScript("document.querySelector('figcaption').remove()");
        run=await start();page=run.page;reel=page.elements.find(e=>e.role==='video');
        await assert.rejects(call(run,'capture',{pageRef:page.pageRef,elementRef:reel.elementRef,requireCaption:true}),/unsupported_caption_source/);
        assert(!fs.existsSync(path.join(work,'workflows','media',run.workflowId)));
        await open();
        checks.push('Reels caption requirement rejects an unverified page caption rather than declaring it absent');

        await remote.executeJavaScript("const audio=document.createElement('audio');audio.src='/media?signature=NEW';document.body.appendChild(audio)");
        run=await start();page=run.page;reel=page.elements.find(e=>e.role==='video');
        await assert.rejects(call(run,'capture',{pageRef:page.pageRef,elementRef:reel.elementRef}),/unsupported_separate_audio/);
        assert(!fs.existsSync(path.join(work,'workflows','media',run.workflowId)));await open();
        checks.push('Separate page audio is rejected instead of misreporting a silent container as complete reel audio');

        await remote.executeJavaScript("document.querySelector('video').src='/media?signature=NEW&slow=1'");await until(()=>remote.executeJavaScript("document.querySelector('video').readyState>=1"),'slow media metadata');
        run=await start();page=run.page;reel=page.elements.find(e=>e.role==='video');
        const inFlight=call(run,'capture',{pageRef:page.pageRef,elementRef:reel.elementRef});
        const captureRejected=assert.rejects(inFlight,/cancelled|transfer_aborted/);
        const partial=path.join(work,'workflows','media',run.workflowId);
        await until(()=>fs.existsSync(path.join(partial,'video.bin')) && fs.statSync(path.join(partial,'video.bin')).size>0,'partial transfer');
        await browser.cancelWorkflow({workflowId:run.workflowId});await captureRejected;
        assert.equal(browser.workflowState().active.status,'cancelled');assert(!fs.existsSync(partial));await open();
        assert.equal((await remote.session.cookies.get({url:site,name:'qa_login'}))[0].value,'Bob');
        checks.push('Cancellation aborts an authenticated in-flight media transfer, removes its partial workspace and preserves login');

        // Same source identity, refreshed query signature; one bounded retry.
        await remote.executeJavaScript("document.querySelector('video').src='/media?signature=OLD'");await until(()=>remote.executeJavaScript("document.querySelector('video').readyState>=1"),'old address metadata');
        run=await start();page=run.page;reel=page.elements.find(e=>e.role==='video');
        await remote.executeJavaScript("setTimeout(()=>document.querySelector('video').src='/media?signature=NEW',100);true");
        const refreshed=await call(run,'capture',{pageRef:page.pageRef,elementRef:reel.elementRef});assert.equal(refreshed.completeness,'complete');await browser.clearWorkflowMedia();
        await remote.executeJavaScript("document.querySelector('track').src='/blocked-caption'");
        run=await start();page=run.page;reel=page.elements.find(e=>e.role==='video');
        await assert.rejects(call(run,'capture',{pageRef:page.pageRef,elementRef:reel.elementRef}),/blocked_destination/);
        assert(!fs.existsSync(path.join(work,'workflows','media',run.workflowId)));
        checks.push('Expired signed address refresh once without leaked secrets; redirected private media destination rejected and failed media cleaned');
        await open();await until(()=>remote.executeJavaScript("document.querySelector('video').readyState>=1"),'fresh media');
        run=await start();
        const interrupted=path.join(work,'workflows','media',run.workflowId);fs.mkdirSync(interrupted,{recursive:true});fs.writeFileSync(path.join(interrupted,'video.bin'),'interrupted fixture partial');
        await remote.session.cookies.flushStore();remote.session.flushStorageData();
        // Simulate a process exit before workflow disposal/checkpoint completion.
        crashExit=true;
    }
    console.log(JSON.stringify({ok:true,phase,electron:process.versions.electron,checks},null,2));
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
    clearTimeout(timeout);if(!crashExit){await browser?.dispose();win?.destroy();}app.exit(process.exitCode||0);
});
