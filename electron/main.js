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
const CONFIG = {
    backendPort: 8000,
    backendHost: "localhost",
    // Path to your Python executable inside the venv
    pythonPath: path.join(__dirname, "..", "venv", "Scripts", "python.exe"),
    // Path to the FastAPI entry point
    backendScript: path.join(__dirname, "..", "backend", "main.py"),
    // Path to the frontend HTML
    frontendPath: path.join(__dirname, "..", "frontend", "index.html"),
    // How long to wait for backend to start (ms)
    backendTimeout: 30000,
    // How often to check if backend is ready (ms)
    healthCheckInterval: 500,
};


// --- Python Backend Management ---

function startPythonBackend() {
    console.log("[Electron] Starting Python backend...");
    console.log(`[Electron] Python: ${CONFIG.pythonPath}`);
    console.log(`[Electron] Script: ${CONFIG.backendScript}`);

    pythonProcess = spawn(CONFIG.pythonPath, [CONFIG.backendScript], {
        // Run from the project root so relative paths work
        cwd: path.join(__dirname, ".."),
        // Pass environment variables through
        env: { ...process.env },
        // Don't open a separate console window on Windows
        windowsHide: true,
    });

    // Log backend output to Electron's console (helpful for debugging)
    pythonProcess.stdout.on("data", (data) => {
        console.log(`[Backend] ${data.toString().trim()}`);
    });

    pythonProcess.stderr.on("data", (data) => {
        console.log(`[Backend Error] ${data.toString().trim()}`);
    });

    pythonProcess.on("close", (code) => {
        console.log(`[Electron] Python backend exited with code ${code}`);
        pythonProcess = null;
        // If we didn't intentionally quit, the backend crashed
        if (!isQuitting && mainWindow) {
            mainWindow.webContents.executeJavaScript(
                `document.getElementById("status-dot").className = "status-dot error";
                 document.getElementById("status-text").textContent = "backend crashed";`
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
        // On Windows, we need to kill the process tree
        if (process.platform === "win32") {
            spawn("taskkill", ["/pid", pythonProcess.pid, "/f", "/t"], {
                windowsHide: true,
            });
        } else {
            pythonProcess.kill("SIGTERM");
        }
        pythonProcess = null;
    }
}

function waitForBackend() {
    /**
     * Polls the health endpoint until the backend is ready.
     * Returns a promise that resolves when connected or rejects on timeout.
     */
    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        const check = () => {
            const req = http.get(
                `http://${CONFIG.backendHost}:${CONFIG.backendPort}/health`,
                (res) => {
                    if (res.statusCode === 200) {
                        console.log("[Electron] Backend is ready!");
                        resolve();
                    } else {
                        retry();
                    }
                }
            );

            req.on("error", () => retry());
            req.setTimeout(1000, () => {
                req.destroy();
                retry();
            });
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

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: "Local AI Workstation",
        backgroundColor: "#080c14", // Matches your UI background
        show: false, // Don't show until ready
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    // Load the frontend
    mainWindow.loadFile(CONFIG.frontendPath);

    // Enable right-click context menu
    mainWindow.webContents.on("context-menu", (event, params) => {
        const contextMenu = Menu.buildFromTemplate([
            { label: "Cut", role: "cut", enabled: params.editFlags.canCut },
            { label: "Copy", role: "copy", enabled: params.editFlags.canCopy },
            { label: "Paste", role: "paste", enabled: params.editFlags.canPaste },
            { label: "Select All", role: "selectAll" },
            { type: "separator" },
            {
                label: "Inspect Element",
                click: () => {
                    mainWindow.webContents.inspectElement(params.x, params.y);
                },
            },
        ]);
        contextMenu.popup();
    });

    // Show window when content is ready (prevents white flash)
    mainWindow.once("ready-to-show", () => {
        mainWindow.show();
    });

    // Minimize to tray instead of closing (optional — remove if you prefer normal close)
    mainWindow.on("close", (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

function createTray() {
    // Create a simple tray icon (1x1 pixel — we'll improve this later)
    const icon = nativeImage.createEmpty();
    tray = new Tray(icon);
    tray.setToolTip("Local AI Workstation");

    const contextMenu = Menu.buildFromTemplate([
        {
            label: "Open",
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            },
        },
        { type: "separator" },
        {
            label: "Quit",
            click: () => {
                isQuitting = true;
                app.quit();
            },
        },
    ]);

    tray.setContextMenu(contextMenu);

    tray.on("click", () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}


// --- App Lifecycle ---

app.whenReady().then(async () => {
    console.log("[Electron] App starting...");

    // 1. Start the Python backend
    startPythonBackend();

    // 2. Wait for it to be ready
    try {
        await waitForBackend();
    } catch (err) {
        console.error("[Electron]", err.message);
        // Still create the window — the UI will show "backend offline"
    }

    // 3. Create the window and tray
    createWindow();
    createTray();
});

// macOS: re-create window when dock icon is clicked
app.on("activate", () => {
    if (mainWindow === null) {
        createWindow();
    } else {
        mainWindow.show();
    }
});

// Clean shutdown
app.on("before-quit", () => {
    isQuitting = true;
    stopPythonBackend();
});

app.on("will-quit", () => {
    stopPythonBackend();
});

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}
