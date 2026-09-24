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

const { app, BrowserWindow, WebContentsView, session, Tray, Menu, nativeImage, shell, ipcMain, dialog, protocol, net } = require("electron");
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
if (process.env.LAW_USER_DATA_DIR) app.setPath("userData", path.resolve(process.env.LAW_USER_DATA_DIR));
const maintenanceToken = randomUUID();
const launchId = randomUUID();
// Proves a request came from this launch of this app. Generated per run, shared
// with the backend over its environment and with the renderer over guarded IPC, and
// gone when the process exits. Never written to disk.
const sessionToken = require("crypto").randomBytes(32).toString("hex");

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
let tray = null;
let pythonProcess = null;
let isQuitting = false;

// --- Configuration ---
const isDev = !app.isPackaged;
// The Vite dev server is used, and trusted with the session token, only when
// explicitly requested; otherwise any process answering on its port would be.
const useViteDev = isDev && process.env.LAW_VITE_DEV === "1";

// Environment overrides use the same LAW_ prefix as the Python side, so one
// variable configures both halves of the app.
const envInt = (name, fallback) => {
    const parsed = Number.parseInt(process.env[name] || "", 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const CONFIG = {
    // The port the backend is *asked* to use. If it is busy we pick another and
    // update this, so it always reflects where the backend actually is.
    backendPort: envInt("LAW_PORT", 8000),
    backendHost: process.env.LAW_HOST || "127.0.0.1",
    vitePort: envInt("LAW_VITE_PORT", 5173),
    pythonPath: process.env.LAW_PYTHON || path.join(__dirname, "..", "venv", "Scripts", "python.exe"),
    backendScript: path.join(__dirname, "..", "backend", "main.py"),
    frontendDistPath: path.join(__dirname, "..", "dist", "index.html"),
    fallbackPath: path.join(__dirname, "..", "frontend", "index.html"),
    backendTimeout: 30000,
    healthCheckInterval: 500,
};

CONFIG.viteDevUrl = `http://localhost:${CONFIG.vitePort}`;
const driveSpace = createDriveSpace({
    startWorker: root => spawn(CONFIG.pythonPath, [path.join(__dirname, "..", "backend", "drive_space.py"), root], {
        cwd: path.join(__dirname, ".."), windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    }),
});

const mediaManager = createMediaManager({
    WebContentsView, session, getWindow: () => mainWindow,
    python: process.env.LAW_MEDIA_MANAGER_PYTHON || CONFIG.pythonPath,
    directory: process.env.LAW_MEDIA_MANAGER_DIR || path.join(app.getPath("desktop"), "Media Organizer"),
    reports: process.env.LAW_MEDIA_MANAGER_REPORTS,
});

function trustedDesktop(event) {
    const contents = mainWindow?.webContents;
    if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame) {
        return false;
    }
    return trustedUrl(event.senderFrame.url, useViteDev ? CONFIG.viteDevUrl : null);
}

ipcMain.on("app:connection", event => {
    event.returnValue = trustedDesktop(event) ? { base: `http://127.0.0.1:${CONFIG.backendPort}`, token: sessionToken } : null;
});

ipcMain.handle("media-manager:start", event => trustedDesktop(event) ? mediaManager.start() : { error: "Desktop access required." });
ipcMain.handle("media-manager:status", event => trustedDesktop(event) ? mediaManager.status() : { error: "Desktop access required." });
ipcMain.handle("media-manager:place", (event, value) => { if (trustedDesktop(event)) mediaManager.place(value); });
ipcMain.handle("media-manager:focus", event => { if (trustedDesktop(event)) return mediaManager.focus(); });
ipcMain.handle("media-manager:refresh", event => trustedDesktop(event) ? mediaManager.refresh() : { error: "Desktop access required." });

ipcMain.handle("dashboard:open-drive-root", async (event, root) => {
    if (!trustedDesktop(event)) return { error: "Open drive is only available in the desktop app." };
    return openDriveRoot(root, (target) => shell.openPath(target));
});
ipcMain.handle("dashboard:scan-drive", (event, root) => trustedDesktop(event) ? driveSpace.start(root) : { error: "Desktop access required." });
ipcMain.handle("dashboard:drive-scan-status", (event, id) => trustedDesktop(event) ? driveSpace.status(id) : { error: "Desktop access required." });
ipcMain.handle("dashboard:cancel-drive-scan", (event, id) => trustedDesktop(event) ? driveSpace.cancel(id) : { error: "Desktop access required." });

ipcMain.handle("dashboard:software-runtime", event => trustedDesktop(event) ? {
    app: app.getVersion(), electron: process.versions.electron, chromium: process.versions.chrome,
    node: process.versions.node, v8: process.versions.v8, architecture: process.arch,
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

let pickerOpen = false;
ipcMain.handle("uploads:choose", async (event, options) => {
    if (!trustedDesktop(event)) return { error: "Uploads are only available in the desktop app." };
    if (pickerOpen) return { canceled: true };
    pickerOpen = true;
    try {
        return await pickFiles(options || {}, { home: app.getPath("home"), showDialog: options => dialog.showOpenDialog(mainWindow, options) });
    } catch (error) { return { error: error.message }; }
    finally { pickerOpen = false; }
});

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
    clearRenderer: () => clearDesktopStorage(mainWindow.webContents),
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
    log.info("Starting Python backend:", CONFIG.pythonPath);
    log.info(`Backend will listen on ${CONFIG.backendHost}:${CONFIG.backendPort}`);
    pythonProcess = spawn(CONFIG.pythonPath, [CONFIG.backendScript], {
        cwd: path.join(__dirname, ".."),
        // The chosen port wins over any inherited value, so the backend and the
        // renderer cannot disagree about where the API lives.
        env: {
            ...process.env,
            LAW_HOST: CONFIG.backendHost,
            LAW_PORT: String(CONFIG.backendPort),
            LAW_SESSION_TOKEN: sessionToken,
            LAW_LAUNCH_ID: launchId,
            LAW_DESKTOP_MAINTENANCE_TOKEN: maintenanceToken,
        },
        windowsHide: true,
    });
    pythonProcess.stdout.on("data", (data) => {
        backendLog.info(data.toString().trim());
    });
    pythonProcess.stderr.on("data", (data) => {
        backendLog.warn(data.toString().trim());
    });
    pythonProcess.on("close", (code) => {
        log.warn(`Python backend exited with code ${code}`);
        pythonProcess = null;
        if (!isQuitting && mainWindow) {
            mainWindow.webContents.executeJavaScript(
                `document.getElementById("status-dot")?.classList.add("error");`
            ).catch(() => {});
        }
    });
    pythonProcess.on("error", (err) => {
        log.error("Failed to start Python backend:", err);
    });
}

function stopPythonBackend() {
    if (pythonProcess) {
        log.info("Stopping Python backend");
        if (process.platform === "win32") {
            spawn("taskkill", ["/pid", pythonProcess.pid, "/f", "/t"], { windowsHide: true });
        } else {
            pythonProcess.kill("SIGTERM");
        }
        pythonProcess = null;
    }
}

function waitForBackend() {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        let settled = false;
        const check = () => {
            if (settled) return;
            if (!pythonProcess) { settled = true; reject(new Error("The backend exited during startup. Check data/logs/backend.log; another backend may still own this data folder.")); return; }
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
                reject(new Error("Backend failed to start within timeout"));
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

async function ensurePythonBackend() {
    // An unrelated service (or an old launch with a different secret) must
    // never receive this launch's credentials or be mistaken for our backend.
    const chosen = await findAvailablePort(CONFIG.backendHost, CONFIG.backendPort);
    if (chosen !== CONFIG.backendPort) {
        log.warn(`Port ${CONFIG.backendPort} is in use; falling back to ${chosen}`);
        CONFIG.backendPort = chosen;
    }

    startPythonBackend();
    await waitForBackend();
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
            const target = appAsset(root, request.url);
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

    guardNavigation(mainWindow.webContents);
    mainWindow.webContents.on("did-start-navigation", (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) mediaManager.hide(); });
    mainWindow.webContents.on("render-process-gone", () => mediaManager.hide());
    mainWindow.once("ready-to-show", () => mainWindow.show());
    if (fs.existsSync(CONFIG.frontendDistPath)) {
        try { await migratePreferences({ BrowserWindow, oldPath: CONFIG.frontendDistPath, appUrl: `${APP_ORIGIN}/index.html` }); }
        catch { log.warn("Preference migration was not completed; original preferences were preserved and migration will retry next launch."); }
    }

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
            mainWindow.loadURL(`${CONFIG.viteDevUrl}/?${rendererQuery()}`);
        } else if (fs.existsSync(CONFIG.frontendDistPath)) {
            log.info("Vite not running; loading the built frontend over app://");
            mainWindow.loadURL(`${APP_ORIGIN}/index.html?${rendererQuery()}`);
        } else {
            log.warn("Neither Vite nor dist/ available; loading the legacy fallback");
            mainWindow.loadFile(CONFIG.fallbackPath, { search: rendererQuery() });
        }
    } else {
        if (fs.existsSync(CONFIG.frontendDistPath)) {
            mainWindow.loadURL(`${APP_ORIGIN}/index.html?${rendererQuery()}`);
        } else {
            // Last-resort legacy page. It still loads from file://, whose origin
            // the backend no longer trusts, so it can reach only /health.
            log.warn("dist/ is missing; the legacy fallback cannot reach the API");
            mainWindow.loadFile(CONFIG.fallbackPath, { search: rendererQuery() });
        }
    }

    mainWindow.webContents.on("context-menu", (event, params) => {
        Menu.buildFromTemplate(buildContextMenu(params, mainWindow.webContents)).popup({ window: mainWindow });
    });

    mainWindow.on("close", (event) => {
        if (!isQuitting) { event.preventDefault(); mainWindow.hide(); }
    });
    mainWindow.on("closed", () => { mainWindow = null; });
}

function createTray() {
    const icon = nativeImage.createEmpty();
    tray = new Tray(icon);
    tray.setToolTip("Local AI Workstation");
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: "Open", click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
        { type: "separator" },
        { label: "Quit", click: () => { isQuitting = true; app.quit(); } },
    ]));
    tray.on("click", () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
}

// --- App Lifecycle ---

app.whenReady().then(async () => {
    log.info(`App starting in ${isDev ? "DEV" : "PROD"} mode`);
    log.info("Logging to", logFilePath() || "(console only)");
    registerAppProtocol();
    try { await ensurePythonBackend(); await resetThinkingTrace(); }
    catch (err) { log.error("Backend did not become healthy:", err.message); dialog.showErrorBox("Local backend could not start", err.message); }
    await createWindow();
    createTray();
});

app.on("activate", () => {
    if (mainWindow === null) createWindow();
    else mainWindow.show();
});

app.on("before-quit", () => { isQuitting = true; driveSpace.dispose(); mediaManager.dispose(); stopPythonBackend(); });
app.on("will-quit", () => { stopPythonBackend(); });

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }
else { app.on("second-instance", () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } }); }
