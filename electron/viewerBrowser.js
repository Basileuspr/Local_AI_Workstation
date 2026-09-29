const {randomUUID} = require('node:crypto');
const {browserUrl, allowedBrowserRequest} = require('./browserPolicy');
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

function createViewerBrowser({WebContentsView, session, getWindow, allowRequest}) {
    let view=null, isolated=null, starting=null, placement={visible:false}, revision=0, error='', notice='', popup=null, inspection=null;
    const resources=new Map(), sources=new Map();
    function contents() {return view && !view.webContents.isDestroyed() ? view.webContents : null;}
    function invalidate() {revision++; resources.clear(); sources.clear(); inspection=null; error=''; popup=null; notice='';}
    function state() {
        const wc=contents();
        return {ready:!!wc,url:wc?.getURL() || '',title:(wc?.getTitle() || '').slice(0,256),loading:wc?.isLoading() || false,
            back:wc?.navigationHistory.canGoBack() || false,forward:wc?.navigationHistory.canGoForward() || false,revision,error,notice,popup};
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
        if(starting)return starting;
        if (contents()) return state();
        starting=initialize();
        try{return await starting;}catch(failure){close();throw failure;}finally{starting=null;}
    }
    async function initialize() {
        isolated=session.fromPartition(`viewer-browser-${randomUUID()}`);
        const browserSession=isolated;
        isolated.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
        isolated.setPermissionCheckHandler(()=>false);
        isolated.setDevicePermissionHandler(()=>false);
        isolated.on('will-download',event=>{event.preventDefault();notice='Page downloads are disabled. Use the source viewers to save inspected code.';});
        isolated.webRequest.onBeforeRequest((details,callback)=>{
            if (/^(data:|blob:)/.test(details.url) && !['mainFrame','subFrame'].includes(details.resourceType)) {callback({cancel:false});return;}
            if (details.url==='about:blank') {callback({cancel:false});return;}
            let timeout;
            const allowed=allowRequest ? allowRequest(details.url) : allowedBrowserRequest(details.url,host=>browserSession.resolveHost(host));
            Promise.race([Promise.resolve(allowed),new Promise(resolve=>{timeout=setTimeout(()=>resolve(false),5000);})])
                .then(ok=>{clearTimeout(timeout);callback({cancel:!ok});}).catch(()=>{clearTimeout(timeout);callback({cancel:true});});
        });
        view=new WebContentsView({webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,
            webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,navigateOnDragDrop:false}});
        view.setVisible(false);getWindow().contentView.addChildView(view);
        const wc=contents();
        wc.setWindowOpenHandler(({url})=>{if(browserUrl(url)) popup=url;return {action:'deny'};});
        const guard=(event,url)=>{if (!browserUrl(url) && url!=='about:blank') event.preventDefault();};
        wc.on('will-navigate',guard);wc.on('will-redirect',guard);
        wc.on('will-frame-navigate',event=>guard(event,event.url));
        wc.on('will-attach-webview',event=>event.preventDefault());
        wc.on('did-start-navigation',(_event,_url,inPlace,mainFrame)=>{if(mainFrame && !inPlace)invalidate();});
        wc.on('did-fail-load',(_event,code,description,_url,mainFrame)=>{if(mainFrame && code!==-3)error=`Could not load this page (${description}).`;});
        wc.on('render-process-gone',()=>{error='The browser stopped. Close the page and reopen it.';place({visible:false});});
        wc.on('before-input-event',(event,input)=>{
            if(input.type==='keyDown' && (input.key==='F6' || ((input.control || input.meta) && input.key.toLowerCase()==='l'))) {
                event.preventDefault();getWindow()?.webContents.focus();getWindow()?.webContents.send('viewer-browser:address');
            }
        });
        await wc.loadURL('about:blank');
        wc.debugger.attach('1.3');
        wc.debugger.on('message',(_event,method,params)=>{
            if(method==='Network.responseReceived' && ['Document','Stylesheet','Script'].includes(params.type) && resources.size<MAX_RESOURCES) {
                const r=params.response;
                if(!browserUrl(r.url))return;
                resources.set(params.requestId,{id:randomUUID(),requestId:params.requestId,kind:{Document:'html',Stylesheet:'css',Script:'js'}[params.type],
                    name:r.url,url:r.url,status:r.status,revision,complete:false});
            }
            if(method==='Network.loadingFinished' && resources.has(params.requestId))resources.get(params.requestId).complete=true;
        });
        await wc.debugger.sendCommand('Network.enable',{maxTotalBufferSize:16*1024*1024,maxResourceBufferSize:MAX_SOURCE});
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
        const inline=await wc.executeJavaScriptInIsolatedWorld(999,[{code:`(${inspectDocument.toString()})()`}]);
        if(version!==revision)throw new Error('The page changed. Inspect it again.');
        sources.clear();
        for(const item of inline) {const id=randomUUID();sources.set(id,{...item,id,url:wc.getURL(),revision});}
        for(const item of resources.values())if(item.revision===revision)sources.set(item.id,item);
        inspection={revision,pageUrl:wc.getURL(),items:[...sources.values()].map(({text,requestId,...item})=>item)};
        return inspection;
    }
    async function source(id) {
        const item=sources.get(id), wc=contents(), version=revision;
        if(!item || item.revision!==revision || !wc)throw new Error('Inspect the current page before opening a source.');
        let text=item.text, truncated=item.truncated || false;
        if(text===undefined) {
            if(!item.complete)throw new Error('This resource is still loading. Inspect the page again shortly.');
            try {
                const body=await wc.debugger.sendCommand('Network.getResponseBody',{requestId:item.requestId});
                text=body.base64Encoded ? Buffer.from(body.body,'base64').toString('utf8') : body.body;
            } catch {throw new Error('This source is no longer in the browser cache. Reload the page and inspect it again.');}
            truncated=text.length>MAX_SOURCE;text=text.slice(0,MAX_SOURCE);
        }
        if(version!==revision)throw new Error('The page changed. Inspect it again.');
        return {id:randomUUID(),kind:item.kind,name:item.name,url:item.url,text,truncated};
    }
    function close() {
        if(view){getWindow()?.contentView.removeChildView(view);if(contents())contents().close();view=null;}
        invalidate();const previous=isolated;isolated=null;
        if(previous)void Promise.allSettled([previous.clearStorageData(),previous.clearCache(),previous.closeAllConnections()]);
    }
    return {start,state,place,navigate,inspect,source,hide:()=>place({visible:false}),dispose:close,
        snapshot: async () => {
            const wc=contents();if(!wc)return null;
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
