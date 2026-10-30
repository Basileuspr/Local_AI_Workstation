const { contextBridge, ipcRenderer } = require('electron');

// Deliberately separate from the desktop preload: no API session, shell,
// application preferences, generation, files, or general-purpose IPC.
contextBridge.exposeInMainWorld('designMirror', Object.freeze({
    load: () => ipcRenderer.invoke('design-mirror:load'),
    capture: () => ipcRenderer.invoke('design-mirror:capture'),
    save: value => ipcRenderer.invoke('design-mirror:save', value),
    exportReview: () => ipcRenderer.invoke('design-mirror:export'),
}));
