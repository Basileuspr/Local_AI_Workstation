const {randomUUID} = require('node:crypto');
const {createNativeMixer} = require('./soundMixer');
const {browserUrl,allowedBrowserRequest} = require('./browserPolicy');
const {REMOTE_PREFERENCES,installBrowserSession,originOf} = require('./browserSession');
const {createBrowserProfiles} = require('./browserProfiles');
const {createBrowserWorkflows,checkpointMatches,sourceIdentity} = require('./browserWorkflows');
const {placeBrowserView} = require('./browserPlacement');
const {createBrowserPlaybackPriority} = require('./browserPlaybackPriority');
const {createBrowserTabs} = require('./browserTabs');
const MAX_SOURCE = 2 * 1024 * 1024, MAX_RESOURCES = 200;

// Fixed, read-only inspection in an isolated world. Remote pages never receive
// the host preload, tokens, filesystem access, or an arbitrary-evaluation IPC.
function inspectDocument() {
    const limit = 2 * 1024 * 1024, cap = 100;
    let budget = 8 * 1024 * 1024;
    const items = [];
    function add(kind, name, text) {
        const length = Math.min(limit, budget);
        if (length <= 0) return;
        items.push({kind, name, text:text.slice(0,length), truncated:text.length > length});
        budget -= Math.min(text.length,length);
    }
    add('html', 'Rendered HTML', '<!doctype html>\n' + (document.documentElement?.outerHTML || ''));
    Array.from(document.querySelectorAll('style')).slice(0,cap).forEach((node,index)=>add('css',`Inline style ${index+1}`,node.textContent || ''));
    Array.from(document.querySelectorAll('script:not([src])')).slice(0,cap).forEach((node,index)=>add('js',`Inline script ${index+1}${node.type ? ` (${node.type})` : ''}`,node.textContent || ''));
    return items;
}

function createViewerBrowser({WebContentsView, session, getWindow, dialog, allowRequest, watchFind, profileDirectory, profileRegistry, workflowDirectory, prepareMedia, cancelMedia, tabClock, beforeClearProfile}) {
    const mixer=createNativeMixer('browser');
    let view=null, isolated=null, starting=null, placement={visible:false}, revision=0, error='', notice='', popup=null, inspection=null;
    const resources=new Map(), sources=new Map();
    const owned=new Set(), popups=new Set();
    const views=new Map(), popupTabs=new Map();
    let tabOperations=Promise.resolve(),disposed=false;
    function enqueueTab(work){const result=tabOperations.then(()=>{if(disposed)throw Error('The browser is closed.');return work();});tabOperations=result.catch(()=>{});return result;}
    let sessionPolicy=null, clearing=null, switching=null;
    const playbackPriority=createBrowserPlaybackPriority({isVisible:wc=>{
        const win=getWindow();return wc===contents() && !!view?.getVisible() && !!win && win.isVisible() && !win.isMinimized();
    }});
    const profiles=profileRegistry || createBrowserProfiles(profileDirectory), sessions=new Map();
    const workflows=createBrowserWorkflows({getContents:contents,getProfileId:()=>profiles.selected().id,getRevision:()=>revision,
        storagePath:workflowDirectory,allowRequest,prepareMedia,cancelMedia,stopPage:()=>close(),restorePage:restoreWorkflowPage});
    const tabs=createBrowserTabs({directory:profileDirectory,...tabClock,onSuspend:tab=>destroyTabView(tab.id)});
    function profile() {
        if(!isolated) {
            const id=profiles.selected().id;
            let entry=sessions.get(id);
            if(!entry) {
                const ses=session.fromPartition(profiles.partition(id));
                entry={ses,policy:installBrowserSession({browserSession:ses,owned,getWindow,dialog,allowRequest,notify:message=>{notice=message;}})};
                sessions.set(id,entry);
            }
            isolated=entry.ses;sessionPolicy=entry.policy;
        }
        return isolated;
    }
    function secureContents(wc,tabId) {
        const policy=sessionPolicy, contentsSession=wc.session;
        mixer.watch(wc);
        playbackPriority.watch(wc,getWindow());
        owned.add(wc);
        wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
        wc.setWindowOpenHandler(({url})=>{
            if((url!=='about:blank' && !browserUrl(url)) || popups.size>=4 || clearing) return {action:'deny'};
            return {action:'allow',overrideBrowserWindowOptions:{width:760,height:720,autoHideMenuBar:true,
                webPreferences:{...REMOTE_PREFERENCES,session:contentsSession,preload:undefined}}};
        });
        wc.on('did-create-window',win=>{
            if(wc===contents())workflows.pause('login_window_opened');
            popups.add(win);popupTabs.set(win,tabId);win.setMenu(null);secureContents(win.webContents,tabId);
            const label=()=>{if(!win.isDestroyed())win.setTitle(`Website window — ${originOf(win.webContents.getURL()) || 'Opening…'}`);};
            win.on('page-title-updated',event=>{event.preventDefault();label();});
            win.webContents.on('did-navigate',label);label();
            win.on('closed',()=>{popups.delete(win);popupTabs.delete(win);});
        });
        const guard=(event,url)=>{if((!browserUrl(url) && url!=='about:blank') || wc===contents() && !workflows.allowNavigation(url))event.preventDefault();};
        wc.on('will-navigate',guard);wc.on('will-redirect',guard);
        wc.on('will-frame-navigate',event=>guard(event,event.url));
        wc.on('will-attach-webview',event=>event.preventDefault());
        wc.on('select-bluetooth-device',(event,devices,callback)=>{event.preventDefault();callback('');});
        wc.on('did-start-navigation',(_event,_url,inPlace,mainFrame)=>{if(mainFrame && !inPlace)policy.revoke(wc);});
        wc.once('destroyed',()=>{owned.delete(wc);policy.revoke(wc);});
    }
    function contents() {const wc=view?.webContents;return wc && !wc.isDestroyed() ? wc : null;}
    function invalidate() {revision++; resources.clear(); sources.clear(); inspection=null; error=''; popup=null; notice='';}
    function state() {
        const wc=contents(),tab=tabs.active();
        return {ready:!!wc,url:tab?.url || '',title:tab?.title || '',loading:wc?.isLoading() || false,
            back:wc?.navigationHistory.canGoBack() || false,forward:wc?.navigationHistory.canGoForward() || false,revision,error,notice,popup,
            profilePath:isolated?.storagePath || null,persistent:true,clearing:!!clearing,
            ...profiles.list(),...tabs.list(),workflow:workflows.activeState()};
    }
    function place(value) {
        placement=value || {visible:false};
        if (!contents()) return false;
        const changed=placeBrowserView(view,getWindow(),placement);playbackPriority.sync();return changed;
    }
    async function start(fromSwitch=false) {
        if(disposed)throw Error('The browser is closed.');
        if(switching && !fromSwitch)return switching;
        if(clearing)await clearing;
        if(starting)return starting;
        if (contents()) return state();
        starting=initialize();
        try{return await starting;}catch(failure){close();throw failure;}finally{starting=null;}
    }
    async function initialize() {
        const tab=tabs.active() || tabs.create();
        const loading=openTabView(tab);place(placement);
        await loading;
        return state();
    }
    function openTabView(tab) {
        const existing=views.get(tab.id);
        if(existing?.webContents && !existing.webContents.isDestroyed()){view=existing;return Promise.resolve();}
        if(existing)destroyTabView(tab.id);
        const tabView=new WebContentsView({webPreferences:{...REMOTE_PREFERENCES,session:profile()}});
        views.set(tab.id,tabView);view=tabView;
        tabView.setVisible(false);getWindow().contentView.addChildView(tabView);
        const wc=tabView.webContents,live=()=>views.get(tab.id)===tabView && !wc.isDestroyed();
        watchFind?.(wc,'browser');
        secureContents(wc,tab.id);
        wc.on('did-start-navigation',(_event,url,inPlace,mainFrame)=>{if(mainFrame && live()){
            tabs.update(tab.id,{url});tab.error='';
            if(wc===contents()){invalidate();workflows.navigation(url);}
        }});
        const update=()=>{if(live())tabs.update(tab.id,{url:wc.getURL(),title:wc.getTitle()});};
        wc.on('did-navigate',update);wc.on('did-navigate-in-page',update);wc.on('page-title-updated',update);wc.on('did-stop-loading',update);
        wc.on('did-fail-load',(_event,code,description,_url,mainFrame)=>{if(mainFrame && code!==-3 && live()){
            tab.error=`Could not load this page (${description}).`;if(wc===contents())error=tab.error;
        }});
        wc.on('render-process-gone',()=>{if(live()){
            tab.error='The browser stopped. Reload the tab to reopen it.';
            if(wc===contents()){workflows.pause('browser_stopped');error=tab.error;place({visible:false});}
        }});
        wc.on('before-input-event',(event,input)=>{
            if(wc===contents() && input.type==='keyDown' && (input.control || input.meta) && !input.alt && !input.shift && input.key.toLowerCase()==='n') {
                event.preventDefault();getWindow()?.webContents.send('viewer-browser:new-window');return;
            }
            if(input.type==='keyDown' && (input.key==='F6' || ((input.control || input.meta) && input.key.toLowerCase()==='l'))) {
                event.preventDefault();getWindow()?.webContents.focus();getWindow()?.webContents.send('viewer-browser:address');
            }
            const shortcut=tabShortcut(input);
            if(shortcut && wc===contents()){event.preventDefault();getWindow()?.webContents.send('viewer-browser:tab-shortcut',shortcut);}
        });
        return wc.loadURL(tab.url).catch(failure=>{
            if(live() && failure.code!=='ERR_ABORTED'){tab.error='Could not load this page. Check its address or connection.';if(wc===contents())error=tab.error;}
        });
    }
    async function navigate(value,waitForLoad=false) {
        workflows.pause('manual_navigation');
        const url=browserUrl(value,{input:true});
        if(!url)throw new Error('Enter a public HTTP or HTTPS address. Local app and private-network pages are not supported.');
        await start();error='';
        const wc=contents(),tab=tabs.active();tabs.update(tab.id,{url,title:''});tab.error='';
        const loading=wc.loadURL(url);
        void loading.catch(failure=>{if(failure.code!=='ERR_ABORTED' && views.get(tab.id)?.webContents===wc){tab.error='Could not load this page. Check its address or connection.';if(wc===contents())error=tab.error;}});
        if(waitForLoad) {
            let timer;
            try{await Promise.race([loading,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Saved-page navigation timed out. Try again after checking the connection.')),15000);})]);}
            catch{if(wc===contents()&&!wc.isDestroyed())wc.stop();throw Error('The saved page could not finish loading. Check the connection and retry recovery.');}
            finally{clearTimeout(timer);}
        }
        return state();
    }
    function restoreWorkflowPage(profileId,url) {
        return enqueueTab(async()=>{
            if(profiles.selected().id!==profileId)throw Error('Select the checkpoint profile before restoring its page.');
            let permitted,timer;
            try{permitted=await Promise.race([
                allowRequest?allowRequest(url):allowedBrowserRequest(url,host=>profile().resolveHost(host)),
                new Promise(resolve=>{timer=setTimeout(()=>resolve(false),5000);}),
            ]);}finally{clearTimeout(timer);}
            if(!permitted)throw Error('The saved page destination is blocked or unavailable.');
            if(profiles.selected().id!==profileId)throw Error('The profile changed while checking the saved page.');
            const matches=tabs.list().tabs.filter(tab=>checkpointMatches(sourceIdentity(url),tab.url));
            if(matches.length===1 && matches[0].id!==tabs.active()?.id)activateTab(tabs.select(matches[0].id));
            return navigate(url,true);
        });
    }
    function destroyTabView(id) {
        const tabView=views.get(id);if(!tabView)return;
        for(const win of [...popups])if(popupTabs.get(win)===id){if(!win.isDestroyed())win.destroy();popups.delete(win);popupTabs.delete(win);}
        const win=getWindow(),wc=tabView.webContents;
        if(wc && !wc.isDestroyed())placeBrowserView(tabView,win,{visible:false});
        playbackPriority.sync();
        views.delete(id);if(view===tabView)view=null;
        if(win && !win.isDestroyed())win.contentView.removeChildView(tabView);
        if(wc && !wc.isDestroyed())wc.close({waitForBeforeUnload:false});
    }
    function activateTab(tab) {
        if(contents())placeBrowserView(view,getWindow(),{visible:false});
        invalidate();void openTabView(tab);error=tab.error || '';place(placement);
    }
    async function tabChange() {
        if(switching)await switching;if(clearing)await clearing;if(starting)await starting;
        if(workflows.busy())throw Error('Wait for the current browser operation to stop before changing tabs.');
    }
    async function createTab(value) {
        if(value!==undefined && (typeof value!=='string' || !browserUrl(value,{input:true})))throw Error('Use a public HTTP or HTTPS address for the new tab.');
        await tabChange();
        const tab=tabs.create(value===undefined?'about:blank':browserUrl(value,{input:true}));
        workflows.pause('tab_changed');activateTab(tab);return state();
    }
    async function selectTab(id) {
        await tabChange();tabs.get(id);
        if(id===tabs.active()?.id)return state();
        workflows.pause('tab_changed');activateTab(tabs.select(id));return state();
    }
    async function closeTab(id=tabs.active()?.id) {
        await tabChange();if(!id)return state();tabs.get(id);
        const wasSelected=id===tabs.active()?.id;
        if(wasSelected)workflows.pause('tab_closed');
        destroyTabView(id);const next=tabs.close(id);
        if(wasSelected){if(next)activateTab(next);else invalidate();}
        return state();
    }
    async function shortcut(action) {
        if(!['new','close','next','previous'].includes(action))throw Error('Choose an existing tab shortcut.');
        await tabChange();
        if(action==='new')return createTab();
        if(action==='close')return closeTab();
        const {tabs:list,activeTabId}=tabs.list(),index=list.findIndex(tab=>tab.id===activeTabId);
        if(list.length>1)return selectTab(list[(index+(action==='previous'?-1:1)+list.length)%list.length].id);
        return state();
    }
    async function inspect() {
        if(workflows.busy())throw new Error('Wait for the browser operation before inspecting this page.');
        const wc=contents(), version=revision;
        if(!wc || !browserUrl(wc.getURL()))throw new Error('Open a page first.');
        if(!dialog || (await dialog.showMessageBox(getWindow(),{type:'question',title:'Inspect website source',
            message:'Read source from this page?',detail:'Authenticated pages may contain private information or tokens in their HTML or scripts. Source stays in memory unless you explicitly copy or save it. Only inspect pages you intend to export.',
            buttons:['Cancel','Inspect page'],defaultId:0,cancelId:0,noLink:true})).response!==1) return {revision,items:[],pageUrl:'Inspection cancelled.'};
        if(version!==revision || wc!==contents())throw new Error('The page changed. Inspect it again.');
        const inline=await wc.executeJavaScriptInIsolatedWorld(999,[{code:`(${inspectDocument.toString()})()`}]);
        if(version!==revision)throw new Error('The page changed. Inspect it again.');
        sources.clear();
        const displayUrl=value=>{const u=new URL(value);return u.origin+u.pathname;};
        for(const item of inline) {const id=randomUUID();sources.set(id,{...item,id,url:displayUrl(wc.getURL()),revision});}
        // Read Chromium's existing resource cache only on explicit inspection. Never
        // enable Network recording or intercept headers, cookies, or request bodies.
        try {
            wc.debugger.attach('1.3');
            await wc.debugger.sendCommand('Page.enable');
            const {frameTree}=await wc.debugger.sendCommand('Page.getResourceTree');
            for(const item of (frameTree.resources || []).slice(0,MAX_RESOURCES)) {
                const kind={Stylesheet:'css',Script:'js'}[item.type];
                if(!kind || !browserUrl(item.url))continue;
                const id=randomUUID();sources.set(id,{id,kind,name:displayUrl(item.url),url:displayUrl(item.url),resourceUrl:item.url,frameId:frameTree.frame.id,revision});
            }
        } finally {if(wc.debugger.isAttached())wc.debugger.detach();}
        if(version!==revision)throw new Error('The page changed. Inspect it again.');
        inspection={revision,pageUrl:displayUrl(wc.getURL()),items:[...sources.values()].map(({text,resourceUrl,frameId,...item})=>item)};
        return inspection;
    }
    async function source(id) {
        const item=sources.get(id), wc=contents(), version=revision;
        if(!item || item.revision!==revision || !wc)throw new Error('Inspect the current page before opening a source.');
        let text=item.text, truncated=item.truncated || false;
        if(text===undefined) {
            try {
                wc.debugger.attach('1.3');
                await wc.debugger.sendCommand('Page.enable');
                const body=await wc.debugger.sendCommand('Page.getResourceContent',{frameId:item.frameId,url:item.resourceUrl});
                text=body.base64Encoded ? Buffer.from(body.content,'base64').toString('utf8') : body.content;
            } catch {throw new Error('This source is no longer in the browser cache. Reload the page and inspect it again.');}
            finally {if(wc.debugger.isAttached())wc.debugger.detach();}
            truncated=text.length>MAX_SOURCE;text=text.slice(0,MAX_SOURCE);
        }
        if(version!==revision)throw new Error('The page changed. Inspect it again.');
        return {id:randomUUID(),kind:item.kind,name:item.name,url:item.url,text,truncated};
    }
    function close() {
        playbackPriority.reset();
        workflows.pause('page_closed');
        for(const win of popups)if(!win.isDestroyed())win.destroy();popups.clear();
        popupTabs.clear();for(const id of [...views.keys()])destroyTabView(id);tabs.clear();view=null;
        sessionPolicy?.reset();invalidate();
    }
    async function clearData(kind) {
        if(switching)await switching;
        if(!['cookies','cache','site','all'].includes(kind))throw new Error('Choose a browser data category.');
        if(clearing)return clearing;
        const ses=profile(),selected=profiles.selected().id;
        if(!dialog || (await dialog.showMessageBox(getWindow(),{type:'warning',title:'Clear browser data',
            message:`Clear ${kind==='all'?'all browser data':kind==='site'?'site storage':kind}?`,
            detail:'Browser pages, login windows and extra Browser windows using this profile will close. Cookies or site storage removal can sign you out. Chats and AI data are unaffected.',
            buttons:['Cancel','Clear browser data'],defaultId:0,cancelId:0,noLink:true})).response!==1)return state();
        if(clearing)return clearing;
        if(profiles.selected().id!==selected)throw Error('The selected profile changed. Choose its privacy controls again.');
        const unblock=profiles.block(selected);
        try {
            await beforeClearProfile?.(selected);
            await workflows.cancel();close();
            clearing=(async()=>{
                await ses.closeAllConnections();
                if(kind==='cache')await ses.clearCache();
                else if(kind==='cookies') {await ses.clearData({dataTypes:['cookies']});await ses.clearAuthCache();}
                else if(kind==='site')await ses.clearData({dataTypes:['localStorage','indexedDB','serviceWorkers','fileSystems','webSQL','backgroundFetch']});
                else {await ses.clearData();await ses.clearAuthCache();}
                await ses.cookies.flushStore();notice='Selected browser data cleared.';
            })();
            await clearing;
        }finally{clearing=null;unblock();}
        return state();
    }
    return {start,state,place,inspect,source,
        navigate:value=>enqueueTab(()=>navigate(value)),clearData:kind=>enqueueTab(()=>clearData(kind)),
        createTab:value=>enqueueTab(()=>createTab(value)),selectTab:id=>enqueueTab(()=>selectTab(id)),closeTab:id=>enqueueTab(()=>closeTab(id)),
        shortcut:action=>enqueueTab(()=>shortcut(action)),
        setTabSettings:value=>{tabs.setSettings(value);return state();},
        profiles:()=>profiles.list(),createProfile:name=>profiles.create(name),
        selectProfile(id) {return enqueueTab(async()=>{
            profiles.partition(id);
            if(switching)throw Error('A browser profile selection is already in progress.');
            switching=(async()=>{
                if(clearing)await clearing;
                if(starting)await starting;
                await workflows.cancel();close();
                if(isolated){await isolated.cookies.flushStore();isolated.flushStorageData();}
                profiles.select(id);isolated=null;sessionPolicy=null;return start(true);
            })();
            try{return await switching;}finally{switching=null;}
        });},
        startWorkflow:workflows.begin,browserTool:workflows.tool,workflowState:workflows.state,
        // Internal controller handoff only; there is no renderer IPC for it.
        restoreWorkflowPage:async(profileId,url)=>{
            if(workflows.busy())throw Error('Wait for the browser operation to stop before restoring the source.');
            const current=workflows.activeState();
            if(current?.status==='running')throw Error('Cancel the Browser workflow before resuming Reels.');
            if(current?.status==='paused')await workflows.cancel({workflowId:current.id});
            return restoreWorkflowPage(profileId,url);
        },
        cancelWorkflow:workflows.cancel,resumeWorkflow:workflows.resume,clearWorkflowMedia:workflows.clearMedia,
        releaseWorkflowMedia:workflows.releaseMedia,
        setMix:mixer.configure,findContents:()=>contents() && view.getVisible() ? contents() : null,hide:()=>place({visible:false}),
        dispose:async()=>{disposed=true;await tabOperations;await workflows.dispose();close();playbackPriority.dispose();for(const {ses,policy} of sessions.values()){await ses.cookies.flushStore();ses.flushStorageData();policy.detach();}sessions.clear();isolated=null;},
        snapshot: async () => {
            const wc=contents(),version=revision;if(!wc)return null;
            if(!dialog || (await dialog.showMessageBox(getWindow(),{type:'question',title:'Capture browser page',message:'Copy this browser page to the clipboard?',
                detail:'The screenshot may contain private account information. It is not sent to AI automatically.',buttons:['Cancel','Copy screenshot'],defaultId:0,cancelId:0,noLink:true})).response!==1)throw new Error('Browser capture cancelled.');
            if(wc!==contents() || revision!==version)throw new Error('The browser page changed. Capture it again.');
            try {
                const image=await wc.capturePage(undefined,{stayHidden:true,stayAwake:true});
                if(image.isEmpty())throw new Error('No painted page');
                return {kind:'browser',html:`<img alt="Browser page" style="width:100%;height:100%;object-fit:contain" src="${image.toDataURL()}">`,css:'',warnings:[]};
            } catch {
                return {kind:'browser',html:'<p>Browser preview unavailable. Open the browser page and try capturing again.</p>',css:'',warnings:['The browser page has not been painted. Open Browser before capturing it.']};
            }
        },
        command(action) {
            if(['back','forward','reload','stop','close'].includes(action))workflows.pause('manual_navigation');
            const wc=contents();
            if(action==='close')return enqueueTab(()=>closeTab());
            if(!wc)return state();
            if(action==='back' && wc.navigationHistory.canGoBack())wc.navigationHistory.goBack();
            else if(action==='forward' && wc.navigationHistory.canGoForward())wc.navigationHistory.goForward();
            else if(action==='reload')wc.reload();
            else if(action==='stop')wc.stop();
            else if(action==='focus')wc.focus();
            return state();
        },
    };
}
function tabShortcut(input) {
    if(input.type!=='keyDown' || !(input.control || input.meta) || input.alt)return null;
    const key=input.key.toLowerCase();
    if(key==='t' && !input.shift)return 'new';
    if(key==='w' && !input.shift)return 'close';
    if(key==='tab')return input.shift?'previous':'next';
    return null;
}
module.exports={createViewerBrowser,inspectDocument};
