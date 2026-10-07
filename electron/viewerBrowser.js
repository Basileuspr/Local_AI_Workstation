const {randomUUID} = require('node:crypto');
const {createNativeMixer} = require('./soundMixer');
const {browserUrl} = require('./browserPolicy');
const {BROWSER_PARTITION,REMOTE_PREFERENCES,installBrowserSession,originOf} = require('./browserSession');
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

function createViewerBrowser({WebContentsView, session, getWindow, dialog, allowRequest, watchFind}) {
    const mixer=createNativeMixer('browser');
    let view=null, isolated=null, starting=null, placement={visible:false}, revision=0, error='', notice='', popup=null, inspection=null;
    const resources=new Map(), sources=new Map();
    const owned=new Set(), popups=new Set();
    let sessionPolicy=null, clearing=null;
    function profile() {
        if(!isolated) {
            isolated=session.fromPartition(BROWSER_PARTITION);
            sessionPolicy=installBrowserSession({browserSession:isolated,owned,getWindow,dialog,allowRequest,notify:message=>{notice=message;}});
        }
        return isolated;
    }
    function secureContents(wc) {
        mixer.watch(wc);
        owned.add(wc);
        wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
        wc.setWindowOpenHandler(({url})=>{
            if((url!=='about:blank' && !browserUrl(url)) || popups.size>=4 || clearing) return {action:'deny'};
            return {action:'allow',overrideBrowserWindowOptions:{width:760,height:720,autoHideMenuBar:true,
                webPreferences:{...REMOTE_PREFERENCES,session:profile(),preload:undefined}}};
        });
        wc.on('did-create-window',win=>{
            popups.add(win);win.setMenu(null);secureContents(win.webContents);
            const label=()=>{if(!win.isDestroyed())win.setTitle(`Website window — ${originOf(win.webContents.getURL()) || 'Opening…'}`);};
            win.on('page-title-updated',event=>{event.preventDefault();label();});
            win.webContents.on('did-navigate',label);label();
            win.on('closed',()=>popups.delete(win));
        });
        const guard=(event,url)=>{if(!browserUrl(url) && url!=='about:blank')event.preventDefault();};
        wc.on('will-navigate',guard);wc.on('will-redirect',guard);
        wc.on('will-frame-navigate',event=>guard(event,event.url));
        wc.on('will-attach-webview',event=>event.preventDefault());
        wc.on('select-bluetooth-device',(event,devices,callback)=>{event.preventDefault();callback('');});
        wc.on('did-start-navigation',(_event,_url,inPlace,mainFrame)=>{if(mainFrame && !inPlace)sessionPolicy.revoke(wc);});
        wc.once('destroyed',()=>{owned.delete(wc);sessionPolicy.revoke(wc);});
    }
    function contents() {return view && !view.webContents.isDestroyed() ? view.webContents : null;}
    function invalidate() {revision++; resources.clear(); sources.clear(); inspection=null; error=''; popup=null; notice='';}
    function state() {
        const wc=contents();
        return {ready:!!wc,url:wc?.getURL() || '',title:(wc?.getTitle() || '').slice(0,256),loading:wc?.isLoading() || false,
            back:wc?.navigationHistory.canGoBack() || false,forward:wc?.navigationHistory.canGoForward() || false,revision,error,notice,popup,
            profilePath:isolated?.storagePath || null,persistent:true,clearing:!!clearing};
    }
    function place(value) {
        placement=value || {visible:false};
        if (!contents()) return;
        const win=getWindow(), b=placement.bounds;
        if (!win || !placement.visible || !b || ![b.x,b.y,b.width,b.height].every(Number.isFinite)) {view.setVisible(false);return;}
        const [w,h]=win.getContentSize(), scale=win.webContents.getZoomFactor();
        const x=Math.max(0,Math.round(b.x*scale)), y=Math.max(0,Math.round(b.y*scale));
        const width=Math.min(w-x,Math.round(b.width*scale)),height=Math.min(h-y,Math.round(b.height*scale));
        if (width<=0 || height<=0) {view.setVisible(false);return;}
        view.setBounds({x,y,width,height});view.setVisible(true);
    }
    async function start() {
        if(clearing)await clearing;
        if(starting)return starting;
        if (contents()) return state();
        starting=initialize();
        try{return await starting;}catch(failure){close();throw failure;}finally{starting=null;}
    }
    async function initialize() {
        view=new WebContentsView({webPreferences:{...REMOTE_PREFERENCES,session:profile()}});
        view.setVisible(false);getWindow().contentView.addChildView(view);
        const wc=contents();
        watchFind?.(wc,'browser');
        secureContents(wc);
        wc.on('did-start-navigation',(_event,_url,inPlace,mainFrame)=>{if(mainFrame && !inPlace)invalidate();});
        wc.on('did-fail-load',(_event,code,description,_url,mainFrame)=>{if(mainFrame && code!==-3)error=`Could not load this page (${description}).`;});
        wc.on('render-process-gone',()=>{error='The browser stopped. Close the page and reopen it.';place({visible:false});});
        wc.on('before-input-event',(event,input)=>{
            if(input.type==='keyDown' && (input.key==='F6' || ((input.control || input.meta) && input.key.toLowerCase()==='l'))) {
                event.preventDefault();getWindow()?.webContents.focus();getWindow()?.webContents.send('viewer-browser:address');
            }
        });
        await wc.loadURL('about:blank');
        if(wc!==contents())throw new Error('Browser opening was cancelled.');
        place(placement);return state();
    }
    async function navigate(value) {
        const url=browserUrl(value,{input:true});
        if(!url)throw new Error('Enter a public HTTP or HTTPS address. Local app and private-network pages are not supported.');
        await start();error='';
        void contents().loadURL(url).catch(failure=>{if(failure.code!=='ERR_ABORTED')error='Could not load this page. Check its address or connection.';});
        return state();
    }
    async function inspect() {
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
        for(const win of popups)if(!win.isDestroyed())win.destroy();popups.clear();
        if(view){const win=getWindow();if(win && !win.isDestroyed())win.contentView.removeChildView(view);if(contents())contents().close({waitForBeforeUnload:false});view=null;}
        sessionPolicy?.reset();invalidate();
    }
    async function clearData(kind) {
        if(!['cookies','cache','site','all'].includes(kind))throw new Error('Choose a browser data category.');
        if(clearing)return clearing;
        const ses=profile();
        if(!dialog || (await dialog.showMessageBox(getWindow(),{type:'warning',title:'Clear browser data',
            message:`Clear ${kind==='all'?'all browser data':kind==='site'?'site storage':kind}?`,
            detail:'Browser pages and login windows will close. Cookies or site storage removal can sign you out. Chats and AI data are unaffected.',
            buttons:['Cancel','Clear browser data'],defaultId:0,cancelId:0,noLink:true})).response!==1)return state();
        if(clearing)return clearing;
        close();
        clearing=(async()=>{
            await ses.closeAllConnections();
            if(kind==='cache')await ses.clearCache();
            else if(kind==='cookies') {await ses.clearData({dataTypes:['cookies']});await ses.clearAuthCache();}
            else if(kind==='site')await ses.clearData({dataTypes:['localStorage','indexedDB','serviceWorkers','fileSystems','webSQL','backgroundFetch']});
            else {await ses.clearData();await ses.clearAuthCache();}
            await ses.cookies.flushStore();notice='Selected browser data cleared.';
        })();
        try{await clearing;}finally{clearing=null;}
        return state();
    }
    return {start,state,place,navigate,inspect,source,clearData,setMix:mixer.configure,findContents:()=>view?.getVisible() ? contents() : null,hide:()=>place({visible:false}),
        dispose:async()=>{close();if(isolated){await isolated.cookies.flushStore();isolated.flushStorageData();sessionPolicy.detach();isolated=null;}},
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
            const wc=contents();
            if(action==='close'){close();return state();}
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
module.exports={createViewerBrowser,inspectDocument};
