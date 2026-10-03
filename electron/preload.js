const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("workstationDesktop", {
    openSoundSettings: () => ipcRenderer.invoke('sound-output:open-settings'),
    openLinkedContent: value => ipcRenderer.invoke('linked-content:open', value),
    placeLinkedContent: value => ipcRenderer.invoke('linked-content:place', value),
    closeLinkedContent: () => ipcRenderer.invoke('linked-content:close'),
    requestPlaybackCapture: value => ipcRenderer.invoke('playback-capture:arm', value),
    playbackCaptureStatus: () => ipcRenderer.invoke('playback-capture:status'),
    saveConvertedImage: id => ipcRenderer.invoke('converted-image:save', id),
    cancelPlaybackCapture: () => ipcRenderer.invoke('playback-capture:cancel'),
    save3DEditorFile: request => ipcRenderer.invoke('model-editor:save', request),
    savePaintFile: request => ipcRenderer.invoke('paint:save', request),
    printPaint: request => ipcRenderer.invoke('paint:print', request),
    request3DTextureCamera: () => ipcRenderer.invoke('model-editor:camera-start'),
    end3DTextureCamera: () => ipcRenderer.invoke('model-editor:camera-stop'),
    ...(process.platform === 'win32' ? {
        repair3DModel: request => ipcRenderer.invoke('mesh-repair:run', request),
        cancel3DRepair: id => ipcRenderer.invoke('mesh-repair:cancel', id),
        save3DRepair: request => ipcRenderer.invoke('mesh-repair:save', request),
        release3DRepair: id => ipcRenderer.invoke('mesh-repair:release', id),
        on3DRepairProgress: callback => {
            const listener = (_event, value) => callback(value);
            ipcRenderer.on('mesh-repair:progress', listener);
            return () => ipcRenderer.removeListener('mesh-repair:progress', listener);
        },
    } : {}),
    openLocalFile: () => ipcRenderer.invoke('local-files:open'),
    saveLocalDocument: options => ipcRenderer.invoke('local-files:save', options),
    localDocumentDirty: value => ipcRenderer.send('local-files:dirty', !!value),
    forgetLocalFile: id => ipcRenderer.send('local-files:forget', id),
    connection: ipcRenderer.sendSync("app:connection"),
    startupStatus: () => ipcRenderer.invoke("app:startup-status"),
    capabilities: () => ipcRenderer.invoke("app:capabilities"),
    openLogs: () => ipcRenderer.invoke("app:open-logs"),
    renderingStatus: () => ipcRenderer.invoke('app:rendering-status'),
    setRenderingMode: mode => ipcRenderer.invoke('app:rendering-mode', mode),
    repaintWindow: () => ipcRenderer.send('app:window-repaint'),
    onWindowLayout: callback => {
        const listener = () => callback();
        ipcRenderer.on('app:window-layout', listener);
        return () => ipcRenderer.removeListener('app:window-layout', listener);
    },
    copyImage: (dataUrl) => ipcRenderer.invoke("functions:copy-image", dataUrl),
    runAction: (action) => ipcRenderer.invoke("functions:run-action", action),
    chooseProgram: () => ipcRenderer.invoke("functions:choose-program"),
    openProgram: (id) => ipcRenderer.invoke("functions:open-program", id),
    captureTab: (tab) => ipcRenderer.invoke("functions:capture-tab", tab),
    chooseFunctionFolder: purpose => ipcRenderer.invoke('function-workflows:choose-folder', purpose),
    inspectFunctionWindow: request => ipcRenderer.invoke('function-workflows:inspect', request),
    startFunction: workflow => ipcRenderer.invoke('function-workflows:start', workflow),
    functionRunState: () => ipcRenderer.invoke('function-workflows:state'),
    stopFunction: id => ipcRenderer.invoke('function-workflows:stop', id),
    softwareRuntime: () => ipcRenderer.invoke("dashboard:software-runtime"),
    prepareDependencyUpdate: (name, profile) => ipcRenderer.invoke('dependencies:prepare', { name, profile }),
    approveDependencyUpdate: ticket => ipcRenderer.invoke('dependencies:apply', { ticket, approved: true }),
    cancelDependencyUpdate: ticket => ipcRenderer.invoke('dependencies:cancel', ticket),
    prepareGitHubPublication: () => ipcRenderer.invoke('github-publication:prepare'),
    validateGitHubSelection: request => ipcRenderer.invoke('github-publication:validate', request),
    commitGitHubSelection: request => ipcRenderer.invoke('github-publication:commit', request),
    pushGitHubCommit: request => ipcRenderer.invoke('github-publication:push', request),
    githubPublicationState: () => ipcRenderer.invoke('github-publication:state'),
    openGitHubPublicationLog: () => ipcRenderer.invoke('github-publication:log'),
    startMediaManager: () => ipcRenderer.invoke("media-manager:start"),
    mediaManagerStatus: () => ipcRenderer.invoke("media-manager:status"),
    startViewerBrowser: () => ipcRenderer.invoke('viewer-browser:start'),
    viewerBrowserState: () => ipcRenderer.invoke('viewer-browser:state'),
    placeViewerBrowser: value => ipcRenderer.invoke('viewer-browser:place',value),
    navigateViewerBrowser: url => ipcRenderer.invoke('viewer-browser:navigate',url),
    inspectViewerBrowser: () => ipcRenderer.invoke('viewer-browser:inspect'),
    viewerBrowserSource: id => ipcRenderer.invoke('viewer-browser:source',id),
    viewerBrowserCommand: action => ipcRenderer.invoke('viewer-browser:command',action),
    clearViewerBrowserData: kind => ipcRenderer.invoke('viewer-browser:clearData',kind),
    onViewerBrowserAddress: callback => {
        const listener=()=>callback();ipcRenderer.on('viewer-browser:address',listener);
        return ()=>ipcRenderer.removeListener('viewer-browser:address',listener);
    },
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
    chooseImageOutputFolder: () => ipcRenderer.invoke("image-generation:choose-output"),
    chooseHashAuditFolders: () => ipcRenderer.invoke("hash-auditor:choose-folders"),
    chooseStorageLibraryParent: () => ipcRenderer.invoke("storage-library:choose-parent"),
    openStorageLibrary: id => ipcRenderer.invoke("storage-library:open", id),
    chooseFolderReviewFolder: () => ipcRenderer.invoke("folder-review:choose-folder"),
    exportHashAudit: (scope, mode) => ipcRenderer.invoke("hash-auditor:export", scope, mode),
    chooseImageManagerFolder: purpose => ipcRenderer.invoke("image-manager:choose-folder", purpose),
    revealManagedImage: id => ipcRenderer.invoke("image-manager:reveal", id),
    saveGif: (value) => ipcRenderer.invoke('gif:save', value),
    chooseGifOutputFolder: () => ipcRenderer.invoke('gif:choose-output'),
    useGifStorageLibrary: () => ipcRenderer.invoke('gif:use-library'),
    revealGif: (id) => ipcRenderer.invoke('gif:reveal', id),
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
