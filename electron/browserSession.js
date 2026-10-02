const path = require('node:path');
const {browserUrl, allowedBrowserRequest} = require('./browserPolicy');

const BROWSER_PARTITION = 'persist:workstation-browser';
const REMOTE_PREFERENCES = Object.freeze({sandbox:true, contextIsolation:true, nodeIntegration:false,
    nodeIntegrationInWorker:false, nodeIntegrationInSubFrames:false, webSecurity:true,
    allowRunningInsecureContent:false, webviewTag:false, navigateOnDragDrop:false});
const PROMPT_PERMISSIONS = new Set(['media', 'geolocation', 'notifications', 'clipboard-read', 'clipboard-sanitized-write']);
function originOf(url) {try {return browserUrl(url) ? new URL(url).origin : null;} catch {return null;}}

// Per-window, per-document grants. No permission decisions are written to disk.
function installBrowserSession({browserSession, owned, getWindow, dialog, allowRequest, notify}) {
    const grants = new Map(), pending = new Set(), downloads = new Set(), epochs=new WeakMap();
    function revoke(wc) {grants.delete(wc.id);epochs.set(wc,(epochs.get(wc)||0)+1);}
    function eligible(wc, origin, details={}) {
        return wc && !wc.isDestroyed() && owned.has(wc) && origin && origin === originOf(wc.getURL()) && details.isMainFrame !== false;
    }
    browserSession.setPermissionCheckHandler((wc, permission, origin, details) =>
        !!(eligible(wc, originOf(origin), details) && grants.get(wc.id)?.has(`${originOf(origin)}:${permission}`)));
    browserSession.setPermissionRequestHandler(async(wc, permission, callback, details={}) => {
        const url = wc?.getURL(), origin = originOf(details.requestingUrl || url);
        const epoch=epochs.get(wc)||0;
        if (!eligible(wc, origin, details) || !PROMPT_PERMISSIONS.has(permission) || !dialog || pending.has(wc.id)) return callback(false);
        const key = `${origin}:${permission}`;
        // Always ask for media: a prior microphone grant must not silently grant camera.
        if(permission !== 'media' && grants.get(wc.id)?.has(key)) return callback(true);
        pending.add(wc.id);
        try {
            const media = permission === 'media' ? (details.mediaTypes || []).filter(x=>['audio','video'].includes(x)).join(' and ') : '';
            const result = await dialog.showMessageBox(getWindow(), {type:'question', title:'Website permission',
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
        let timeout;
        const allowed = Promise.resolve().then(()=>allowRequest ? allowRequest(details.url) : allowedBrowserRequest(details.url,host=>browserSession.resolveHost(host)));
        Promise.race([allowed,new Promise(resolve=>{timeout=setTimeout(()=>resolve(false),5000);})])
            .then(ok=>callback({cancel:!ok}),()=>callback({cancel:true})).finally(()=>clearTimeout(timeout));
    });
    const download=async(event,item,wc)=>{
        if(!owned.has(wc) || !dialog){event.preventDefault();return;}
        item.pause(); downloads.add(item);
        item.once('done',(_event,state)=>{downloads.delete(item);notify(state==='completed'?'Download saved.':'Download cancelled or interrupted.');});
        try {
            const name=path.basename(item.getFilename().replace(/\\/g,'/')).replace(/[<>:"|?*\x00-\x1f]/g,'_').slice(0,180) || 'download';
            const result=await dialog.showSaveDialog(getWindow(),{title:'Save website download',defaultPath:name,buttonLabel:'Save download'});
            if(result.canceled || !result.filePath || !owned.has(wc) || wc.isDestroyed() || !downloads.has(item)) {item.cancel();return;}
            item.setSavePath(result.filePath);item.resume();notify('Downloading to your selected location…');
        } catch {try{item.cancel();}catch{}}
    };
    browserSession.on('will-download',download);
    return {revoke, reset(){grants.clear();for(const item of downloads){try{item.cancel();}catch{}}downloads.clear();},
        detach(){browserSession.removeListener('will-download',download);browserSession.removeListener('file-system-access-restricted',restricted);}};
}
module.exports={BROWSER_PARTITION,REMOTE_PREFERENCES,installBrowserSession,originOf};
