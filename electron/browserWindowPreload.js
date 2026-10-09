const {contextBridge,ipcRenderer}=require('electron');
const invoke=(action,value)=>ipcRenderer.invoke(`viewer-browser:${action}`,value);
const listen=(channel,callback,valid=()=>true)=>{
    const listener=(_event,value)=>{if(valid(value))callback(value);};ipcRenderer.on(channel,listener);
    return ()=>ipcRenderer.removeListener(channel,listener);
};
contextBridge.exposeInMainWorld('workstationDesktop',Object.freeze({
    browserWindow:true,
    startViewerBrowser:()=>invoke('start'),viewerBrowserState:()=>invoke('state'),
    placeViewerBrowser:value=>invoke('place',value),navigateViewerBrowser:value=>invoke('navigate',value),
    inspectViewerBrowser:()=>invoke('inspect'),viewerBrowserSource:id=>invoke('source',id),viewerBrowserCommand:action=>invoke('command',action),
    createViewerBrowserTab:url=>invoke('createTab',url),selectViewerBrowserTab:id=>invoke('selectTab',id),closeViewerBrowserTab:id=>invoke('closeTab',id),
    viewerBrowserTabShortcut:action=>invoke('shortcut',action),setViewerBrowserTabSettings:value=>invoke('setTabSettings',value),
    newViewerBrowserWindow:()=>ipcRenderer.invoke('browser-window:new'),
    viewerBrowserProfiles:()=>invoke('profiles'),createViewerBrowserProfile:name=>invoke('createProfile',name),selectViewerBrowserProfile:id=>invoke('selectProfile',id),
    browserBookmarks:()=>ipcRenderer.invoke('browser-bookmarks:list'),saveBrowserBookmark:value=>ipcRenderer.invoke('browser-bookmarks:save',value),
    removeBrowserBookmark:id=>ipcRenderer.invoke('browser-bookmarks:remove',id),createBrowserBookmarkFolder:value=>ipcRenderer.invoke('browser-bookmarks:createFolder',value),
    importBrowserBookmarks:()=>ipcRenderer.invoke('browser-bookmarks:import'),
    onViewerBrowserAddress:callback=>listen('viewer-browser:address',callback),
    onViewerBrowserTabShortcut:callback=>listen('viewer-browser:tab-shortcut',callback,value=>['new','close','next','previous'].includes(value)),
    onViewerBrowserNewWindow:callback=>listen('viewer-browser:new-window',callback),
    onWindowLayout:callback=>listen('app:window-layout',callback),
}));
