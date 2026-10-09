// Real native views, host renderer, preload and named IPC in a disposable profile.
// The host clock advances deterministically; no production timeout is shortened.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
if(!process.versions.electron) {
    const {spawn,spawnSync}=require('node:child_process');
    const work=fs.mkdtempSync(path.join(os.tmpdir(),'law-tabs-qa-'));
    (async()=>{
        const encode=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30',
            '-t','3','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-threads','2','-movflags','+faststart',path.join(work,'clip.mp4')],{windowsHide:true,encoding:'utf8'});
        if(encode.status!==0)throw Error(encode.stderr || encode.error?.message || 'Fixture encoding failed');
        const {build}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
        await build({configFile:false,plugins:[react()],root,base:'./',build:{outDir:path.join(work,'renderer'),emptyOutDir:true,
            rollupOptions:{input:path.join(root,'tests/fixtures/viewerBrowser.html')}}});
        for(const phase of ['write','read'])await new Promise((resolve,reject)=>{
            const env={...process.env,LAW_TABS_QA_WORK:work,LAW_TABS_QA_PHASE:phase};delete env.ELECTRON_RUN_AS_NODE;
            const child=spawn(require('electron'),[__filename],{env,windowsHide:true,stdio:'inherit'});
            child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`Tabs ${phase} QA failed (${code})`)));
        });
        console.log(JSON.stringify({ok:true,artifacts:work,checks:['Multiple native views and renderer tab controls','Exact two-minute host deadline',
            'Playing video and open response stream stop on suspension','Reselect before deadline keeps renderer; discard recreates it',
            'Login cookie and local storage retained','Independent navigation/history and stale source rejection',
            'Tab changes pause workflows and reject old page references',
            'Keyboard shortcuts from both host and remote page','Close one tab, profile change, privacy clearing and shutdown',
            'Saved timeout restored by a separate Electron launch','Narrow layout and suspended label']},null,2));
    })().catch(error=>{console.error(error);process.exitCode=1;});
} else {
    const http=require('node:http'),{app,BrowserWindow,WebContentsView,session,ipcMain}=require('electron');
    const {createViewerBrowser}=require('../electron/viewerBrowser');
    const work=process.env.LAW_TABS_QA_WORK,phase=process.env.LAW_TABS_QA_PHASE,profile=path.join(work,'profile');
    app.setPath('userData',profile);app.commandLine.appendSwitch('host-resolver-rules','MAP tabs.example.com 127.0.0.1');app.commandLine.appendSwitch('no-proxy-server');
    let win,browser,vite,server,clock=0,nextTimer=0;const timers=new Map(),views=[],streams=new Map();
    const tabClock={now:()=>clock,setTimer:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,due:clock+delay});return id;},clearTimer:id=>timers.delete(id)};
    function advance(ms){clock+=ms;for(let n=0;n<100;n++){const entry=[...timers].find(([,t])=>t.due<=clock);if(!entry)return;timers.delete(entry[0]);entry[1].fn();}throw Error('Timer did not settle');}
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    async function until(fn,label){const end=Date.now()+18000;while(Date.now()<end){if(await fn())return;await sleep(50);}throw Error(`Timed out: ${label}`);}
    const timeout=setTimeout(()=>{console.error('Tabs QA timed out');app.exit(1);},90000);
    app.whenReady().then(async()=>{
        server=http.createServer((req,res)=>{
            const url=new URL(req.url,'http://fixture');
            if(url.pathname==='/stream') {
                const key=url.searchParams.get('tab');streams.set(key,(streams.get(key)||0)+1);
                res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});res.write('data: open\n\n');
                const tick=setInterval(()=>res.write('data: tick\n\n'),50);
                res.on('close',()=>{clearInterval(tick);streams.set(key,(streams.get(key)||1)-1);});return;
            }
            if(url.pathname==='/clip.mp4'){res.setHeader('Content-Type','video/mp4');return fs.createReadStream(path.join(work,'clip.mp4')).pipe(res);}
            const label=url.pathname.slice(1)||'A';
            res.setHeader('Content-Type','text/html');res.end(`<!doctype html><title>Tab ${label}</title><h1>Owned tab ${label}</h1>
                <a href="/A2">Next page</a><button aria-label="Current account">Fixture account</button><input aria-label="Unsaved entry">
                <video muted controls loop src="/clip.mp4"></video><script>window.connection=new EventSource('/stream?tab=${label}');</script>`);
        });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
        const site=`http://tabs.example.com:${server.address().port}`;
        const {preview}=await import('vite');vite=await preview({configFile:false,root,build:{outDir:path.join(work,'renderer')},preview:{host:'127.0.0.1',port:0}});
        const host=`http://127.0.0.1:${vite.httpServer.address().port}`;
        win=new BrowserWindow({show:false,width:1250,height:960,webPreferences:{preload:path.join(root,'electron/preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
        const TestView=class extends WebContentsView{constructor(options){super(options);this.qaContents=this.webContents;views.push(this);}};
        browser=createViewerBrowser({WebContentsView:TestView,session,getWindow:()=>win,profileDirectory:profile,tabClock,
            dialog:{showMessageBox:async()=>({response:1})},allowRequest:raw=>{try{return new URL(raw).origin===site;}catch{return false;}}});
        const trusted=event=>!win.isDestroyed() && event.sender===win.webContents && event.senderFrame===win.webContents.mainFrame && event.senderFrame.url.startsWith(host+'/');
        ipcMain.on('app:connection',event=>{event.returnValue=trusted(event)?{}:null;});
        ipcMain.handle('app:startup-status',()=>({state:'ready'}));ipcMain.handle('app:capabilities',()=>({features:{}}));ipcMain.handle('sound-mixer:configure',()=>({applied:true}));
        for(const action of ['start','state','place','navigate','inspect','source','command','clearData','profiles','createProfile','selectProfile',
            'createTab','selectTab','closeTab','shortcut','setTabSettings','startWorkflow','browserTool','workflowState','cancelWorkflow','resumeWorkflow','clearWorkflowMedia'])
            ipcMain.handle(`viewer-browser:${action}`,async(event,value)=>{if(!trusted(event))return {error:'Desktop access required.'};try{return await browser[action](value);}catch(error){return {error:error.message};}});
        const js=code=>win.webContents.executeJavaScript(code);
        async function click(label){await until(()=>js(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()===${JSON.stringify(label)} && e.getClientRects().length && !e.disabled)`),`button ${label}`);
            await js(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)} && e.getClientRects().length && !e.disabled);b.click();})()`);}
        const fill=(label,value)=>js(`(()=>{const e=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        async function clickTab(index){await until(()=>js(`!!document.querySelectorAll('[role=tablist] [role=tab]')[${index}]`),'tab button');await js(`document.querySelectorAll('[role=tablist] [role=tab]')[${index}].click()`);}
        async function page(label){await fill('Page address',`${site}/${label}`);await click('Go');await until(()=>browser.state().title===`Tab ${label}` && !browser.state().loading,`page ${label}`);}
        await win.loadURL(`${host}/tests/fixtures/viewerBrowser.html`);await until(()=>browser.state().ready,'browser startup');
        if(phase==='read') {
            assert.equal(browser.state().tabSettings.inactiveMinutes,5);assert.equal(browser.state().tabs.length,1);
            assert.equal(browser.state().url,'about:blank');await click('Tab settings');
            await until(()=>js(`document.querySelector('[aria-label="Inactive tab timeout in minutes"]')?.value==='5'`),'restored settings input');
        } else {
            assert.equal(browser.state().tabSettings.inactiveMinutes,2);
            await page('A');const firstId=browser.state().activeTabId,firstView=views[0],first=firstView.webContents;
            await until(()=>streams.get('A')===1,'first stream');assert.equal(await first.executeJavaScript('typeof workstationDesktop'),'undefined');
            await first.executeJavaScript("document.cookie='tabLogin=retained; path=/; max-age=86400';localStorage.setItem('tabValue','retained');document.querySelector('input').value='draft';document.querySelector('video').play()",true);
            await until(()=>first.executeJavaScript("!document.querySelector('video').paused && document.querySelector('video').currentTime>0"),'playing native video');
            const inspected=await browser.inspect(),sourceId=inspected.items[0].id;
            await click('+ New tab');await until(()=>browser.state().tabs.length===2,'second tab');const secondId=browser.state().activeTabId;
            assert.notEqual(firstId,secondId);assert(!firstView.getVisible());assert(first.getBackgroundThrottling());
            await assert.rejects(()=>browser.source(sourceId),/Inspect the current page/);
            await page('B');const second=views[1].webContents;await until(()=>streams.get('B')===1,'second stream');
            const revision=browser.state().revision;await first.executeJavaScript("document.title='Tab A background';history.replaceState({},'', '/A?updated=1')");
            await until(()=>browser.state().tabs[0].title==='Tab A background','background title');assert.equal(browser.state().title,'Tab B');assert.equal(browser.state().revision,revision);
            advance(90000);await clickTab(0);await until(()=>browser.state().activeTabId===firstId,'reselected first');
            assert.equal(views.length,2);assert.equal(await first.executeJavaScript("document.querySelector('input').value"),'draft');
            await browser.navigate(`${site}/A2`);await until(()=>browser.state().title==='Tab A2'&&!browser.state().loading,'first independent history');assert(browser.state().back);
            await browser.command('back');await until(()=>browser.state().url.includes('/A?updated=1')&&!browser.state().loading,'back within first tab');
            await first.executeJavaScript("document.querySelector('video').play()",true);
            await clickTab(1);await until(()=>browser.state().activeTabId===secondId,'second selected');assert.equal(browser.state().url,`${site}/B`);assert(!browser.state().back);
            advance(119999);assert(!first.isDestroyed());advance(1);await until(()=>first.isDestroyed() && streams.get('A')===0,'inactive renderer and stream closed');
            assert(browser.state().tabs[0].suspended);assert(!second.isDestroyed());assert.equal(browser.state().activeTabId,secondId);
            await until(()=>js("document.querySelector('[role=tablist]').textContent.includes('Suspended')"),'visible suspended label');
            win.setContentSize(780,960);await sleep(200);
            fs.writeFileSync(path.join(work,'suspended-tabs.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
            win.setContentSize(1250,960);
            await clickTab(0);await until(()=>browser.state().activeTabId===firstId && !browser.state().loading,'restored first');
            const restored=views.at(-1).webContents;assert.notEqual(restored,first);assert.equal(browser.state().url,`${site}/A?updated=1`);
            assert.equal(await restored.executeJavaScript("localStorage.getItem('tabValue')"),'retained');assert((await restored.executeJavaScript('document.cookie')).includes('tabLogin=retained'));
            assert.equal(await restored.executeJavaScript("document.querySelector('input').value"),'');assert(!browser.state().back);
            await click('Tab settings');await fill('Inactive tab timeout in minutes','0');await click('Save tab settings');
            await until(()=>browser.state().tabSettings.inactiveMinutes===0,'disabled suspension');advance(600000);assert(!second.isDestroyed());
            await js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'t',ctrlKey:true,bubbles:true,cancelable:true}))");await until(()=>browser.state().tabs.length===3,'host Ctrl+T');
            await js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'w',ctrlKey:true,bubbles:true,cancelable:true}))");await until(()=>browser.state().tabs.length===2,'host Ctrl+W');
            await clickTab(0);await until(()=>browser.state().activeTabId===firstId,'first before remote shortcut');
            restored.sendInputEvent({type:'keyDown',keyCode:'Tab',modifiers:['control']});restored.sendInputEvent({type:'keyUp',keyCode:'Tab',modifiers:['control']});
            await until(()=>browser.state().activeTabId===secondId,'remote Ctrl+Tab');
            await js("document.querySelector('[aria-label=\"Close tab 1\"]').click()");await until(()=>browser.state().tabs.length===1 && restored.isDestroyed(),'close background tab');assert(!second.isDestroyed());
            await page('B2');await until(()=>streams.get('B')===0,'old document stream closed');
            win.setContentSize(780,960);await sleep(200);
            const geometry=await js("(()=>{const e=document.querySelector('.browser-tabs');return {width:e.clientWidth,scroll:e.scrollWidth,body:document.documentElement.clientWidth,bodyScroll:document.documentElement.scrollWidth};})()");
            assert(geometry.bodyScroll<=geometry.body+1,JSON.stringify(geometry));
            fs.writeFileSync(path.join(work,'tabs.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
            const other=browser.createProfile('QA isolated account');
            await Promise.all([browser.createTab(`${site}/BeforeProfile`),browser.selectProfile(other.id)]);
            await until(()=>second.isDestroyed(),'profile switch closes tabs');assert.equal(browser.state().tabs.length,1);assert.equal(browser.state().url,'about:blank');
            await browser.navigate(`${site}/Other`);await until(()=>!browser.state().loading,'other profile');const isolated=views.at(-1).webContents;
            assert.equal(await isolated.executeJavaScript("localStorage.getItem('tabValue')"),null);assert(!(await isolated.executeJavaScript('document.cookie')).includes('tabLogin=retained'));
            await browser.selectProfile('default');await until(()=>isolated.isDestroyed(),'isolated tab closed');await browser.navigate(`${site}/A`);await until(()=>!browser.state().loading,'original profile');
            const original=views.at(-1).webContents;assert.equal(await original.executeJavaScript("localStorage.getItem('tabValue')"),'retained');
            const workflow=await browser.startWorkflow({profileId:'default'});
            await browser.createTab(`${site}/Clear`);await until(()=>!browser.state().loading,'clear-data tab');
            assert.equal(browser.state().workflow.status,'paused');assert.equal(browser.state().workflow.reason,'tab_changed');
            await assert.rejects(()=>browser.browserTool({workflowId:workflow.workflowId,action:'read'}),/tab_changed/);
            await browser.cancelWorkflow({workflowId:workflow.workflowId});await browser.clearData('cache');
            assert.equal(browser.state().tabs.length,0);await until(()=>views.every(view=>view.qaContents.isDestroyed()),'privacy clearing closes every renderer');
            browser.setTabSettings({inactiveMinutes:5});assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile,'browser-tab-settings.json'),'utf8')),{inactiveMinutes:5});
            assert.equal(browser.state().selected,'default');
        }
        if(phase==='read')win.destroy();
        await browser.dispose();assert.equal(timers.size,0);await until(()=>views.every(view=>view.qaContents.isDestroyed()),'shutdown closes renderers');if(!win.isDestroyed())win.destroy();
        await vite.httpServer.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));clearTimeout(timeout);app.exit(0);
    }).catch(async error=>{console.error(error);try{await browser?.dispose();win?.destroy();vite?.httpServer.close();server?.closeAllConnections();server?.close();}catch{}clearTimeout(timeout);app.exit(1);});
}
