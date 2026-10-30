const { contextBridge, ipcRenderer } = require('electron');

// Deliberately separate from the desktop preload: no API session, shell,
// generation, files, or general-purpose IPC. Apply accepts only a host-issued
// review ticket for validated design requests, never arbitrary renderer code.
contextBridge.exposeInMainWorld('designMirror', Object.freeze({
    load: () => ipcRenderer.invoke('design-mirror:load'),
    capture: () => ipcRenderer.invoke('design-mirror:capture'),
    save: value => ipcRenderer.invoke('design-mirror:save', value),
    prepareApplication: () => ipcRenderer.invoke('design-mirror:prepare'),
    applyToApp: value => ipcRenderer.invoke('design-mirror:apply', value),
    undoApplication: () => ipcRenderer.invoke('design-mirror:undo'),
    exportReview: () => ipcRenderer.invoke('design-mirror:export'),
}));
