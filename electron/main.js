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
const { mediaManagerPaths } = require("./mediaManagerPaths");
const { createTabCapture } = require("./tabCapture");
const { runDesktopAction, writeClipboardImage } = require("./desktopFunctions");
const { backendFailure, pythonPreflight, desktopCapabilities } = require("./compatibility");
if (process.env.LAW_DISABLE_GPU === "1" || process.argv.includes("--law-software-rendering")) app.disableHardwareAcceleration();
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
const mediaManager = createMediaManager({
    WebContentsView, session, getWindow: () => mainWindow,
    python: mediaPython,
    directory: mediaDirectory,
    reports: mediaReports,
});

function trustedDesktop(event) {
    const contents = mainWindow?.webContents;
    if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame) {
        return false;
    }
    return trustedUrl(event.senderFrame.url, useViteDev ? CONFIG.viteDevUrl : null);
}

const tabCapture = createTabCapture({ BrowserWindow, screen, clipboard, ClipboardItem, getWindow: () => mainWindow, mediaManager });
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
    if (desktopActionBusy) return { error: "Another desktop action is starting." };
    desktopActionBusy = true;
    try { return await runDesktopAction(action); }
    catch (error) { return { error: error.message }; }
    finally { desktopActionBusy = false; }
});
app.on("before-quit", () => tabCapture.dispose());

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
            LAW_LAUNCH_ID: launchId,
            LAW_DESKTOP_MAINTENANCE_TOKEN: maintenanceToken,
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
    if (pythonProcess) {
        log.info("Stopping Python backend");
        if (process.platform === "win32") {
            if (pythonProcess.pid) {
                const killer = spawn("taskkill", ["/pid", String(pythonProcess.pid), "/f", "/t"], { windowsHide: true });
                killer.on("error", err => log.warn("Could not stop backend:", err.message));
            }
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

    guardNavigation(mainWindow.webContents);
    mainWindow.webContents.on("did-start-navigation", (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) mediaManager.hide(); });
    mainWindow.webContents.on("render-process-gone", async (_event, details) => {
        mediaManager.hide();
        if (isQuitting || details.reason === "clean-exit") return;
        const result = await dialog.showMessageBox({ type: "error", title: "Desktop view stopped",
            message: "The desktop renderer stopped. Saved data is still on disk; unsaved edits may be lost.",
            detail: "Software rendering can help with incompatible Windows graphics drivers. A restart stops active backend work.",
            buttons: ["Restart with software rendering", "Quit"], defaultId: 1, cancelId: 1 });
        if (result.response === 0) app.relaunch({ args: [...process.argv.slice(1).filter(arg => arg !== "--law-software-rendering"), "--law-software-rendering"] });
        app.quit();
    });
    mainWindow.webContents.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
        if (isMainFrame && code !== -3 && !url.includes("/recovery.html")) {
            void mainWindow.loadURL(`${APP_ORIGIN}/recovery.html`).catch(err => log.error("Recovery view failed:", err.message));
        }
    });
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

    mainWindow.webContents.on("context-menu", (event, params) => {
        Menu.buildFromTemplate(buildContextMenu(params, mainWindow.webContents)).popup({ window: mainWindow });
    });

    mainWindow.on("close", (event) => {
        if (!isQuitting && tray) { event.preventDefault(); mainWindow.hide(); }
        else if (!isQuitting) app.quit();
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
    if (!gotLock || isQuitting) return;
    log.info(`App starting in ${isDev ? "DEV" : "PROD"} mode`);
    log.info("Logging to", logFilePath() || "(console only)");
    registerAppProtocol();
    try { await selectBackendPort(); }
    catch (err) { backendState = { state: "failed", detail: err.message }; }
    await createWindow();
    try { createTray(); }
    catch (err) { log.warn("System tray unavailable:", err.message); tray = null; }
    if (!isQuitting && backendState.state !== "failed") {
        try { startPythonBackend(); await waitForBackend(); await resetThinkingTrace(); }
        catch (err) { backendState = { state: "failed", detail: err.message }; log.error("Backend did not become healthy:", err.message); }
    }
}).catch(err => { dialog.showErrorBox("Local AI Workstation could not open", `${err.message}\nRun scripts/setup-windows.ps1 from a writable checkout under your user folder.`); app.quit(); });

app.on("activate", () => {
    if (mainWindow === null) createWindow();
    else mainWindow.show();
});

app.on("before-quit", () => { isQuitting = true; driveSpace.dispose(); mediaManager.dispose(); stopPythonBackend(); });
app.on("will-quit", () => { stopPythonBackend(); });

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }
else { app.on("second-instance", () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } }); }
