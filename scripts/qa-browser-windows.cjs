// Owned local pages and disposable profiles only; no live backend or user data.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=fs.realpathSync(path.resolve(__dirname,'..'));
if(!process.versions.electron) {
    (async()=>{
        const {spawn,spawnSync}=require('node:child_process'),work=fs.mkdtempSync(path.join(os.tmpdir(),'law-browser-windows-'));
        const encoded=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-t','4',
            '-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-threads','1','-movflags','+faststart',path.join(work,'clip.mp4')],{windowsHide:true,encoding:'utf8'});
        if(encoded.status!==0)throw Error(encoded.stderr || 'Fixture video encoding failed');
        const {build}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
        await build({configFile:false,plugins:[react()],root,base:'./',build:{outDir:path.join(work,'renderer'),emptyOutDir:true,
            rollupOptions:{input:path.join(root,'tests/fixtures/viewerBrowser.html')}}});
        const reservation=require('node:net').createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
        const fixturePort=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
        const env={...process.env,LAW_BROWSER_WINDOWS_QA:work,LAW_BROWSER_WINDOWS_QA_PORT:String(fixturePort)};delete env.ELECTRON_RUN_AS_NODE;
        await new Promise((resolve,reject)=>{const child=spawn(require('electron'),[__filename],{env,windowsHide:true,stdio:'inherit'});
            child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`Browser windows QA failed (${code})`)));});
        console.log(JSON.stringify({ok:true,artifacts:work},null,2));
    })().catch(error=>{console.error(error);process.exitCode=1;});
} else {
    const http=require('node:http'),{app,BrowserWindow,WebContentsView,session,ipcMain}=require('electron');
    const {createViewerBrowser}=require('../electron/viewerBrowser'),{createBrowserWindows}=require('../electron/browserWindows');
    const work=process.env.LAW_BROWSER_WINDOWS_QA,profile=path.join(work,'profile');
    app.setPath('userData',profile);app.commandLine.appendSwitch('host-resolver-rules','MAP windows.example.com 127.0.0.1');app.commandLine.appendSwitch('no-proxy-server');
    // Secure-context permission checks on this owned HTTP fixture only. This
    // switch never appears in the production launcher or browser controller.
    app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure',`http://windows.example.com:${process.env.LAW_BROWSER_WINDOWS_QA_PORT}`);
    let win,browser,windows,server,vite;const extra=[],controllers=[],views=[],prompts=[],checks=[];
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    async function until(fn,label){const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await sleep(40);}throw Error(`Timed out: ${label}`);}
    const timeout=setTimeout(()=>{console.error('Browser windows QA timed out');app.exit(1);},90000);
    app.whenReady().then(async()=>{
        server=http.createServer((req,res)=>{
            if(req.url==='/clip.mp4'){res.setHeader('Content-Type','video/mp4');return fs.createReadStream(path.join(work,'clip.mp4')).pipe(res);}
            res.setHeader('Content-Type','text/html');res.end(`<!doctype html><title>Page ${req.url}</title><input aria-label="Draft"><a href="/next">Next</a><video controls muted loop src="/clip.mp4"></video>`);
        });await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(process.env.LAW_BROWSER_WINDOWS_QA_PORT),'127.0.0.1',resolve);});
        const site=`http://windows.example.com:${server.address().port}`;
        const {preview}=await import('vite');vite=await preview({configFile:false,root,build:{outDir:path.join(work,'renderer')},preview:{host:'127.0.0.1',port:0}});
        const host=`http://127.0.0.1:${vite.httpServer.address().port}`;
        win=new BrowserWindow({show:false,width:1250,height:900,webPreferences:{preload:path.join(root,'electron/preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
        const profiles=require('../electron/browserProfiles').createBrowserProfiles(profile);
        const makeBrowser=options=>createViewerBrowser({session,profileDirectory:profile,...options,
            WebContentsView:class extends WebContentsView{constructor(value){super(value);this.qaHost=options.getWindow();this.qaContents=this.webContents;views.push(this);}},
            dialog:{showMessageBox:async parent=>{prompts.push(parent);return {response:1};}},
            allowRequest:raw=>{try{return new URL(raw).origin===site;}catch{return false;}}});
        windows=createBrowserWindows({BrowserWindow:class extends BrowserWindow{constructor(options){super(options);extra.push(this);}},profileRegistry:profiles,
            getMainWindow:()=>win,devUrl:host,createBrowser:options=>{const controller=makeBrowser(options);controllers.push(controller);return controller;}});
        browser=makeBrowser({getWindow:()=>win,profileRegistry:profiles,beforeClearProfile:id=>windows.closeProfile(id)});
        const trusted=event=>!win.isDestroyed()&&event.sender===win.webContents&&event.senderFrame===win.webContents.mainFrame&&event.senderFrame.url.startsWith(host+'/');
        ipcMain.on('app:connection',event=>{event.returnValue=trusted(event)?{}:null;});
        for(const channel of ['app:startup-status','app:capabilities','sound-mixer:configure'])ipcMain.handle(channel,()=>({state:'ready',features:{},applied:true}));
        ipcMain.handle('browser-window:new',async event=>{const owner=trusted(event)?browser:windows.controller(event);
            if(!owner)return {error:'Desktop access required.'};try{return await windows.open(owner);}catch(error){return {error:error.message};}});
        for(const action of ['start','state','place','navigate','inspect','source','command','clearData','profiles','createProfile','selectProfile','createTab','selectTab','closeTab','shortcut','setTabSettings'])
            ipcMain.handle(`viewer-browser:${action}`,async(event,value)=>{const main=trusted(event),owner=main?browser:windows.controller(event);
                if(!owner||!main&&!windows.allows(action))return {error:'Desktop access required.'};try{return await owner[action](value);}catch(error){return {error:error.message};}});
        const bookmarks=require('../electron/browserBookmarks');bookmarks.registerBrowserBookmarkIpc({ipcMain,store:bookmarks.createBrowserBookmarks(profile),
            trustedDesktop:event=>trusted(event)||windows.trusted(event),dialog:{},getWindow:event=>windows.windowFor(event)||win});
        const js=(window,code)=>window.webContents.executeJavaScript(code);
        async function page(window,controller,label){await js(window,`workstationDesktop.navigateViewerBrowser(${JSON.stringify(site+'/'+label)})`);
            await until(()=>controller.state().title===`Page /${label}`&&!controller.state().loading,label);return views.filter(view=>view.qaHost===window).at(-1);}
        await win.loadURL(`${host}/tests/fixtures/viewerBrowser.html`);win.showInactive();await until(()=>browser.state().ready,'main Browser');
        const mainView=await page(win,browser,'Main'),mainPage=mainView.webContents;
        await mainPage.executeJavaScript("document.cookie='windowLogin=shared; path=/; max-age=86400';localStorage.setItem('login','shared');document.querySelector('input').value='main draft';document.querySelector('video').play()",true);
        await until(()=>js(win,"[...document.querySelectorAll('button')].some(b=>b.textContent==='New window')"),'New window button');
        await js(win,"[...document.querySelectorAll('button')].find(b=>b.textContent==='New window').click()");
        await until(()=>controllers[0]?.state().ready,'first extra window');
        const first=extra[0],firstBrowser=controllers[0],firstView=await page(first,firstBrowser,'First'),firstPage=firstView.webContents;
        assert.equal(browser.state().url,site+'/Main');
        const authority=await js(first,"({browserWindow:workstationDesktop.browserWindow,connection:'connection' in workstationDesktop,picker:'pickFiles' in workstationDesktop,workflow:'startBrowserWorkflow' in workstationDesktop,clear:'clearViewerBrowserData' in workstationDesktop})");
        assert.deepEqual(authority,{browserWindow:true,connection:false,picker:false,workflow:false,clear:false});
        assert.equal(await firstPage.executeJavaScript('typeof workstationDesktop'),'undefined');checks.push('Browser-only preload and remote page isolation');
        assert.equal(await firstPage.executeJavaScript("localStorage.getItem('login')"),'shared');
        assert((await firstPage.executeJavaScript('document.cookie')).includes('windowLogin=shared'));checks.push('Shared profile cookie and site storage');
        await firstPage.executeJavaScript("document.querySelector('input').value='first draft';document.querySelector('video').play()",true);
        await js(first,"window.dispatchEvent(new KeyboardEvent('keydown',{key:'n',ctrlKey:true,bubbles:true,cancelable:true}))");
        await until(()=>controllers[1]?.state().ready,'host Ctrl+N');
        const second=extra[1],secondBrowser=controllers[1],secondView=await page(second,secondBrowser,'Second'),secondPage=secondView.webContents;
        await secondPage.executeJavaScript("document.querySelector('video').play()",true);
        const pages=[mainPage,firstPage,secondPage];
        await until(()=>Promise.all(pages.map(wc=>wc.executeJavaScript("!document.querySelector('video').paused&&document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames>0"))).then(values=>values.every(Boolean)),'three playing videos');
        await until(()=>[mainView,firstView,secondView].every(view=>view.getVisible()),'three visible native pages');
        const frames=await Promise.all(pages.map(wc=>wc.executeJavaScript("document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames")));
        await until(()=>Promise.all(pages.map((wc,i)=>wc.executeJavaScript(`document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames>${frames[i]}`))).then(values=>values.every(Boolean)),'all videos keep decoding');
        checks.push('Three independent visible windows with concurrent native video playback');
        // Accept the permission prompt; the fixture has no location provider.
        for(const wc of pages)await wc.executeJavaScript('new Promise(resolve=>navigator.geolocation.getCurrentPosition(()=>resolve(true),()=>resolve(false),{timeout:1000}))');
        assert.deepEqual(prompts.slice(-3),[win,first,second]);checks.push('Shared-session permissions prompt the correct owning window');
        await js(first,`workstationDesktop.saveBrowserBookmark({title:'Shared bookmark',url:${JSON.stringify(site+'/First')}})`);
        assert((await js(win,'workstationDesktop.browserBookmarks()')).bookmarks.some(b=>b.title==='Shared bookmark'));
        const original=firstBrowser.state().activeTabId;await js(first,`workstationDesktop.createViewerBrowserTab(${JSON.stringify(site+'/SecondTab')})`);
        await until(()=>firstBrowser.state().tabs.length===2&&!firstBrowser.state().loading,'second page tab');
        assert.equal(browser.state().tabs.length,1);assert.equal(secondBrowser.state().tabs.length,1);
        await js(first,`workstationDesktop.selectViewerBrowserTab(${JSON.stringify(original)})`);
        assert.equal(await firstPage.executeJavaScript("document.querySelector('input').value"),'first draft');
        assert.equal(await mainPage.executeJavaScript("document.querySelector('input').value"),'main draft');
        const secondHistory={url:secondBrowser.state().url,back:secondBrowser.state().back,revision:secondBrowser.state().revision};
        await firstBrowser.navigate(site+'/FirstHistory');await until(()=>!firstBrowser.state().loading,'first window history');
        assert(firstBrowser.state().back);assert.deepEqual({url:secondBrowser.state().url,back:secondBrowser.state().back,revision:secondBrowser.state().revision},secondHistory);
        checks.push('Independent tabs, drafts, history and shared bookmarks');
        await firstBrowser.command('back');await until(()=>!firstBrowser.state().loading,'back to first page');
        firstPage.sendInputEvent({type:'keyDown',keyCode:'N',modifiers:['control']});firstPage.sendInputEvent({type:'keyUp',keyCode:'N',modifiers:['control']});
        await until(()=>controllers[2]?.state().ready,'remote Ctrl+N');extra[2].close();await until(()=>extra[2].isDestroyed(),'close third extra window');
        assert(pages.every(wc=>!wc.isDestroyed()));checks.push('Host and remote Ctrl+N; closing one preserves the others');
        await js(first,"document.querySelector('[aria-label=\"Browser information\"]').click()");
        await until(()=>!firstView.getVisible(),'information dialog hides its native page');assert(mainView.getVisible()&&secondView.getVisible());
        await js(first,"document.querySelector('[aria-label=\"Close Browser information\"]').click()");await until(()=>firstView.getVisible(),'information closes');
        first.setContentSize(480,700);await sleep(120);assert(await js(first,'document.documentElement.scrollWidth<=document.documentElement.clientWidth+1'));
        const nativeBounds=firstView.getBounds(),[width,height]=first.getContentSize();
        assert(nativeBounds.x>=0&&nativeBounds.y>=0&&nativeBounds.x+nativeBounds.width<=width&&nativeBounds.y+nativeBounds.height<=height);
        fs.writeFileSync(path.join(work,'browser-window.png'),(await first.webContents.capturePage()).toPNG());checks.push('Information dialog isolation and narrow window layout');
        fs.writeFileSync(path.join(work,'browser-native-page.png'),(await firstPage.capturePage(undefined,{stayAwake:true})).toPNG());
        const account=await js(first,"workstationDesktop.createViewerBrowserProfile('Window account')");await js(first,`workstationDesktop.selectViewerBrowserProfile(${JSON.stringify(account.id)})`);
        assert.equal(browser.state().selected,'default');assert.equal(secondBrowser.state().selected,'default');assert.equal(firstBrowser.state().selected,account.id);
        assert(!mainPage.isDestroyed()&&!secondPage.isDestroyed());await browser.clearData('cache');await until(()=>second.isDestroyed(),'clearing closes matching-profile windows');assert(!first.isDestroyed());
        checks.push('Profile selection is local; confirmed clearing closes only matching-profile windows');
        await windows.dispose();await browser.dispose();assert(views.every(view=>view.qaContents.isDestroyed()));win.destroy();
        checks.push('Application shutdown disposes every native page and extra window');
        fs.writeFileSync(path.join(work,'result.json'),JSON.stringify({ok:true,checks},null,2));console.log(JSON.stringify({ok:true,checks},null,2));
        await vite.httpServer.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));clearTimeout(timeout);app.exit(0);
    }).catch(async error=>{console.error(error);fs.writeFileSync(path.join(work,'result.json'),JSON.stringify({ok:false,error:error.stack,checks},null,2));
        try{await windows?.dispose();await browser?.dispose();if(win&&!win.isDestroyed())win.destroy();vite?.httpServer.close();server?.closeAllConnections();server?.close();}catch{}clearTimeout(timeout);app.exit(1);});
}
