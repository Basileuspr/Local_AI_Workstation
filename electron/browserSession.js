const path = require('node:path');
const {browserUrl, createBrowserRequestGate} = require('./browserPolicy');

const BROWSER_PARTITION = 'persist:workstation-browser';
const REMOTE_PREFERENCES = Object.freeze({sandbox:true, contextIsolation:true, nodeIntegration:false,
    nodeIntegrationInWorker:false, nodeIntegrationInSubFrames:false, webSecurity:true,
    allowRunningInsecureContent:false, webviewTag:false, navigateOnDragDrop:false});
const PROMPT_PERMISSIONS = new Set(['media', 'geolocation', 'notifications', 'clipboard-read', 'clipboard-sanitized-write']);
function originOf(url) {try {return browserUrl(url) ? new URL(url).origin : null;} catch {return null;}}

// Electron has one set of handlers per Session. Route shared-profile requests to
// their owning window; opening/closing another window must not replace its policy.
const installed = new WeakMap();
function installBrowserSession(options) {
    const {browserSession} = options;
    let routing = installed.get(browserSession);
    if(!routing) {
        routing = createSessionRouting(browserSession);
        installed.set(browserSession, routing);
    }
    const owner = {...options, notify:options.notify || (()=>{})};
    routing.owners.add(owner);
    let detached = false;
    return {revoke:routing.revoke, reset:()=>routing.reset(owner), detach(){
        if(detached)return;detached=true;
        routing.reset(owner);routing.owners.delete(owner);
        if(!routing.owners.size){routing.detach();installed.delete(browserSession);}
    }};
}

// Per-window, per-document grants. No permission decisions are written to disk.
function createSessionRouting(browserSession) {
    const owners=new Set(), grants = new Map(), pending = new Set(), downloads = new Map(), epochs=new WeakMap();
    const ownerOf=wc=>wc && [...owners].find(owner=>owner.owned.has(wc));
    const requests=createBrowserRequestGate(host=>browserSession.resolveHost(host,{cacheUsage:'allowed'}));
    function revoke(wc) {grants.delete(wc.id);epochs.set(wc,(epochs.get(wc)||0)+1);}
    function eligible(wc, origin, details={}) {
        return wc && !wc.isDestroyed() && ownerOf(wc) && origin && origin === originOf(wc.getURL()) && details.isMainFrame !== false;
    }
    browserSession.setPermissionCheckHandler((wc, permission, origin, details) =>
        !!(eligible(wc, originOf(origin), details) && grants.get(wc.id)?.has(`${originOf(origin)}:${permission}`)));
    browserSession.setPermissionRequestHandler(async(wc, permission, callback, details={}) => {
        const owner=ownerOf(wc),dialog=owner?.dialog;
        const url = wc?.getURL(), origin = originOf(details.requestingUrl || url);
        const epoch=epochs.get(wc)||0;
        if (!eligible(wc, origin, details) || !PROMPT_PERMISSIONS.has(permission) || !dialog || pending.has(wc.id)) return callback(false);
        const key = `${origin}:${permission}`;
        // Always ask for media: a prior microphone grant must not silently grant camera.
        if(permission !== 'media' && grants.get(wc.id)?.has(key)) return callback(true);
        pending.add(wc.id);
        try {
            const media = permission === 'media' ? (details.mediaTypes || []).filter(x=>['audio','video'].includes(x)).join(' and ') : '';
            const result = await dialog.showMessageBox(owner.getWindow(), {type:'question', title:'Website permission',
                message:`Allow ${origin} to use ${permission === 'media' ? media || 'camera/microphone' : permission}?`,
                detail:'Applies to this page only. Navigating or closing the page revokes this permission.',
                buttons:['Deny','Allow once'], defaultId:0, cancelId:0, noLink:true});
            const allowed = result.response === 1 && eligible(wc, origin, details) && wc.getURL() === url && (epochs.get(wc)||0)===epoch;
            if(allowed && permission !== 'media') {if(!grants.has(wc.id))grants.set(wc.id,new Set());grants.get(wc.id).add(key);}
            callback(allowed);
        } catch {callback(false);} finally {pending.delete(wc.id);}
    });
    browserSession.setDevicePermissionHandler(()=>false);
    browserSession.setDisplayMediaRequestHandler((_request, callback)=>callback({}));
    const restricted=(_event,_details,callback)=>callback('deny');
    browserSession.on('file-system-access-restricted',restricted);
    browserSession.webRequest.onBeforeRequest((details,callback)=>{
        if (/^(data:|blob:)/.test(details.url) && !['mainFrame','subFrame'].includes(details.resourceType)) return callback({cancel:false});
        if (details.url==='about:blank') return callback({cancel:false});
        const owner=[...owners].find(entry=>[...entry.owned].some(wc=>wc.id===details.webContentsId));
        const allowRequest=owner?.allowRequest || (!details.webContentsId && [...owners].find(entry=>entry.allowRequest)?.allowRequest);
        if(!allowRequest){void requests.allowed(details.url).then(ok=>callback({cancel:!ok}),()=>callback({cancel:true}));return;}
        // The override exists only for owned diagnostic fixtures.
        let timeout;
        Promise.race([Promise.resolve().then(()=>allowRequest(details.url)),new Promise(resolve=>{timeout=setTimeout(()=>resolve(false),5000);})])
            .then(ok=>callback({cancel:!ok}),()=>callback({cancel:true})).finally(()=>clearTimeout(timeout));
    });
    const download=async(event,item,wc)=>{
        const owner=ownerOf(wc),dialog=owner?.dialog;
        if(!owner || !dialog){event.preventDefault();return;}
        item.pause(); downloads.set(item,owner);
        item.once('done',(_event,state)=>{downloads.delete(item);owner.notify(state==='completed'?'Download saved.':'Download cancelled or interrupted.');});
        try {
            const name=path.basename(item.getFilename().replace(/\\/g,'/')).replace(/[<>:"|?*\x00-\x1f]/g,'_').slice(0,180) || 'download';
            const result=await dialog.showSaveDialog(owner.getWindow(),{title:'Save website download',defaultPath:name,buttonLabel:'Save download'});
            if(result.canceled || !result.filePath || ownerOf(wc)!==owner || wc.isDestroyed() || !downloads.has(item)) {item.cancel();return;}
            item.setSavePath(result.filePath);item.resume();owner.notify('Downloading to your selected location…');
        } catch {try{item.cancel();}catch{}}
    };
    browserSession.on('will-download',download);
    return {owners,revoke, reset(owner){
        for(const wc of owner.owned)revoke(wc);
        for(const [item,target] of downloads)if(target===owner){try{item.cancel();}catch{}downloads.delete(item);}
    },detach(){
        requests.dispose();browserSession.removeListener('will-download',download);browserSession.removeListener('file-system-access-restricted',restricted);
        browserSession.setPermissionCheckHandler(()=>false);
        browserSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
        browserSession.webRequest.onBeforeRequest((_details,callback)=>callback({cancel:true}));
    }};
}
module.exports={BROWSER_PARTITION,REMOTE_PREFERENCES,installBrowserSession,originOf};
