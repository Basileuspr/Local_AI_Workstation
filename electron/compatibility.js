const fs = require("node:fs");
const path = require("node:path");

function backendFailure({ code, error = "", stderr = "" } = {}) {
    const evidence = `${error}\n${stderr}`;
    if (/backup import|reset was interrupted|reset-in-progress/i.test(evidence))
        return "An interrupted backup import or reset needs recovery. Open Dashboard and use its recovery controls. Existing data has been preserved.";
    if (/already.*(running|using)|another.*(process|backend)|locked by/i.test(evidence))
        return "Another app process may be using this data folder. Quit the previous instance from its system tray, then reopen this app.";
    if (/ENOENT|No Python at|did not find executable|Unable to create process/i.test(evidence))
        return "The app's Python environment is missing or was copied from another PC. Run scripts/setup-windows.ps1 in this checkout to create a local venv.";
    if (/No module named|ModuleNotFoundError/i.test(evidence))
        return "A required Python package is missing. Run scripts/setup-windows.ps1 to install the laptop baseline, then reopen the app.";
    if (/DLL load|WinError 126|WinError 127|WinError 193|0xc0000135|0xc000007b/i.test(evidence))
        return "A native Windows dependency could not load. Use 64-bit Python 3.13 and the Windows setup script. If it persists, repair the Microsoft Visual C++ x64 runtime and inspect the backend log.";
    if (/PermissionError|Access is denied|EACCES|EPERM|read.only/i.test(evidence))
        return "Windows denied access to an app file or data folder. Use a writable checkout under your user folder and check security software permissions. Do not delete the existing data folder.";
    if (/No space left|disk.*full|WinError 112/i.test(evidence))
        return "The drive is full. Free space on the app/data drive, then reopen the app. Existing data has not been reset.";
    return `The backend stopped${code == null ? "" : ` (exit ${code})`}. Open the backend log for details, correct the setup problem, then reopen the app. Local desktop tools may still work.`;
}

function pythonPreflight(python, exists = fs.existsSync) {
    // Explicit command names in LAW_PYTHON are resolved by spawn/PATH.
    if (/[\\/]/.test(python) && !exists(python))
        throw new Error(backendFailure({ error: "ENOENT" }));
}

function desktopCapabilities({ mediaDirectory, python, platform = process.platform, environment = process.env, exists = fs.existsSync }) {
    const found = target => { try { return exists(target); } catch { return false; } };
    const onPath = name => (environment.Path || environment.PATH || "").split(path.delimiter)
        .filter(Boolean).some(folder => found(path.join(folder.replace(/^"|"$/g, ""), name)));
    const windows = platform === "win32";
    const powershell = windows && found(path.win32.join(environment.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"));
    const pythonAvailable = /[\\/]/.test(python) ? found(python) : onPath(python);
    const mediaAvailable = pythonAvailable && found(path.join(mediaDirectory, "media_organizer", "ui_server.py"));
    const winget = windows && onPath("winget.exe");
    const state = (available, detail) => ({ available, detail });
    return { features: {
        media_manager: state(mediaAvailable, mediaAvailable ? "Separate Media Organizer application detected." : "Install Media Organizer and its Python runtime, or set LAW_MEDIA_MANAGER_DIR to the existing application folder."),
        program_updates: state(Boolean(powershell && winget), !powershell ? "Windows PowerShell is unavailable." : winget ? "WinGet detected." : "WinGet was not found. Install App Installer to enable program updates."),
        graphics_reset: state(Boolean(powershell), powershell ? "Windows graphics reset is available." : "This action requires Windows PowerShell."),
        tab_capture: state(true, "Desktop tab capture is available."),
    } };
}

module.exports = { backendFailure, pythonPreflight, desktopCapabilities };
