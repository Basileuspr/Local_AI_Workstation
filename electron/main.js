/**
 * Electron Main Process
 * =====================
 * JAVASCRIPT SIDE OF THE WALL
 * 
 * This file does three things:
 * 1. Creates the desktop window
 * 2. Starts the Python backend automatically
 * 3. Shuts everything down cleanly when you close the app
 * 
 * It does NOT do any AI logic. That's Python's job.
 */

const { app, BrowserWindow, WebContentsView, session, Tray, Menu, nativeImage, clipboard, ClipboardItem, screen, shell, ipcMain, dialog, protocol, net } = require("electron");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");
const { createLogger, logFilePath } = require("./logger");
const { openDriveRoot } = require("./driveFolders");
const { createDriveSpace } = require("./driveSpace");
const { buildContextMenu } = require("./contextMenu");
const { pathToFileURL } = require("url");
const { randomUUID } = require("crypto");
const { pickFiles } = require("./filePicker");
const { createFaceImports, saveFaceFolder } = require("./faceFiles");
const { createMaintenance } = require("./maintenance");
const { clearDesktopStorage } = require("./maintenanceStorage");
const { trustedUrl, externalUrl, appAsset, APP_HEADERS } = require("./security");
const { migratePreferences } = require("./preferenceMigration");
const { createMediaManager } = require("./mediaManager");
const { installAudioPermissions } = require('./audioPermissions');
const { createViewerBrowser } = require("./viewerBrowser");
const { createMeshRepair, registerMeshRepairIpc } = require('./meshRepair');
const { mediaManagerPaths } = require("./mediaManagerPaths");
const { createTabCapture } = require("./tabCapture");
const { runDesktopAction, writeClipboardImage } = require("./desktopFunctions");
const { createProgramLaunchers } = require("./programLaunchers");
const { createGitHubPublisher } = require("./githubPublisher");
const { createFunctionWorkflows } = require('./functionWorkflows');
const { backendFailure, pythonPreflight, desktopCapabilities } = require("./compatibility");
const { readBuildInfo } = require("./buildInfo");
const { configureRendering, attachWindowRendering } = require('./windowRendering');
const { stopBackendProcess, createAppShutdown, applicationMenu } = require('./appShutdown');
// Capture once for this process. A later source build must not relabel a running desktop.
const desktopBuild = readBuildInfo(path.resolve(__dirname, ".."));
if (process.env.LAW_USER_DATA_DIR) app.setPath("userData", path.resolve(process.env.LAW_USER_DATA_DIR));
// Keep the image catalog beside Media Manager's private runtime storage,
// outside app data and independent of reset/import and renderer preferences.
process.env.LAW_IMAGE_MANAGER_DIR ||= path.join(app.getPath("userData"), "image-manager");
const rendering = configureRendering({ app, log: createLogger('rendering') });
const maintenanceToken = randomUUID();
const localFilesToken = randomUUID();
const launchId = randomUUID();
// Proves a request came from this launch of this app. Generated per run, shared
// with the backend over its environment and with the renderer over guarded IPC, and
// gone when the process exits. Never written to disk.
const sessionToken = require("crypto").randomBytes(32).toString("hex");
const reviewBridgeToken = require("crypto").randomBytes(32).toString("hex");

// A packaged build used to load from file://, whose origin serializes as "null"
// -- the same origin every sandboxed iframe on the web gets. Serving the built
// renderer over a private scheme gives it an origin the backend can name.
const APP_SCHEME = "app";
const APP_ORIGIN = `${APP_SCHEME}://local`;
protocol.registerSchemesAsPrivileged([{
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

const log = createLogger("electron");
const backendLog = createLogger("backend");

// --- State ---
let mainWindow = null;
let windowRendering = null;
let tray = null;
let pythonProcess = null;
let isQuitting = false;
let backendState = { state: "starting", detail: "Starting the local backend…" };

// --- Configuration ---
const isDev = !app.isPackaged;
// The Vite dev server is used, and trusted with the session token, only when
// explicitly requested; otherwise any process answering on its port would be.
const useViteDev = isDev && process.env.LAW_VITE_DEV === "1";

// Environment overrides use the same LAW_ prefix as the Python side, so one
// variable configures both halves of the app.
const envInt = (name, fallback) => {
    const parsed = Number(process.env[name] || "");
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
const envPort = (name, fallback) => {
    const port = envInt(name, fallback);
    if (port > 65535 || (process.env[name] && String(port) !== process.env[name].trim())) {
        log.warn(`${name} is not a valid TCP port; using ${fallback}`);
        return fallback;
    }
    return port;
};
if (process.env.LAW_HOST && process.env.LAW_HOST !== "127.0.0.1") {
    log.warn("LAW_HOST ignored: the local API uses 127.0.0.1. Use PC bridge for network access.");
}

const CONFIG = {
    // The port the backend is *asked* to use. If it is busy we pick another and
    // update this, so it always reflects where the backend actually is.
    backendPort: envPort("LAW_PORT", 8000),
    backendHost: "127.0.0.1",
    vitePort: envPort("LAW_VITE_PORT", 5173),
    pythonPath: process.env.LAW_PYTHON || path.join(__dirname, "..", "venv", "Scripts", "python.exe"),
    backendScript: path.join(__dirname, "..", "backend", "main.py"),
    frontendDistPath: path.join(__dirname, "..", "dist", "index.html"),
    backendTimeout: Math.min(envInt("LAW_BACKEND_TIMEOUT_MS", 90000), 300000),
    healthCheckInterval: 500,
};

CONFIG.viteDevUrl = `http://localhost:${CONFIG.vitePort}`;
const driveSpace = createDriveSpace({
    startWorker: root => spawn(CONFIG.pythonPath, [path.join(__dirname, "..", "backend", "drive_space.py"), root], {
        cwd: path.join(__dirname, ".."), windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    }),
});

const { directory: mediaDirectory, reports: mediaReports } = mediaManagerPaths({
    root: path.join(__dirname, ".."), desktop: app.getPath("desktop"), userData: app.getPath("userData"),
});
const mediaPython = process.env.LAW_MEDIA_MANAGER_PYTHON || CONFIG.pythonPath;
let workspaceFind;
const watchWorkspaceFind = (contents, target) => workspaceFind?.watch(contents, target);
const mediaManager = createMediaManager({
    WebContentsView, session, getWindow: () => mainWindow,
    python: mediaPython,
    directory: mediaDirectory,
    reports: mediaReports,
    reviewConnection: () => ({ base: `http://127.0.0.1:${CONFIG.backendPort}`, token: reviewBridgeToken }),
    watchFind: watchWorkspaceFind,
});

function trustedDesktop(event) {
    const contents = mainWindow?.webContents;
    if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame) {
        return false;
    }
    return trustedUrl(event.senderFrame.url, useViteDev ? CONFIG.viteDevUrl : null);
}

const browserWorkflowDirectory = path.join(app.getPath('userData'), 'browser-workflows');
async function browserMediaRequest(id, action, body) {
    if(!/^[a-f0-9]{32}$/.test(id) || !['verify','cancel'].includes(action))throw Error('Invalid browser media operation.');
    const response=await fetch(`http://127.0.0.1:${CONFIG.backendPort}/browser-media/${id}/${action}`, {
        method:'POST',headers:{'Content-Type':'application/json','x-law-session':sessionToken,'x-local-files':localFilesToken},
        body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(action==='verify'?115000:5000),redirect:'error',
    });
    if(!response.ok)throw Error('media_verification_failed');
    return response.json();
}
const browserProfiles = require('./browserProfiles').createBrowserProfiles(app.getPath('userData'));
const browserWindows = require('./browserWindows').createBrowserWindows({BrowserWindow, profileRegistry:browserProfiles,
    getMainWindow:()=>mainWindow,devUrl:useViteDev ? CONFIG.viteDevUrl : null,
    createBrowser:options=>createViewerBrowser({WebContentsView,session,dialog,profileDirectory:app.getPath('userData'),...options}),
    onCreate:window=>attachWindowRendering({window,screen,log}),onError:error=>log.warn('Browser window cleanup failed:',error.message)});
const viewerBrowser = createViewerBrowser({WebContentsView, session, dialog, getWindow:()=>mainWindow, watchFind:watchWorkspaceFind,
    profileRegistry:browserProfiles,beforeClearProfile:id=>browserWindows.closeProfile(id),
    profileDirectory:app.getPath('userData'),workflowDirectory:browserWorkflowDirectory,
    prepareMedia:(id,body)=>browserMediaRequest(id,'verify',body),cancelMedia:id=>browserMediaRequest(id,'cancel').catch(()=>null)});
async function reelsBackendRequest(action, value={}) {
    const routes={state:['GET','/reels/state'],preflight:['POST','/reels/preflight'],create:['POST','/reels/batches'],clear:['POST','/reels/clear-cache']};
    let endpoint=routes[action],body=value;
    if(['checkpoint','cancel','analyze'].includes(action)) {
        const {batchId,index,...payload}=value;
        if(!/^[a-f0-9]{32}$/.test(batchId) || action==='analyze' && (!Number.isInteger(index)||index<0||index>99))throw Error('Invalid reel operation.');
        endpoint=['POST',`/reels/batches/${batchId}/${action==='analyze'?`items/${index}/analyze`:action}`];
        body=action==='checkpoint'?{...payload,...(index!==undefined?{index}:{})}:payload;
    }
    if(!endpoint)throw Error('Unsupported reel operation.');
    const [method,route]=endpoint;
    const response=await fetch(`http://127.0.0.1:${CONFIG.backendPort}${route}`,{
        method,headers:{'Content-Type':'application/json','x-law-session':sessionToken,'x-local-files':localFilesToken},
        body:method==='POST'?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(action==='analyze'?50*60*1000:30000),
    });
    if(!response.ok){const data=await response.json().catch(()=>({}));throw Error(typeof data.detail==='string'?data.detail:'Reels operation unavailable.');}
    return response.json();
}
const reelsAnalyzer=require('./reelsAnalyzer').createReelsAnalyzer({browser:viewerBrowser,request:reelsBackendRequest});
const webResearch=require('./webResearch').createWebResearch({browser:viewerBrowser,busy:()=>reelsAnalyzer.busy(),request:async(route,body)=>{
    const response=await fetch(`http://127.0.0.1:${CONFIG.backendPort}${route}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(35000),
        headers:{'Content-Type':'application/json','x-law-session':sessionToken,'x-local-files':localFilesToken},body:JSON.stringify(body)});
    const data=await response.json();if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:'Web operation unavailable.');return data;
}});
for(const action of ['background','read'])ipcMain.handle(`web-research:${action}`,async(event,value)=>{
    if(!trustedDesktop(event))return {error:'Desktop access required.'};
    try{return await webResearch[action](value);}catch(error){return {error:require('./redactSecrets').redactSecrets(error.message).slice(0,400)};}
});
for(const action of ['state','controls','discover','start','pause','resume','cancel','clear'])ipcMain.handle(`reels:${action}`,async(event,value)=>{
    if(!trustedDesktop(event))return {error:'Desktop access required.'};
    try{return await reelsAnalyzer[action](value);}catch(error){return {error:require('./redactSecrets').redactSecrets(error.message).slice(0,400)};}
});
const {createBrowserBookmarks,registerBrowserBookmarkIpc}=require('./browserBookmarks');
registerBrowserBookmarkIpc({ipcMain,store:createBrowserBookmarks(app.getPath('userData')),
    trustedDesktop:event=>trustedDesktop(event) || browserWindows.trusted(event),dialog,
    getWindow:event=>browserWindows.windowFor(event) || mainWindow});
const linkedContent = require('./linkedContent').createLinkedContent({WebContentsView, session, getWindow:()=>mainWindow, watchFind:watchWorkspaceFind});
workspaceFind = require('./workspaceFind').createWorkspaceFind({ipcMain, getWindow:()=>mainWindow, trustedDesktop,
    targets: {'browser':()=>viewerBrowser.findContents(), 'media-manager':()=>mediaManager.findContents(), 'integrations':()=>linkedContent.findContents()}});
ipcMain.handle('sound-mixer:configure', (event,value) => {
    if(!trustedDesktop(event))return {error:'Desktop access required.'};
    try {
        const mix=require('./soundMixer').normalizeNativeMix(value);
        viewerBrowser.setMix(mix);browserWindows.setMix(mix);mediaManager.setMix(mix);linkedContent.setMix(mix);
        return {applied:true};
    }catch(error){return {error:error.message};}
});
ipcMain.handle('sound-output:open-settings', async event => {
    if (!trustedDesktop(event) || process.platform !== 'win32') return {error:'Windows Sound settings require the trusted Windows desktop app.'};
    try {await shell.openExternal('ms-settings:sound');return {opened:true};}
    catch {return {error:'Could not open Windows Sound settings. Open Settings → System → Sound in Windows.'};}
});
const playbackCapture = require('./playbackCapture');
ipcMain.handle('linked-content:open', async (event, value) => {
    if (!trustedDesktop(event)) return {error:'Desktop access required.'};
    try { return await linkedContent.open(value); } catch (error) { return {error:error.message}; }
});
ipcMain.handle('linked-content:place', (event, value) => { if (trustedDesktop(event)) linkedContent.place(value); });
ipcMain.handle('linked-content:close', event => { if (trustedDesktop(event)) linkedContent.close(); });
ipcMain.handle('playback-capture:arm', (event, value) => {
    if (!trustedDesktop(event) || process.platform !== 'win32') return {error:'Playback capture requires the Windows desktop app.'};
    try {
        const source = value?.source || 'system';
        if (source === 'spotify' && !linkedContent.spotifyAudioFrame()) return {error:'Open the embedded Spotify player and press Play before recording that source.'};
        playbackCapture.grantPlayback(event.sender, {source}); return {ready:true};
    } catch (error) { return {error:error.message}; }
});
ipcMain.handle('playback-capture:status', event => {
    if (!trustedDesktop(event)) return {supported:false,error:'Playback capture requires the Windows desktop app.'};
    return {...playbackCapture.playbackCaptureStatus(event.sender), spotify_ready: Boolean(linkedContent.spotifyAudioFrame())};
});
ipcMain.handle('playback-capture:cancel', event => { if (trustedDesktop(event)) playbackCapture.revokePlayback(event.sender); });
const saveConvertedImage = require('./convertedImages').createConvertedImageSaver({
    getResponse: id => fetch(`http://127.0.0.1:${CONFIG.backendPort}/workspaces/converted/${id}`, {
        headers: {'X-LAW-Session': sessionToken}, redirect:'error', signal:AbortSignal.timeout(30000)}),
    showDialog: options => dialog.showSaveDialog(mainWindow, options),
    downloads: () => app.getPath('downloads'),
});
ipcMain.handle('converted-image:save', async (event, id) => {
    if (!trustedDesktop(event)) return {error:'Desktop access is required to save a converted image.'};
    try { return await saveConvertedImage(id); } catch (error) { return {error:error.message}; }
});
const meshRepair = createMeshRepair({dialog, getWindow: () => mainWindow,
    onProgress: value => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mesh-repair:progress', value); },
});
registerMeshRepairIpc({ipcMain, service: meshRepair, trustedDesktop});
require('./modelEditor').registerModelEditorIpc({ipcMain, dialog, getWindow: () => mainWindow, trustedDesktop});
require('./paintFiles').registerPaintIpc({ipcMain, dialog, getWindow: () => mainWindow, trustedDesktop, BrowserWindow});
const tabCapture = createTabCapture({ BrowserWindow, screen, clipboard, ClipboardItem, getWindow: () => mainWindow, mediaManager, viewerBrowser });
ipcMain.handle('browser-window:new',async event=>{
    const browser=trustedDesktop(event) ? viewerBrowser : browserWindows.controller(event);
    if(!browser)return {error:'Desktop access required.'};
    try{return await browserWindows.open(browser);}catch(error){return {error:error.message};}
});
for (const action of ['start','state','place','navigate','inspect','source','command','clearData','profiles','createProfile','selectProfile',
    'createTab','selectTab','closeTab','shortcut','setTabSettings','startWorkflow','browserTool','workflowState','cancelWorkflow','resumeWorkflow','clearWorkflowMedia','releaseWorkflowMedia']) {
    ipcMain.handle(`viewer-browser:${action}`, async (event,value)=>{
        const main=trustedDesktop(event),browser=main ? viewerBrowser : browserWindows.controller(event);
        if(!browser || !main && !browserWindows.allows(action))return {error:'Desktop access required.'};
        if(['startWorkflow','browserTool','cancelWorkflow','resumeWorkflow'].includes(action) && reelsAnalyzer.busy())return {error:'Pause or cancel Reels processing before controlling this page with another workflow.'};
        if(['clearWorkflowMedia','releaseWorkflowMedia'].includes(action) && reelsAnalyzer.busy())return {error:'Cancel Reels processing and wait for it to stop before clearing workflow media.'};
        try {
            const result = await browser[action](value);
            if (action === 'place' && result) windowRendering?.repaint();
            return result;
        }
        catch(error){return {error:error.message};}
    });
}
let desktopActionBusy = false;
ipcMain.handle("functions:copy-image", async (event, value) => {
    if (!trustedDesktop(event)) return { error: "Desktop access required." };
    try { return await writeClipboardImage(value, { clipboard, nativeImage, ClipboardItem }); }
    catch (error) { return { error: error.message }; }
});
ipcMain.handle("functions:capture-tab", async (event, tab) => {
    if (!trustedDesktop(event)) return { error: "Desktop access required." };
    try { return await tabCapture.capture(tab); }
    catch (error) { return { error: error.message }; }
});
ipcMain.handle("functions:run-action", async (event, action) => {
    if (!trustedDesktop(event)) return { error: "Desktop access required." };
    if (desktopActionBusy || functionWorkflows.busy) return { error: "Another desktop action or function is running." };
    desktopActionBusy = true;
    try { return await runDesktopAction(action); }
    catch (error) { return { error: error.message }; }
    finally { desktopActionBusy = false; }
});
const programLaunchers = createProgramLaunchers({ file: path.join(app.getPath("userData"), "program-launchers.json"), dialog, shell, getWindow: () => mainWindow });
const windowsUtilities = require('./windowsUtilities').createWindowsUtilities({
    file: path.join(app.getPath('userData'), 'windows-utilities.json'), shell, dialog, getWindow: () => mainWindow,
    desktopDirectory: app.getPath('desktop'),
});
for (const method of ['open', 'choose']) {
    ipcMain.handle(`functions:utility-${method}`, async (event, id) => {
        if (!trustedDesktop(event)) return { error: 'Desktop access required.' };
        if (desktopActionBusy || functionWorkflows.busy) return { error: 'Another desktop action or function is running.' };
        desktopActionBusy = true;
        try { return await windowsUtilities[method](id); }
        catch (error) { return { error: error.message }; }
        finally { desktopActionBusy = false; }
    });
}
const functionWorkflows = createFunctionWorkflows({
    file: path.join(app.getPath('userData'), 'function-folders.json'),
    chooseDirectory: async purpose => {
        const result = await dialog.showOpenDialog(mainWindow, { title: purpose === 'audit' ? 'Choose folder to inspect' : 'Choose function output folder',
            properties: purpose === 'audit' ? ['openDirectory', 'dontAddToRecent'] : ['openDirectory', 'createDirectory', 'dontAddToRecent'] });
        return result.canceled ? null : result.filePaths[0];
    },
    openProgram: id => programLaunchers.open(id),
    copyImage: value => writeClipboardImage(value, { clipboard, nativeImage, ClipboardItem }),
    copyText: async text => {
        if (clipboard.writeText) await clipboard.writeText(text);
        else await clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
    },
});
for (const [channel, method] of Object.entries({ 'choose-folder': 'chooseFolder', inspect: 'inspect', start: 'start', state: 'state', stop: 'stop' })) {
    ipcMain.handle(`function-workflows:${channel}`, async (event, value) => {
        if (!trustedDesktop(event)) return { error: 'Desktop access required.' };
        if (channel === 'start' && desktopActionBusy) return { error: 'Another desktop action is starting.' };
        try { return await functionWorkflows[method](value); } catch (error) { return { error: error.message }; }
    });
}
ipcMain.handle("functions:choose-program", async event => {
    if (!trustedDesktop(event)) return { error: "Desktop access required." };
    try { return await programLaunchers.choose(); } catch (error) { return { error: error.message }; }
});
ipcMain.handle("functions:open-program", async (event, id) => {
    if (!trustedDesktop(event)) return { error: "Desktop access required." };
    try { return await programLaunchers.open(id); } catch (error) { return { error: error.message }; }
});

ipcMain.on("app:connection", event => {
    event.returnValue = trustedDesktop(event) ? { base: `http://127.0.0.1:${CONFIG.backendPort}`, token: sessionToken } : null;
});
ipcMain.handle("app:startup-status", async event => trustedDesktop(event) ? refreshBackendHealth() : null);
ipcMain.handle("app:capabilities", event => trustedDesktop(event) ? desktopCapabilities({ mediaDirectory, python: mediaPython }) : null);
ipcMain.handle("app:open-logs", async event => {
    if (!trustedDesktop(event)) return { error: "Desktop access required." };
    const filename = logFilePath();
    if (!filename) return { error: "File logging is unavailable. Start the app from PowerShell to see diagnostics." };
    try { return { error: await shell.openPath(path.dirname(filename)) || null }; }
    catch { return { error: "Windows could not open the log folder." }; }
});

ipcMain.handle('app:rendering-status', event => trustedDesktop(event) ? { ...rendering.state(), ...windowRendering?.state() } : null);
ipcMain.on('app:window-repaint', (event,reason) => { if (trustedDesktop(event)) windowRendering?.repaint({passive:reason==='content'}); });
ipcMain.handle('app:rendering-mode', (event, mode) => {
    if (!trustedDesktop(event)) return null;
    try { return rendering.save(mode); }
    catch (error) { return { ...rendering.state(), error: error.message }; }
});

ipcMain.handle("media-manager:start", event => trustedDesktop(event) ? mediaManager.start() : { error: "Desktop access required." });
ipcMain.handle("media-manager:status", event => trustedDesktop(event) ? mediaManager.status() : { error: "Desktop access required." });
ipcMain.handle("media-manager:place", (event, value) => { if (trustedDesktop(event)) { mediaManager.place(value); windowRendering?.repaint(); } });
ipcMain.handle("media-manager:focus", event => { if (trustedDesktop(event)) return mediaManager.focus(); });
ipcMain.handle("media-manager:refresh", event => trustedDesktop(event) ? mediaManager.refresh() : { error: "Desktop access required." });

ipcMain.handle("dashboard:open-drive-root", async (event, root) => {
    if (!trustedDesktop(event)) return { error: "Open drive is only available in the desktop app." };
    return openDriveRoot(root, (target) => shell.openPath(target));
});
ipcMain.handle("dashboard:scan-drive", (event, root) => trustedDesktop(event) ? driveSpace.start(root) : { error: "Desktop access required." });
ipcMain.handle("hash-auditor:choose-folders", async event => {
    if (!trustedDesktop(event)) return { error: "Desktop access required." };
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: "Choose folders or drive roots for Hash Auditor",
            properties: ["openDirectory", "multiSelections", "dontAddToRecent"],
        });
        return { paths: result.canceled ? [] : result.filePaths };
    } catch (error) { return { error: error.message }; }
});
ipcMain.handle("storage-library:choose-parent", async event => {
    if (!trustedDesktop(event)) return { error: "Desktop access required." };
    try {
        const result = await dialog.showOpenDialog(mainWindow, { title: "Choose a parent folder or drive for an app library", properties: ["openDirectory", "dontAddToRecent"] });
        return { folder: result.canceled ? null : result.filePaths[0] };
    } catch (error) { return { error: error.message }; }
});
ipcMain.handle("storage-library:open", async (event, id) => {
    if (!trustedDesktop(event)) return { error: "Desktop access required." };
    if (typeof id !== "string" || !/^(primary|[a-f0-9]{32})$/.test(id)) return { error: "Choose a registered library." };
    try {
        const response = await fetch(`http://127.0.0.1:${CONFIG.backendPort}/storage-libraries/${id}/location`, { headers: { "X-LAW-Session": sessionToken }, redirect: "error", signal: AbortSignal.timeout(10000) });
        const result = await response.json();
        if (!response.ok || !result.path) return { error: result.detail || "Library is unavailable." };
        return { error: await shell.openPath(result.path) || null };
    } catch (error) { return { error: error.message }; }
});
ipcMain.handle("folder-review:choose-folder", async event => {
    if (!trustedDesktop(event)) return { error: "Desktop access required." };
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: "Choose a folder for Folder Review", properties: ["openDirectory", "dontAddToRecent"],
        });
        return { path: result.canceled ? null : result.filePaths[0] };
    } catch (error) { return { error: error.message }; }
});
ipcMain.handle("hash-auditor:export", async (event, scope, mode) => {
    if (!trustedDesktop(event)) return { error: "Desktop access required." };
    if (!["inventory", "matches"].includes(scope) || !["hash", "name_size", "size_modified", "name_size_modified"].includes(mode))
        return { error: "Choose a supported inventory or match export." };
    try {
        // Stream large inventories to the native download manager without
        // navigating the renderer or holding the entire CSV in its memory.
        const query = new URLSearchParams({ scope, mode });
        event.sender.downloadURL(`http://127.0.0.1:${CONFIG.backendPort}/hash-auditor/export?${query}`, {
            headers: { "X-LAW-Session": sessionToken },
        });
        return { started: true };
    } catch (error) { return { error: error.message }; }
});
ipcMain.handle("dashboard:drive-scan-status", (event, id) => trustedDesktop(event) ? driveSpace.status(id) : { error: "Desktop access required." });
ipcMain.handle("dashboard:cancel-drive-scan", (event, id) => trustedDesktop(event) ? driveSpace.cancel(id) : { error: "Desktop access required." });

ipcMain.handle("dashboard:software-runtime", event => trustedDesktop(event) ? {
    app: app.getVersion(), electron: process.versions.electron, chromium: process.versions.chrome,
    node: process.versions.node, v8: process.versions.v8, architecture: process.arch,
    build: desktopBuild,
} : null);

ipcMain.handle("dashboard:open-app-folder", async (event) => {
    if (!trustedDesktop(event)) return { error: "Open app folder is only available in the desktop app." };
    // Resolve the running app's location here; the renderer supplies no path.
    const folder = app.isPackaged ? path.dirname(app.getPath("exe")) : path.resolve(__dirname, "..");
    try {
        const error = await shell.openPath(folder);
        return { error: error || null };
    } catch {
        return { error: "Could not open the app folder in File Explorer." };
    }
});

const githubPublisher = createGitHubPublisher({ root: path.resolve(__dirname, '..'), storage: path.join(app.getPath('userData'), 'github-publications') });
for (const [channel, method] of Object.entries({ prepare: 'prepare', validate: 'validate', commit: 'commit', push: 'push', state: 'state' })) {
    ipcMain.handle(`github-publication:${channel}`, (event, request) => {
        if (!trustedDesktop(event)) return { error: 'Desktop access required.' };
        try { return githubPublisher[method](request); } catch (error) { return { error: error.message }; }
    });
}
ipcMain.handle('github-publication:log', async event => {
    if (!trustedDesktop(event)) return { error: 'Desktop access required.' };
    const file = githubPublisher.log();
    if (!file) return { error: 'No publication log is available yet.' };
    return { error: (await shell.openPath(file)) || null };
});

const gifFiles = require('./gifFiles').createGifFiles({
    showSaveDialog: options => dialog.showSaveDialog(mainWindow, options),
    showOpenDialog: options => dialog.showOpenDialog(mainWindow, options),
    showItemInFolder: filename => shell.showItemInFolder(filename),
    downloads: () => app.getPath('downloads'),
});
ipcMain.handle('gif:save', (event, value) => trustedDesktop(event) ? gifFiles.save(value) : {error: 'Desktop access required.'});
ipcMain.handle('gif:choose-output', event => trustedDesktop(event) ? gifFiles.chooseOutput() : {error:'Desktop access required.'});
ipcMain.handle('gif:use-library', async event => {
    if (!trustedDesktop(event)) return {error:'Desktop access required.'};
    try {
        const response = await fetch(`http://127.0.0.1:${CONFIG.backendPort}/storage-libraries/export-folder/gifs`, { method: 'POST', headers: {'X-LAW-Session':sessionToken}, redirect:'error', signal:AbortSignal.timeout(10000) });
        const result = await response.json();
        if (!response.ok || !result.folder) return {error:result.detail || 'Storage library is unavailable.'};
        return await gifFiles.useLibrary(result.folder);
    } catch (error) {return {error:error.message};}
});
ipcMain.handle('gif:reveal', (event, id) => trustedDesktop(event) ? gifFiles.reveal(id) : {error: 'Desktop access required.'});

let pickerOpen = false;
ipcMain.handle("image-manager:choose-folder", async (event, purpose) => {
    if (!trustedDesktop(event) || !["source", "output"].includes(purpose)) return { error: "Choose an image folder in the desktop app." };
    if (pickerOpen) return { canceled: true };
    pickerOpen = true;
    try {
        const result = await dialog.showOpenDialog(mainWindow, { title: purpose === "source" ? "Choose a still-image folder" : "Choose an Image Manager output folder", defaultPath: app.getPath("pictures"), properties: purpose === "output" ? ["openDirectory", "createDirectory"] : ["openDirectory"] });
        return result.canceled ? { canceled: true } : { path: result.filePaths[0] };
    } catch (error) { return { error: error.message }; }
    finally { pickerOpen = false; }
});
ipcMain.handle("image-manager:reveal", async (event, id) => {
    if (!trustedDesktop(event) || typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id)) return { error: "Choose a catalog image." };
    try {
        const response = await fetch(`http://127.0.0.1:${CONFIG.backendPort}/image-manager/images/${id}/location`, { headers: { "X-LAW-Session": sessionToken }, redirect: "error", signal: AbortSignal.timeout(10000) });
        const value = await response.json();
        if (!response.ok || typeof value.path !== "string" || !path.isAbsolute(value.path)) throw new Error(typeof value.detail === "string" ? value.detail : "Image unavailable. Scan again.");
        shell.showItemInFolder(value.path);
        return { ok: true };
    } catch (error) { return { error: error.message }; }
});
ipcMain.handle("image-generation:choose-output", async event => {
    if (!trustedDesktop(event)) return { error: "Output folder selection requires the desktop app." };
    if (pickerOpen) return { canceled: true };
    pickerOpen = true;
    try {
        const { chooseOutputFolder } = require("./outputFolder");
        return await chooseOutputFolder({ home: app.getPath("pictures"), showDialog: options => dialog.showOpenDialog(mainWindow, options) });
    } catch (error) { return { error: error.message }; }
    finally { pickerOpen = false; }
});
ipcMain.handle("uploads:choose", async (event, options) => {
    if (!trustedDesktop(event)) return { error: "Uploads are only available in the desktop app." };
    if (pickerOpen) return { canceled: true };
    pickerOpen = true;
    try {
        return await pickFiles(options || {}, { home: app.getPath("home"), showDialog: options => dialog.showOpenDialog(mainWindow, options) });
    } catch (error) { return { error: error.message }; }
    finally { pickerOpen = false; }
});

const localFiles = require('./localFiles').createLocalFiles({
    home: app.getPath('home'),
    openDialog: options => dialog.showOpenDialog(mainWindow, options),
    saveDialog: options => dialog.showSaveDialog(mainWindow, options),
    confirm: async (message, detail) => (await dialog.showMessageBox(mainWindow, {
        type: 'warning', message, detail, buttons: ['Cancel', 'Continue'], defaultId: 0, cancelId: 0,
    })).response === 1,
    request: async (route, body) => {
        const response = await fetch(`http://127.0.0.1:${CONFIG.backendPort}/local-files${route}`, {
            method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-law-session': sessionToken, 'x-local-files': localFilesToken },
            body: body ? JSON.stringify(body) : undefined,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Local file operation failed.');
        return result;
    },
});
for (const action of ['open', 'save']) ipcMain.handle(`local-files:${action}`, async (event, value) => {
    if (!trustedDesktop(event)) return { error: 'Local files require the trusted desktop window.' };
    if (pickerOpen) return { canceled: true };
    pickerOpen = true;
    try { return await localFiles[action](value); }
    catch (error) { return { error: error.message }; }
    finally { pickerOpen = false; }
});
ipcMain.on('local-files:dirty', (event, value) => { if (trustedDesktop(event)) localFiles.setDirty(value); });
ipcMain.on('local-files:forget', (event, value) => { if (trustedDesktop(event)) localFiles.forget(value); });

const faceImports = createFaceImports();
ipcMain.handle("faces:choose-inputs", async (event, options) => {
    if (!trustedDesktop(event)) return { error: "Face imports are only available in the desktop app." };
    if (pickerOpen) return { canceled: true };
    pickerOpen = true;
    try {
        return await faceImports.choose(event.sender.id, { directory: options?.directory === true }, {
            home: app.getPath("home"), showDialog: options => dialog.showOpenDialog(mainWindow, options),
        });
    } catch (error) { return { error: error.message }; }
    finally { pickerOpen = false; }
});
ipcMain.handle("faces:read-inputs", async (event, ticket) => {
    if (!trustedDesktop(event)) return { error: "Untrusted face import request." };
    try { return await faceImports.next(event.sender.id, ticket); }
    catch (error) { return { error: error.message }; }
});
ipcMain.handle("faces:release-inputs", (event, ticket) => {
    if (!trustedDesktop(event)) return { error: "Untrusted face import request." };
    return faceImports.release(event.sender.id, ticket);
});
let faceExporting = false;
ipcMain.handle("faces:save-folder", async (event, selection) => {
    if (!trustedDesktop(event)) return { error: "Folder export is only available in the desktop app." };
    if (pickerOpen || faceExporting) return { canceled: true };
    pickerOpen = true; faceExporting = true;
    try {
        return await saveFaceFolder(selection || {}, {
            home: app.getPath("home"),
            showDialog: options => dialog.showOpenDialog(mainWindow, options),
            request: async route => {
                const response = await fetch(`http://127.0.0.1:${CONFIG.backendPort}${route}`, {
                    headers: { "X-LAW-Session": sessionToken }, redirect: "error", signal: AbortSignal.timeout(30000),
                });
                if (!response.ok) throw new Error("Could not read saved face crops from the backend.");
                return response;
            },
        });
    } catch (error) { return { error: error.message }; }
    finally { pickerOpen = false; faceExporting = false; }
});

function runMaintenance(request) {
    return new Promise((resolve, reject) => {
        const child = spawn(CONFIG.pythonPath, [path.join(__dirname, "..", "backend", "maintenance.py")], {
            cwd: path.join(__dirname, ".."), env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
        });
        let output = "";
        child.stdout.on("data", chunk => { output += chunk.toString(); });
        child.stderr.resume(); // Never echo filenames or user data into logs.
        child.on("error", () => reject(new Error("Could not start the offline maintenance worker.")));
        child.on("close", code => {
            try {
                const result = JSON.parse(output);
                if (code !== 0 || result.error) reject(new Error(result.error || "Maintenance did not finish."));
                else resolve(result);
            } catch { reject(new Error("Maintenance did not return a valid result.")); }
        });
        child.stdin.on("error", () => {});
        child.stdin.end(JSON.stringify(request));
    });
}

function maintenanceRequest(action) {
    return new Promise((resolve, reject) => {
        const request = http.request({ hostname: CONFIG.backendHost, port: CONFIG.backendPort, path: `/maintenance/${action}`, method: "POST", headers: { "x-desktop-maintenance": maintenanceToken, "x-law-session": sessionToken } }, response => {
            let body = "";
            response.on("data", chunk => { body += chunk; });
            response.on("end", () => {
                if (response.statusCode === 200) resolve();
                else { let message; try { message = JSON.parse(body).detail; } catch {} reject(new Error(message || "Restart the desktop app to load the reset endpoint.")); }
            });
        });
        request.on("error", () => reject(new Error("The app backend is unavailable.")));
        request.setTimeout(10000, () => request.destroy());
        request.end();
    });
}

const { createDependencyMaintenance } = require('./dependencyMaintenance');
function runDependencyMaintenance(request) {
    return new Promise((resolve, reject) => {
        const child = spawn(CONFIG.pythonPath, ['-m', 'services.dependency_management'], {
            cwd: path.join(__dirname, '..', 'backend'),
            env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
            windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', chunk => { output += chunk.toString(); });
        child.stderr.resume();
        child.on('error', () => reject(new Error('Dependency worker could not start.')));
        child.on('close', code => {
            try {
                const result = JSON.parse(output);
                if (code || result.error) reject(new Error(result.error || 'Dependency operation failed.'));
                else resolve(result);
            } catch { reject(new Error('Invalid dependency worker result.')); }
        });
        child.stdin.on('error', () => {});
        child.stdin.end(JSON.stringify(request));
    });
}
const dependencyMaintenance = createDependencyMaintenance({
    run: runDependencyMaintenance, ownsBackend: () => Boolean(pythonProcess),
    lockBackend: () => maintenanceRequest('lock'), unlockBackend: () => maintenanceRequest('unlock'),
    stopBackend: stopBackendForReset,
    startBackend: async () => { startPythonBackend(); await waitForBackend(); },
    onRestartFailure: message => { backendState = { state: 'failed', detail: `Dependency maintenance finished but backend restart failed: ${message}` }; },
});
ipcMain.handle('dependencies:prepare', (event, value) => trustedDesktop(event) ? dependencyMaintenance.prepare(value?.name, value?.profile) : { error: 'Desktop access required.' });
ipcMain.handle('dependencies:apply', (event, value) => trustedDesktop(event) ? dependencyMaintenance.apply(value?.ticket, value?.approved) : { error: 'Desktop access required.' });
ipcMain.handle('dependencies:cancel', (event, ticket) => trustedDesktop(event) ? dependencyMaintenance.cancel(ticket) : { error: 'Desktop access required.' });

async function stopBackendForReset() {
    const child = pythonProcess;
    if (!child) throw new Error("The desktop no longer owns its backend; reset was stopped.");
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Backend did not close. Nothing was deleted.")), 15000);
        child.once("close", () => { clearTimeout(timeout); resolve(); });
        if (process.platform === "win32") {
            const killer = spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], { windowsHide: true, stdio: "ignore" });
            killer.once("error", () => { clearTimeout(timeout); reject(new Error("Could not close the backend. Nothing was deleted.")); });
        } else child.kill("SIGTERM");
    });
}

const maintenance = createMaintenance({
    chooseArchive: (kind = "inventory") => dialog.showSaveDialog(mainWindow, {
        title: kind === "backup" ? "Export private application backup" : "Save metadata inventory (not a content backup)",
        defaultPath: path.join(app.getPath("documents"), `workstation-${kind}-${Date.now()}.zip`),
        filters: [{ name: "ZIP archive", extensions: ["zip"] }], properties: ["dontAddToRecent"],
    }),
    chooseImport: () => dialog.showOpenDialog(mainWindow, {
        title: "Import a Workstation backup", defaultPath: app.getPath("documents"),
        filters: [{ name: "Workstation backup ZIP", extensions: ["zip"] }], properties: ["openFile", "dontAddToRecent"],
    }),
    run: runMaintenance,
    ownsBackend: () => Boolean(pythonProcess), backendHealthy: isBackendHealthy,
    lockBackend: () => maintenanceRequest("lock"), unlockBackend: () => maintenanceRequest("unlock"),
    stopBackend: stopBackendForReset,
    checkRenderer: () => mainWindow.webContents.executeJavaScript(`Boolean(window.localStorage)`),
    freezeRenderer: () => mainWindow.webContents.executeJavaScript(`document.getElementById('root').inert = true`),
    thawRenderer: () => mainWindow.webContents.executeJavaScript(`document.getElementById('root').inert = false`),
    readStorage: () => mainWindow.webContents.executeJavaScript(`Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)]))`),
    clearRenderer: () => clearDesktopStorage(mainWindow.webContents, {}, "App data and personal settings were reset. Image Manager and Media Manager catalogs were retained."),
    restoreRenderer: (values, notice) => clearDesktopStorage(mainWindow.webContents, values, notice),
    clearCache: async () => { await mainWindow.webContents.session.clearCache(); },
    startBackend: async () => { startPythonBackend(); await waitForBackend(); },
    notifyComplete: () => mainWindow?.webContents.send("maintenance:result", { ok: true }),
    notifyFailure: error => mainWindow?.webContents.send("maintenance:result", { error }),
});

ipcMain.handle("maintenance:export", async event => trustedDesktop(event) ? maintenance.exportInventory() : { error: "Desktop access required." });
ipcMain.handle("maintenance:prepare-reset", async event => trustedDesktop(event) ? maintenance.prepareReset() : { error: "Desktop access required." });
ipcMain.handle("maintenance:backup", async event => trustedDesktop(event) ? maintenance.exportBackup() : { error: "Desktop access required." });
ipcMain.handle("maintenance:prepare-import", async event => trustedDesktop(event) ? maintenance.prepareImport() : { error: "Desktop access required." });
ipcMain.handle("maintenance:import", async (event, value) => trustedDesktop(event) ? maintenance.importBackup(value) : { error: "Desktop access required." });
ipcMain.handle("maintenance:import-status", async event => trustedDesktop(event) ? maintenance.importStatus() : { error: "Desktop access required." });
ipcMain.handle("maintenance:recover-import", async event => trustedDesktop(event) ? maintenance.recoverImport() : { error: "Desktop access required." });
ipcMain.handle("maintenance:reset", async (event, value) => trustedDesktop(event) ? maintenance.reset(value) : { error: "Desktop access required." });

/**
 * Find a port that is free to bind.
 *
 * Port 8000 is a popular default, so on an unfamiliar machine it is quite
 * likely to be taken. Rather than failing to start, move to the next free one
 * and tell both the backend and the renderer where to find each other.
 */
function findAvailablePort(host, preferred, attempts = 20) {
    const net = require("net");

    const tryPort = (port) =>
        new Promise((resolve) => {
            const server = net.createServer();
            server.once("error", () => resolve(false));
            server.once("listening", () => server.close(() => resolve(true)));
            server.listen(port, host);
        });

    return (async () => {
        for (let offset = 0; offset < attempts; offset += 1) {
            const candidate = preferred + offset;
            if (candidate > 65535) break;
            if (await tryPort(candidate)) return candidate;
        }
        // Nothing free in range: keep the preferred port so the backend can
        // report the conflict itself with its own actionable message.
        throw new Error("No available local API port. Close the previous workstation backend and retry.");
    })();
}

// --- Python Backend Management ---

function startPythonBackend() {
    if (isQuitting) throw new Error("Application is shutting down.");
    pythonPreflight(CONFIG.pythonPath);
    lastHealthCheck = 0;
    unhealthyChecks = 0;
    backendState = { state: "starting", detail: "Starting the local backend…" };
    let stderr = "";
    let spawnError = "";
    log.info("Starting Python backend:", CONFIG.pythonPath);
    log.info(`Backend will listen on ${CONFIG.backendHost}:${CONFIG.backendPort}`);
    const child = spawn(CONFIG.pythonPath, [CONFIG.backendScript], {
        cwd: path.join(__dirname, ".."),
        // The chosen port wins over any inherited value, so the backend and the
        // renderer cannot disagree about where the API lives.
        env: {
            ...process.env,
            PYTHONUTF8: "1",
            PYTHONIOENCODING: "utf-8",
            LAW_HOST: CONFIG.backendHost,
            LAW_PORT: String(CONFIG.backendPort),
            LAW_SESSION_TOKEN: sessionToken,
            LAW_REVIEW_BRIDGE_TOKEN: reviewBridgeToken,
            LAW_LAUNCH_ID: launchId,
            LAW_DESKTOP_MAINTENANCE_TOKEN: maintenanceToken,
            LAW_LOCAL_FILES_TOKEN: localFilesToken,
            LAW_BROWSER_WORKFLOW_DIR: path.join(browserWorkflowDirectory, 'media'),
            LAW_DESKTOP_CONTROL: "1",
            LAW_DESKTOP_NODE_VERSION: process.versions?.node || '',
            LAW_DESKTOP_ELECTRON_VERSION: process.versions?.electron || '',
        },
        windowsHide: true,
    });
    pythonProcess = child;
    child.stdout.on("data", (data) => {
        backendLog.info(data.toString().trim());
    });
    child.stderr.on("data", (data) => {
        stderr = (stderr + data.toString()).slice(-12000);
        backendLog.warn(data.toString().trim());
    });
    child.on("close", (code) => {
        log.warn(`Python backend exited with code ${code}`);
        if (pythonProcess !== child) return;
        pythonProcess = null;
        if (!isQuitting) backendState = { state: "failed", detail: backendFailure({ code, error: spawnError, stderr }) };
        if (!isQuitting && mainWindow) {
            mainWindow.webContents.executeJavaScript(
                `document.getElementById("status-dot")?.classList.add("error");`
            ).catch(() => {});
        }
    });
    child.on("error", (err) => {
        spawnError = err.message;
        if (pythonProcess !== child) return;
        backendState = { state: "failed", detail: backendFailure({ error: err.message, stderr }) };
        log.error("Failed to start Python backend:", err);
    });
}

function stopPythonBackend() {
    return stopBackendProcess(pythonProcess, { spawn, log });
}

function waitForBackend() {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        let settled = false;
        const check = () => {
            if (settled) return;
            if (!pythonProcess) { settled = true; reject(new Error(backendState.detail)); return; }
            let requestFinished = false;
            const retryRequest = () => {
                if (requestFinished || settled) return;
                requestFinished = true;
                retry();
            };
            const req = http.get(
                `http://${CONFIG.backendHost}:${CONFIG.backendPort}/health`,
                (res) => {
                    if (res.statusCode === 200 && res.headers["x-law-launch"] === launchId) {
                        requestFinished = true;
                        settled = true;
                        res.resume();
                        log.info("Backend is ready");
                        backendState = { state: "ready", detail: null };
                        resolve();
                    } else {
                        res.resume();
                        retryRequest();
                    }
                }
            );
            req.on("error", retryRequest);
            req.setTimeout(1000, () => { req.destroy(); retryRequest(); });
        };
        const retry = () => {
            if (settled) return;
            if (Date.now() - startTime > CONFIG.backendTimeout) {
                settled = true;
                reject(new Error("The backend is taking longer than expected. It may still finish loading. Use Refresh after a moment, or open the logs for the cause. No second backend has been started."));
            } else {
                setTimeout(check, CONFIG.healthCheckInterval);
            }
        };
        check();
    });
}

function isBackendHealthy() {
    return new Promise((resolve) => {
        const req = http.get(
            `http://${CONFIG.backendHost}:${CONFIG.backendPort}/health`,
            (res) => {
                res.resume();
                resolve(res.statusCode === 200 && res.headers["x-law-launch"] === launchId);
            }
        );
        req.on("error", () => resolve(false));
        req.setTimeout(1000, () => { req.destroy(); resolve(false); });
    });
}

function resetThinkingTrace() {
    return new Promise((resolve) => {
        const req = http.request(
            {
                hostname: CONFIG.backendHost,
                port: CONFIG.backendPort,
                path: "/thinking/reset",
                method: "POST",
                headers: { "x-law-session": sessionToken },
            },
            (res) => {
                res.resume();
                resolve(res.statusCode === 200);
            }
        );
        req.on("error", () => resolve(false));
        req.setTimeout(2000, () => { req.destroy(); resolve(false); });
        req.end();
    });
}

async function selectBackendPort() {
    // An unrelated service (or an old launch with a different secret) must
    // never receive this launch's credentials or be mistaken for our backend.
    const chosen = await findAvailablePort(CONFIG.backendHost, CONFIG.backendPort);
    if (chosen !== CONFIG.backendPort) {
        log.warn(`Port ${CONFIG.backendPort} is in use; falling back to ${chosen}`);
        CONFIG.backendPort = chosen;
    }

}

let healthRefresh = null, lastHealthCheck = 0, unhealthyChecks = 0;
async function refreshBackendHealth() {
    if (!pythonProcess || backendState.state === "starting" || isQuitting) return backendState;
    if (healthRefresh) return healthRefresh;
    if (Date.now() - lastHealthCheck < 5000) return backendState;
    const child = pythonProcess;
    healthRefresh = (async () => {
        const healthy = await isBackendHealthy();
        if (pythonProcess !== child || isQuitting) return backendState;
        unhealthyChecks = healthy ? 0 : unhealthyChecks + 1;
        if (healthy && backendState.state !== "ready") {
            log.info("Backend health recovered");
            backendState = { state: "ready", detail: null };
        } else if (!healthy && unhealthyChecks >= 3 && backendState.state === "ready") {
            log.warn("Owned backend is not answering health checks");
            backendState = { state: "unresponsive", detail: "The local backend is not responding. Work may still be running. Health checks will continue; open the logs for details." };
        }
        return backendState;
    })();
    try { return await healthRefresh; }
    finally { lastHealthCheck = Date.now(); healthRefresh = null; }
}

// --- Window Management ---

/**
 * Query string handed to the renderer.
 *
 * The renderer has no access to environment variables, so this is how it
 * learns which port the backend actually ended up on.
 */
function rendererQuery() {
    // Only the non-secret port rides in the document URL. The sandboxed preload
    // receives the credential over a main-frame-only IPC channel.
    return `apiPort=${CONFIG.backendPort}`;
}

/**
 * Serve the built renderer over app://, from the build directory only.
 *
 * Path traversal is refused by resolving the request and confirming it stays
 * inside dist/; anything else 404s rather than reading an arbitrary file.
 */
function registerAppProtocol() {
    const root = path.dirname(CONFIG.frontendDistPath);
    protocol.handle(APP_SCHEME, async (request) => {
        try {
            if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405 });
            const target = new URL(request.url).pathname === "/recovery.html" && trustedUrl(request.url)
                ? path.join(__dirname, "recovery.html") : appAsset(root, request.url);
            const response = await net.fetch(pathToFileURL(target).toString());
            for (const [key, value] of Object.entries(APP_HEADERS)) response.headers.set(key, value);
            return response;
        } catch {
            return new Response("Not found", { status: 404 });
        }
    });
}

/**
 * Remote pages belong in the user's browser, not inside this window.
 *
 * Without these two guards a target=_blank link turns the app into a stripped
 * browser with no address bar, and a stray navigation would put remote content
 * in the window that holds the preload bridge and the session credential.
 */
function guardNavigation(contents) {
    const owner = contents.id;
    contents.on("did-start-navigation", (_event, _url, inPlace, mainFrame) => {
        if (mainFrame && !inPlace) faceImports.release(owner);
    });
    contents.once("destroyed", () => faceImports.release(owner));
    contents.setWindowOpenHandler(({ url }) => {
        if (externalUrl(url) && !trustedUrl(url, CONFIG.viteDevUrl)) void shell.openExternal(url).catch(() => {});
        return { action: "deny" };
    });
    const allowed = url => trustedUrl(url, useViteDev ? CONFIG.viteDevUrl : null);
    contents.on("will-navigate", (event, url) => {
        if (allowed(url)) return;
        event.preventDefault();
        if (externalUrl(url)) void shell.openExternal(url).catch(() => {});
    });
    contents.on("will-frame-navigate", (event) => {
        if (!allowed(event.url)) event.preventDefault();
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());
}

async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200, height: 800, minWidth: 640, minHeight: 520,
        title: "Local AI Workstation",
        backgroundColor: "#080c14",
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true, spellcheck: true, preload: path.join(__dirname, "preload.js") },
    });
    mainWindow.on("close", shutdown.closeWindow);
    workspaceFind.watchHost(mainWindow.webContents);
    mainWindow.on("closed", () => { mainWindow = null; windowRendering = null; });

    windowRendering = attachWindowRendering({ window: mainWindow, screen, log });

    guardNavigation(mainWindow.webContents);
    installAudioPermissions(mainWindow.webContents, useViteDev ? CONFIG.viteDevUrl : null);
    playbackCapture.installPlaybackCapture(mainWindow.webContents, require('electron').desktopCapturer, useViteDev ? CONFIG.viteDevUrl : null, {getSpotifyFrame: linkedContent.spotifyAudioFrame});
    mainWindow.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
        if (isMainFrame) { linkedContent.hide(); playbackCapture.revokePlayback(mainWindow.webContents); }
    });
    mainWindow.once('closed', () => linkedContent.close());
    mainWindow.webContents.on("did-start-navigation", (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) {mediaManager.hide();viewerBrowser.hide();} });
    mainWindow.webContents.on("render-process-gone", async (_event, details) => {
        mediaManager.hide();
        viewerBrowser.hide();
        if (isQuitting || details.reason === "clean-exit") return;
        const result = await dialog.showMessageBox({ type: "error", title: "Desktop view stopped",
            message: "The desktop renderer stopped. Saved data is still on disk; unsaved edits may be lost.",
            detail: "Software rendering can help with incompatible Windows graphics drivers. A restart stops active backend work.",
            buttons: ["Restart with software rendering", "Quit"], defaultId: 1, cancelId: 1 });
        if (result.response === 0) {
            try { rendering.save('software'); } catch (error) { log.warn('Could not save software rendering:', error.message); }
            void shutdown.request({ restart: true, args: [...process.argv.slice(1).filter(arg => arg !== "--law-software-rendering"), "--law-software-rendering"] });
            return;
        }
        app.quit();
    });
    mainWindow.webContents.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
        if (!isQuitting && mainWindow && isMainFrame && code !== -3 && !url.includes("/recovery.html")) {
            void mainWindow.loadURL(`${APP_ORIGIN}/recovery.html`).catch(err => log.error("Recovery view failed:", err.message));
        }
    });
    mainWindow.once("ready-to-show", () => mainWindow.show());
    if (fs.existsSync(CONFIG.frontendDistPath)) {
        try { await migratePreferences({ BrowserWindow, oldPath: CONFIG.frontendDistPath, appUrl: `${APP_ORIGIN}/index.html` }); }
        catch { log.warn("Preference migration was not completed; original preferences were preserved and migration will retry next launch."); }
    }
    if (isQuitting || !mainWindow || mainWindow.isDestroyed()) return;

    if (useViteDev) {
        let viteReady = false;
        try {
            await new Promise((resolve) => {
                const req = http.get(CONFIG.viteDevUrl, (res) => {
                    viteReady = res.statusCode === 200;
                    resolve();
                });
                req.on("error", () => resolve());
                req.setTimeout(2000, () => { req.destroy(); resolve(); });
            });
        } catch {}
        if (viteReady) {
            log.info("Loading renderer from the Vite dev server");
            await mainWindow.loadURL(`${CONFIG.viteDevUrl}/?${rendererQuery()}`).catch(err => log.warn("Renderer load failed:", err.message));
        } else if (fs.existsSync(CONFIG.frontendDistPath)) {
            log.info("Vite not running; loading the built frontend over app://");
            await mainWindow.loadURL(`${APP_ORIGIN}/index.html?${rendererQuery()}`).catch(err => log.warn("Renderer load failed:", err.message));
        } else {
            log.warn("Neither Vite nor dist/ available; opening setup guidance");
            await mainWindow.loadURL(`${APP_ORIGIN}/recovery.html`);
        }
    } else {
        if (fs.existsSync(CONFIG.frontendDistPath)) {
            await mainWindow.loadURL(`${APP_ORIGIN}/index.html?${rendererQuery()}`).catch(err => log.warn("Renderer load failed:", err.message));
        } else {
            log.warn("dist/ is missing; opening setup guidance");
            await mainWindow.loadURL(`${APP_ORIGIN}/recovery.html`);
        }
    }

    if (isQuitting || !mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.on("context-menu", (event, params) => {
        Menu.buildFromTemplate(buildContextMenu(params, mainWindow.webContents)).popup({ window: mainWindow, callback: () => windowRendering?.refresh() });
    });

}

function createTray() {
    const icon = nativeImage.createEmpty();
    tray = new Tray(icon);
    tray.setToolTip("Local AI Workstation");
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: "Open", click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
        { type: "separator" },
        { label: "Exit && Restart", click: () => { void shutdown.request({ restart: true }); } },
        { label: "Quit", click: () => { void shutdown.request(); } },
    ]));
    tray.on("click", () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
}

// --- App Lifecycle ---

app.whenReady().then(async () => {
    if (!gotLock || isQuitting) return;
    log.info(`App starting in ${isDev ? "DEV" : "PROD"} mode`);
    log.info("Logging to", logFilePath() || "(console only)");
    log.info('Window rendering:', rendering.state());
    registerAppProtocol();
    Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenu(shutdown.request)));
    try { await selectBackendPort(); }
    catch (err) { backendState = { state: "failed", detail: err.message }; }
    if (isQuitting) return;
    await createWindow();
    if (isQuitting) return;
    try { createTray(); }
    catch (err) { log.warn("System tray unavailable:", err.message); tray = null; }
    if (!isQuitting && backendState.state !== "failed") {
        try { startPythonBackend(); await waitForBackend(); await resetThinkingTrace(); }
        catch (err) { backendState = { state: "failed", detail: err.message }; log.error("Backend did not become healthy:", err.message); }
    }
}).catch(err => {
    if (isQuitting) return;
    dialog.showErrorBox("Local AI Workstation could not open", `${err.message}\nRun scripts/setup-windows.ps1 from a writable checkout under your user folder.`);
    app.quit();
});

app.on("activate", () => {
    if (isQuitting) return;
    if (mainWindow === null) createWindow();
    else mainWindow.show();
});

const shutdown = createAppShutdown({
    canShutdown: () => localFiles.canLeave(),
    app, log, stopBackend: stopPythonBackend,
    onBegin: () => { isQuitting = true; },
    dispose: [() => functionWorkflows.dispose(), () => tabCapture.dispose(), () => driveSpace.dispose(),
        () => reelsAnalyzer.dispose(), () => mediaManager.dispose(), () => browserWindows.dispose(), () => viewerBrowser.dispose(), () => meshRepair.dispose(),
        // Close the renderer before stopping the API so polling and live streams
        // cannot keep submitting requests during Uvicorn's shutdown.
        () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy(); }],
    onFailure: error => {
        isQuitting = false;
        dialog.showErrorBox("Application could not exit", error.message);
    },
});
app.on("before-quit", shutdown.beforeQuit);
app.on("window-all-closed", () => { void shutdown.request(); });

app.on('gpu-info-update', () => {
    log.info('Window graphics features:', app.getGPUFeatureStatus());
    windowRendering?.refresh();
});
app.on('child-process-gone', (_event, details) => {
    if (details.type !== 'GPU' || isQuitting) return;
    log.warn('Window graphics process stopped:', { reason: details.reason, exitCode: details.exitCode });
    windowRendering?.refresh();
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }
else { app.on("second-instance", () => { if (!isQuitting && mainWindow) { mainWindow.show(); mainWindow.focus(); } }); }
