const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("workstationDesktop", {
    connection: ipcRenderer.sendSync("app:connection"),
    openDriveRoot: (root) => ipcRenderer.invoke("dashboard:open-drive-root", root),
    pickUploadFiles: (options) => ipcRenderer.invoke("uploads:choose", options),
    chooseFaceInputs: (options) => ipcRenderer.invoke("faces:choose-inputs", options),
    readFaceInputs: (ticket) => ipcRenderer.invoke("faces:read-inputs", ticket),
    releaseFaceInputs: (ticket) => ipcRenderer.invoke("faces:release-inputs", ticket),
    saveFaceFolder: (selection) => ipcRenderer.invoke("faces:save-folder", selection),
    exportResetInventory: () => ipcRenderer.invoke("maintenance:export"),
    resetAppData: (ticket, confirmation) => ipcRenderer.invoke("maintenance:reset", { ticket, confirmation }),
    onResetResult: (callback) => {
        const listener = (_event, result) => callback(result);
        ipcRenderer.on("maintenance:result", listener);
        return () => ipcRenderer.removeListener("maintenance:result", listener);
    },
});
