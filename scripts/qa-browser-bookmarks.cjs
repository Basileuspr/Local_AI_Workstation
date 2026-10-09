// Isolated Electron UI and separate-process persistence checks. The native
// picker is simulated; no user profile, login session or original is changed.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
if(!process.versions.electron) {
    const {spawn}=require('node:child_process');
    const work=fs.mkdtempSync(path.join(os.tmpdir(),'law-bookmarks-qa-'));
    let server;
    (async()=>{
        const source=process.argv[2] && path.resolve(process.argv[2]);
        const input=source || path.join(work,'export.html');
        if(!source)fs.writeFileSync(input,'<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3>Imported folder</H3><DL><p><DT><A HREF="https://example.com/">Example</A><DT><A HREF="file:///C:/reference.html">Local reference</A></DL><p></DL>');
        const {build}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
        await build({configFile:false,plugins:[react()],root,base:'./',build:{outDir:path.join(work,'renderer'),emptyOutDir:true,
            rollupOptions:{input:path.join(root,'tests/fixtures/viewerBrowser.html')}}});
        server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Bookmark fixture</title><h1>Owned bookmark fixture</h1>');});
        await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
        const site=`http://browser.example.com:${server.address().port}`;
        for(const phase of ['write','read']) await new Promise((resolve,reject)=>{
            const env={...process.env,LAW_BOOKMARK_QA_WORK:work,LAW_BOOKMARK_QA_INPUT:input,LAW_BOOKMARK_QA_SITE:site,LAW_BOOKMARK_QA_PHASE:phase};
            delete env.ELECTRON_RUN_AS_NODE;
            const child=spawn(require('electron'),[__filename],{env,windowsHide:true,stdio:'inherit'});
            child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`Bookmark ${phase} QA failed (${code})`)));
        });
        console.log(JSON.stringify({ok:true,artifacts:work,checks:['HTML import and duplicate handling','Search and folder filtering','Save, edit, move, open and remove through renderer/preload/IPC','Blocked addresses stay inert','Native page hidden while managing bookmarks','Separate Electron launch preserves library','Narrow layout geometry'],nativePicker:'simulated'},null,2));
    })().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server?.close());
} else {
    const {app,BrowserWindow,WebContentsView,session,ipcMain}=require('electron');
    const {createViewerBrowser}=require('../electron/viewerBrowser');
    const {createBrowserBookmarks,registerBrowserBookmarkIpc}=require('../electron/browserBookmarks');
    const work=process.env.LAW_BOOKMARK_QA_WORK,input=process.env.LAW_BOOKMARK_QA_INPUT,site=process.env.LAW_BOOKMARK_QA_SITE,phase=process.env.LAW_BOOKMARK_QA_PHASE;
    app.setPath('userData',path.join(work,'profile'));
    app.commandLine.appendSwitch('host-resolver-rules','MAP browser.example.com 127.0.0.1');
    app.commandLine.appendSwitch('no-proxy-server');
    let win,browser,vite,remote,view;
    const timeout=setTimeout(()=>{console.error('Bookmark QA timed out');app.exit(1);},90000);
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    async function until(fn,label){const end=Date.now()+12000;while(Date.now()<end){if(await fn())return;await sleep(50);}throw Error(`Timed out: ${label}`);}
    app.whenReady().then(async()=>{
        const {preview}=await import('vite');
        vite=await preview({configFile:false,root,build:{outDir:path.join(work,'renderer')},preview:{host:'127.0.0.1',port:0}});
        const host=`http://127.0.0.1:${vite.httpServer.address().port}`;
        win=new BrowserWindow({show:false,width:1250,height:900,webPreferences:{preload:path.join(root,'electron/preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
        const TestView=class extends WebContentsView {constructor(options){super(options);remote=this.webContents;view=this;}};
        browser=createViewerBrowser({WebContentsView:TestView,session,getWindow:()=>win,profileDirectory:path.join(work,'profile'),
            allowRequest:raw=>{try{return new URL(raw).origin===site;}catch{return false;}}});
        const store=createBrowserBookmarks(path.join(work,'profile'));
        const trusted=event=>!win.isDestroyed() && event.sender===win.webContents && event.senderFrame===win.webContents.mainFrame && event.senderFrame.url.startsWith(host+'/');
        ipcMain.on('app:connection',event=>{event.returnValue=trusted(event)?{}:null;});
        ipcMain.handle('app:startup-status',()=>({state:'ready'}));ipcMain.handle('app:capabilities',()=>({features:{}}));
        ipcMain.handle('sound-mixer:configure',()=>({applied:true}));
        registerBrowserBookmarkIpc({ipcMain,store,trustedDesktop:trusted,getWindow:()=>win,dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[input]})}});
        for(const action of ['start','state','place','navigate','inspect','source','command','clearData','profiles','createProfile','selectProfile','createTab','selectTab','closeTab','shortcut','setTabSettings','startWorkflow','browserTool','workflowState','cancelWorkflow','resumeWorkflow','clearWorkflowMedia'])
            ipcMain.handle(`viewer-browser:${action}`,async(event,value)=>{
                if(!trusted(event))return {error:'Desktop access required.'};
                try{return await browser[action](value);}catch(error){return {error:error.message};}
            });
        const js=code=>win.webContents.executeJavaScript(code);
        const click=async label=>{
            await until(()=>js(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()===${JSON.stringify(label)} && e.getClientRects().length && !e.disabled)`),`button ${label}`);
            await js(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)} && e.getClientRects().length && !e.disabled);b.click();})()`);
        };
        const fill=(label,value)=>js(`(()=>{const e=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');e.focus();Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
        await win.loadURL(`${host}/tests/fixtures/viewerBrowser.html`);
        await until(()=>browser.state().ready,'browser startup');
        await click('Bookmarks');
        await until(()=>js("!!document.querySelector('[aria-label=\"Saved bookmarks\"]')"),'bookmark panel');
        if(phase==='read') {
            const expected=JSON.parse(fs.readFileSync(path.join(work,'expected.json'),'utf8'));
            await until(()=>js(`document.querySelectorAll('.bookmark-row').length===${expected.count}`),'restored rows');
            assert.equal(store.list().bookmarks.length,expected.count);
            assert(store.list().bookmarks.some(b=>b.title==='QA persisted edit' && b.folderPath==='QA folder'));
            await fill('Search bookmarks','QA persisted edit');
            await until(()=>js("document.querySelectorAll('.bookmark-row').length===1"),'restored search');
        } else {
            await click('Import HTML…');
            await until(()=>js("document.querySelector('.browser-bookmarks [role=status]')?.textContent.includes('Imported')"),'import');
            const imported=store.list(),count=imported.bookmarks.length;
            assert(count>0);assert(imported.bookmarks.some(b=>!b.canOpen));
            assert(await js("[...document.querySelectorAll('.bookmark-open')].some(b=>b.disabled)"));
            await click('Import HTML…');
            await until(()=>js("document.querySelector('.browser-bookmarks [role=status]')?.textContent.includes('Imported 0 bookmarks')"),'repeat import');
            assert.equal(store.list().bookmarks.length,count);
            const first=imported.bookmarks.find(b=>b.parentId),folder=imported.folders.find(f=>f.id===first.parentId);
            await fill('Bookmark folder',folder.id);
            await until(()=>js(`document.querySelectorAll('.bookmark-row').length===${imported.bookmarks.filter(b=>b.parentId===folder.id).length}`),'folder filter');
            await fill('Bookmark folder','all');
            await fill('Search bookmarks',first.title);
            await until(()=>js("document.querySelectorAll('.bookmark-row').length>0"),'search');
            assert(await js(`document.querySelector('.bookmark-list').textContent.includes(${JSON.stringify(first.title)})`));
            await click('Close bookmarks');
            await fill('Page address',site);await click('Go');
            await until(()=>!browser.state().loading && browser.state().title==='Bookmark fixture','owned page');
            assert.equal(await remote.executeJavaScript('typeof workstationDesktop'), 'undefined');
            await until(()=>view.getVisible(),'browser page visible');
            await click('☆ Bookmark page');
            await until(()=>!view.getVisible(),'browser page hidden');
            await until(()=>js(`document.querySelector('[aria-label="Bookmark address"]').value===${JSON.stringify(site+'/')}`),'page bookmark draft');
            await fill('Bookmark name','QA temporary');await click('Save bookmark');
            await until(()=>store.list().bookmarks.some(b=>b.title==='QA temporary'),'saved page');
            await fill('New bookmark folder name','QA folder');await click('Create folder');
            await until(()=>store.list().folders.some(f=>f.title==='QA folder'),'created folder');
            const qaFolder=store.list().folders.find(f=>f.title==='QA folder');
            await fill('Bookmark folder','all');await fill('Search bookmarks','QA temporary');
            await until(()=>js("document.querySelectorAll('.bookmark-row').length===1"),'temporary row');
            await click('Edit');await fill('Bookmark name','QA persisted edit');await fill('Save bookmark in folder',qaFolder.id);await click('Update bookmark');
            await until(()=>store.list().bookmarks.some(b=>b.title==='QA persisted edit' && b.parentId===qaFolder.id),'edit and move');
            await fill('Search bookmarks','QA persisted edit');
            await until(()=>js("document.querySelectorAll('.bookmark-row').length===1"),'edited row');
            await click('QA persisted edit');
            await until(()=>js("!document.querySelector('[aria-label=\"Bookmarks\"]')"),'bookmark navigation');
            await until(()=>view.getVisible(),'page shown after open');
            assert.equal(browser.state().url,site+'/');
            await click('Bookmarks');await fill('Bookmark name','QA removable');await fill('Bookmark address','https://example.com/removable');await click('Save bookmark');
            await until(()=>store.list().bookmarks.some(b=>b.title==='QA removable'),'removable save');
            await fill('Search bookmarks','QA removable');await until(()=>js("document.querySelectorAll('.bookmark-row').length===1"),'removable row');
            await click('Remove');await until(()=>!store.list().bookmarks.some(b=>b.title==='QA removable'),'removed bookmark');
            await fill('Search bookmarks','QA persisted edit');
            win.setContentSize(780,900);await sleep(150);
            const geometry=await js("(()=>{const e=document.querySelector('.browser-bookmarks');return {width:e.clientWidth,scroll:e.scrollWidth,body:document.documentElement.clientWidth,bodyScroll:document.documentElement.scrollWidth};})()");
            assert(geometry.scroll<=geometry.width+1,JSON.stringify(geometry));assert(geometry.bodyScroll<=geometry.body+1,JSON.stringify(geometry));
            fs.writeFileSync(path.join(work,'bookmarks.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
            fs.writeFileSync(path.join(work,'expected.json'),JSON.stringify({count:count+1}));
        }
        await browser.dispose();win.destroy();await vite.httpServer.close();clearTimeout(timeout);app.exit(0);
    }).catch(async error=>{console.error(error);try{await browser?.dispose();win?.destroy();vite?.httpServer.close();}catch{}clearTimeout(timeout);app.exit(1);});
}
