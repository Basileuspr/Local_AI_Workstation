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

const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");

// --- State ---
let mainWindow = null;
let tray = null;
let pythonProcess = null;
let isQuitting = false;

// --- Configuration ---
const isDev = !app.isPackaged;

const CONFIG = {
    backendPort: 8000,
    backendHost: "localhost",
    pythonPath: path.join(__dirname, "..", "venv", "Scripts", "python.exe"),
    backendScript: path.join(__dirname, "..", "backend", "main.py"),
    viteDevUrl: "http://localhost:5173",
    frontendDistPath: path.join(__dirname, "..", "dist", "index.html"),
    fallbackPath: path.join(__dirname, "..", "frontend", "index.html"),
    backendTimeout: 30000,
    healthCheckInterval: 500,
};

// --- Python Backend Management ---

function startPythonBackend() {
    console.log("[Electron] Starting Python backend...");
    pythonProcess = spawn(CONFIG.pythonPath, [CONFIG.backendScript], {
        cwd: path.join(__dirname, ".."),
        env: { ...process.env },
        windowsHide: true,
    });
    pythonProcess.stdout.on("data", (data) => {
        console.log(`[Backend] ${data.toString().trim()}`);
    });
    pythonProcess.stderr.on("data", (data) => {
        console.log(`[Backend Error] ${data.toString().trim()}`);
    });
    pythonProcess.on("close", (code) => {
        console.log(`[Electron] Python backend exited with code ${code}`);
        pythonProcess = null;
        if (!isQuitting && mainWindow) {
            mainWindow.webContents.executeJavaScript(
                `document.getElementById("status-dot")?.classList.add("error");`
            ).catch(() => {});
        }
    });
    pythonProcess.on("error", (err) => {
        console.error(`[Electron] Failed to start Python backend:`, err);
    });
}

function stopPythonBackend() {
    if (pythonProcess) {
        console.log("[Electron] Stopping Python backend...");
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
        const check = () => {
            const req = http.get(
                `http://${CONFIG.backendHost}:${CONFIG.backendPort}/health`,
                (res) => {
                    if (res.statusCode === 200) {
                        console.log("[Electron] Backend is ready!");
                        resolve();
                    } else { retry(); }
                }
            );
            req.on("error", () => retry());
            req.setTimeout(1000, () => { req.destroy(); retry(); });
        };
        const retry = () => {
            if (Date.now() - startTime > CONFIG.backendTimeout) {
                reject(new Error("Backend failed to start within timeout"));
            } else {
                setTimeout(check, CONFIG.healthCheckInterval);
            }
        };
        check();
    });
}

// --- Window Management ---

async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200, height: 800, minWidth: 800, minHeight: 600,
        title: "Local AI Workstation",
        backgroundColor: "#080c14",
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    if (isDev) {
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
            console.log("[Electron] Loading from Vite dev server...");
            mainWindow.loadURL(CONFIG.viteDevUrl);
        } else {
            console.log("[Electron] Vite not running, loading fallback...");
            mainWindow.loadFile(CONFIG.fallbackPath);
        }
    } else {
        const fs = require("fs");
        if (fs.existsSync(CONFIG.frontendDistPath)) {
            mainWindow.loadFile(CONFIG.frontendDistPath);
        } else {
            mainWindow.loadFile(CONFIG.fallbackPath);
        }
    }

    mainWindow.webContents.on("context-menu", (event, params) => {
        Menu.buildFromTemplate([
            { label: "Cut", role: "cut", enabled: params.editFlags.canCut },
            { label: "Copy", role: "copy", enabled: params.editFlags.canCopy },
            { label: "Paste", role: "paste", enabled: params.editFlags.canPaste },
            { label: "Select All", role: "selectAll" },
            { type: "separator" },
            { label: "Inspect Element", click: () => mainWindow.webContents.inspectElement(params.x, params.y) },
        ]).popup();
    });

    mainWindow.once("ready-to-show", () => mainWindow.show());
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
    console.log(`[Electron] App starting... Mode: ${isDev ? "DEV" : "PROD"}`);
    startPythonBackend();
    try { await waitForBackend(); } catch (err) { console.error("[Electron]", err.message); }
    await createWindow();
    createTray();
});

app.on("activate", () => {
    if (mainWindow === null) createWindow();
    else mainWindow.show();
});

app.on("before-quit", () => { isQuitting = true; stopPythonBackend(); });
app.on("will-quit", () => { stopPythonBackend(); });

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }
else { app.on("second-instance", () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } }); }