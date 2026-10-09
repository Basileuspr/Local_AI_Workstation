const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {trustedUrl} = require('./security');

const MAX_BROWSER_WINDOWS = 8;
const WINDOW_ACTIONS = new Set(['start','state','place','navigate','inspect','source','command',
    'profiles','createProfile','selectProfile','createTab','selectTab','closeTab','shortcut','setTabSettings']);

// Extra windows reuse the browser controller, but never the main app's preload
// or its backend/file/shell authority. Remote pages remain separate native views.
function createBrowserWindows({BrowserWindow, createBrowser, profileRegistry, getMainWindow, devUrl, onCreate, onError=()=>{}}) {
    const windows=new Map(), pending=new Set();
    let disposed=false,mix;
    function rendererUrl() {
        const raw=getMainWindow()?.webContents.getURL();
        if(!trustedUrl(raw,devUrl))throw Error('Open the desktop workspace before opening a Browser window.');
        const url=new URL(raw);url.search='';url.hash='';url.searchParams.set('browserWindow','1');
        return url.href;
    }
    function allowed(raw,expected) {
        try {const url=new URL(raw),target=new URL(expected);
            return trustedUrl(raw,devUrl) && url.origin===target.origin && url.pathname===target.pathname &&
                url.searchParams.get('browserWindow')==='1';
        }catch{return false;}
    }
    function entryFor(event) {
        const entry=windows.get(event.sender?.id),wc=entry && !entry.window.isDestroyed() && entry.window.webContents;
        return wc && !wc.isDestroyed() && event.sender===wc && event.senderFrame===wc.mainFrame &&
            allowed(event.senderFrame.url,entry.url) ? entry : null;
    }
    function cleanup(entry) {
        windows.delete(entry.id);
        if(!entry.cleanup){entry.cleanup=Promise.resolve().then(()=>entry.browser.dispose());pending.add(entry.cleanup);
            entry.cleanup.then(()=>pending.delete(entry.cleanup),error=>{pending.delete(entry.cleanup);onError(error);});}
        return entry.cleanup;
    }
    async function open(source) {
        if(disposed)throw Error('The application is closing.');
        if(windows.size>=MAX_BROWSER_WINDOWS)throw Error(`Close a Browser window before opening another (maximum ${MAX_BROWSER_WINDOWS} extra windows).`);
        const url=rendererUrl(),profiles=profileRegistry.fork(source.state().selected);
        const win=new BrowserWindow({width:1100,height:800,minWidth:480,minHeight:420,title:'Browser · Local AI Workstation',
            show:false,backgroundColor:'#080c14',autoHideMenuBar:true,
            webPreferences:{preload:path.join(__dirname,'browserWindowPreload.js'),sandbox:true,contextIsolation:true,
                nodeIntegration:false,webSecurity:true,webviewTag:false,partition:`workstation-browser-ui-${randomUUID()}`}});
        const browser=createBrowser({getWindow:()=>win,profileRegistry:profiles});
        const entry={window:win,browser,url,id:win.webContents.id};windows.set(entry.id,entry);
        if(mix)browser.setMix(mix);
        win.setMenu(null);onCreate?.(win);
        win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
        win.webContents.on('will-navigate',(event,target)=>{if(!allowed(target,url))event.preventDefault();});
        win.webContents.on('will-frame-navigate',event=>{if(!allowed(event.url,url))event.preventDefault();});
        win.webContents.on('will-attach-webview',event=>event.preventDefault());
        win.webContents.on('did-start-navigation',(_event,_url,_inPlace,main)=>{if(main)browser.hide();});
        win.webContents.on('render-process-gone',()=>browser.hide());
        win.once('closed',()=>{void cleanup(entry);});
        try {
            await win.loadURL(url);
            if(disposed || win.isDestroyed())throw Error('The Browser window closed while opening.');
            win.show();return {opened:true};
        }catch(error){if(!win.isDestroyed())win.destroy();await cleanup(entry);throw error;}
    }
    async function closeProfile(id) {
        const matching=[...windows.values()].filter(entry=>entry.browser.state().selected===id);
        for(const entry of matching){await cleanup(entry);if(!entry.window.isDestroyed())entry.window.destroy();}
    }
    return {open,controller:event=>entryFor(event)?.browser,
        trusted:event=>!!entryFor(event),windowFor:event=>entryFor(event)?.window,
        allows:action=>WINDOW_ACTIONS.has(action),
        setMix(value){mix=value;for(const entry of windows.values())entry.browser.setMix(value);},
        closeProfile,
        async dispose(){disposed=true;for(const entry of [...windows.values()]){await cleanup(entry);if(!entry.window.isDestroyed())entry.window.destroy();}
            await Promise.all([...pending]);},
    };
}
module.exports={createBrowserWindows,MAX_BROWSER_WINDOWS};
