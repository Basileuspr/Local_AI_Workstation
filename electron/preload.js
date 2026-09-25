const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("workstationDesktop", {
    connection: ipcRenderer.sendSync("app:connection"),
    copyImage: (dataUrl) => ipcRenderer.invoke("functions:copy-image", dataUrl),
    runAction: (action) => ipcRenderer.invoke("functions:run-action", action),
    captureTab: (tab) => ipcRenderer.invoke("functions:capture-tab", tab),
    softwareRuntime: () => ipcRenderer.invoke("dashboard:software-runtime"),
    startMediaManager: () => ipcRenderer.invoke("media-manager:start"),
    mediaManagerStatus: () => ipcRenderer.invoke("media-manager:status"),
    placeMediaManager: (placement) => ipcRenderer.invoke("media-manager:place", placement),
    focusMediaManager: () => ipcRenderer.invoke("media-manager:focus"),
    refreshMediaManager: () => ipcRenderer.invoke("media-manager:refresh"),
    onMediaManagerNavigation: (callback) => {
        const listener = () => callback();
        ipcRenderer.on("media-manager:navigation", listener);
        return () => ipcRenderer.removeListener("media-manager:navigation", listener);
    },
    openDriveRoot: (root) => ipcRenderer.invoke("dashboard:open-drive-root", root),
    scanDriveFolders: (root) => ipcRenderer.invoke("dashboard:scan-drive", root),
    driveFolderScanStatus: (id) => ipcRenderer.invoke("dashboard:drive-scan-status", id),
    cancelDriveFolderScan: (id) => ipcRenderer.invoke("dashboard:cancel-drive-scan", id),
    openAppFolder: () => ipcRenderer.invoke("dashboard:open-app-folder"),
    pickUploadFiles: (options) => ipcRenderer.invoke("uploads:choose", options),
    chooseFaceInputs: (options) => ipcRenderer.invoke("faces:choose-inputs", options),
    readFaceInputs: (ticket) => ipcRenderer.invoke("faces:read-inputs", ticket),
    releaseFaceInputs: (ticket) => ipcRenderer.invoke("faces:release-inputs", ticket),
    saveFaceFolder: (selection) => ipcRenderer.invoke("faces:save-folder", selection),
    exportResetInventory: () => ipcRenderer.invoke("maintenance:export"),
    prepareAppReset: () => ipcRenderer.invoke("maintenance:prepare-reset"),
    exportAppBackup: () => ipcRenderer.invoke("maintenance:backup"),
    prepareBackupImport: () => ipcRenderer.invoke("maintenance:prepare-import"),
    importAppBackup: (ticket, confirmation) => ipcRenderer.invoke("maintenance:import", { ticket, confirmation }),
    backupImportStatus: () => ipcRenderer.invoke("maintenance:import-status"),
    recoverBackupImport: () => ipcRenderer.invoke("maintenance:recover-import"),
    resetAppData: (ticket, confirmation) => ipcRenderer.invoke("maintenance:reset", { ticket, confirmation }),
    onResetResult: (callback) => {
        const listener = (_event, result) => callback(result);
        ipcRenderer.on("maintenance:result", listener);
        return () => ipcRenderer.removeListener("maintenance:result", listener);
    },
});
