// Access-only integration. No Workstation API, credentials, files or media store.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");

function childEnvironment(environment) {
    const allowed = /^(path|pathext|systemroot|windir|comspec|temp|tmp|userprofile|appdata|localappdata|programfiles|programfiles\(x86\)|programdata|homedrive|homepath|home|lang)$/i;
    return { ...Object.fromEntries(Object.entries(environment).filter(([key]) => allowed.test(key))), PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" };
}

function mediaOrigin(value) {
    try {
        const url = new URL(value);
        return url.protocol === "http:" && url.hostname === "127.0.0.1" && Number(url.port) > 0
            && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash ? url.origin : null;
    } catch { return null; }
}

function createMediaManager({ WebContentsView, session, getWindow, python, directory, reports, spawnProcess = spawn }) {
    let child = null, view = null, pending = null, origin = null, disposed = false, failure = null;
    let placement = { visible: false };

    function hide() {
        view?.setVisible(false);
    }
    function place(value) {
        placement = value || { visible: false };
        if (!view || view.webContents.isDestroyed()) return;
        const window = getWindow();
        const bounds = placement.bounds;
        if (!window || !placement.visible || !bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) { hide(); return; }
        const [width, height] = window.getContentSize();
        const scale = window.webContents.getZoomFactor();
        const x = Math.max(0, Math.round(bounds.x * scale)), y = Math.max(0, Math.round(bounds.y * scale));
        const w = Math.min(width - x, Math.round(bounds.width * scale)), h = Math.min(height - y, Math.round(bounds.height * scale));
        if (w <= 0 || h <= 0) { hide(); return; }
        view.setBounds({ x, y, width: w, height: h });
        view.setVisible(true);
    }
    function closeView() {
        if (!view) return;
        getWindow()?.contentView.removeChildView(view);
        if (!view.webContents.isDestroyed()) view.webContents.close();
        view = null;
    }
    async function start() {
        if (disposed) return { error: "Media Manager is closing." };
        if (view && !failure) return { ready: true };
        if (pending) return pending;
        if (child && failure) return { error: "The previous Media Manager process is finishing its work. Try again once it exits." };
        pending = (async () => {
            failure = null;
            if (!fs.existsSync(path.join(directory, "media_organizer", "ui_server.py"))) {
                throw new Error(`Media Manager was not found at ${directory}. Restore that folder or set LAW_MEDIA_MANAGER_DIR and restart the app.`);
            }
            origin = await new Promise((resolve, reject) => {
                const args = ["-m", "media_organizer.ui_server", "--desktop-bridge"];
                if (reports) args.push("--reports", reports);
                const process = spawnProcess(python, args, { cwd: directory, env: childEnvironment(global.process.env), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
                child = process;
                let buffer = "", settled = false;
                const timeout = setTimeout(() => finish(new Error("Media Manager did not start within 20 seconds.")), 20000);
                function finish(error, result) {
                    if (settled) return;
                    settled = true; clearTimeout(timeout);
                    if (error) { process.stdin.end(); reject(error); } else resolve(result);
                }
                process.stdin.on("error", () => {});
                process.stderr.resume(); // Never put private media paths into host logs.
                process.stdout.on("data", data => {
                    if (settled) return;
                    buffer += data.toString();
                    if (buffer.length > 8192) return finish(new Error("Invalid Media Manager startup response."));
                    if (!buffer.includes("\n")) return;
                    try {
                        const ready = JSON.parse(buffer.split("\n")[0]);
                        const url = mediaOrigin(ready.url);
                        if (ready.mediaManagerReady !== 1 || !url) throw new Error();
                        finish(null, url);
                    } catch { finish(new Error("Invalid Media Manager startup response.")); }
                });
                process.once("error", () => finish(new Error("Could not start Media Manager. Check the configured Python installation.")));
                process.once("close", () => {
                    if (child === process) { child = null; failure = "Media Manager stopped. Reopen it to continue."; closeView(); }
                    finish(new Error("Media Manager stopped during startup."));
                });
            });
            if (disposed || !child) throw new Error("Media Manager is closing.");
            // Ephemeral separate session: no host cookies, storage, preload or IPC.
            const isolatedSession = session.fromPartition(`media-manager-${randomUUID()}`);
            isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
            isolatedSession.setPermissionCheckHandler(() => false);
            isolatedSession.on("will-download", event => event.preventDefault());
            isolatedSession.webRequest.onBeforeRequest((details, callback) => {
                let allowed = false;
                try { allowed = new URL(details.url).origin === origin; } catch {}
                callback({ cancel: !allowed });
            });
            view = new WebContentsView({ webPreferences: { session: isolatedSession, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
            view.setVisible(false);
            getWindow().contentView.addChildView(view);
            const contents = view.webContents;
            contents.setWindowOpenHandler(() => ({ action: "deny" }));
            const guard = (event, url) => {
                try { if (new URL(url).origin === origin) return; } catch {}
                event.preventDefault();
            };
            contents.on("will-navigate", guard);
            contents.on("will-redirect", guard);
            contents.on("will-frame-navigate", event => guard(event, event.url));
            contents.on("will-attach-webview", event => event.preventDefault());
            contents.on("render-process-gone", () => {
                failure = "Media Manager's view stopped. Reopen it to continue.";
                closeView(); child?.stdin.end();
            });
            // F6 provides a keyboard route back to the host navigation.
            contents.on("before-input-event", (event, input) => {
                if (input.type === "keyDown" && input.key === "F6") {
                    event.preventDefault();
                    const host = getWindow()?.webContents;
                    host?.focus(); host?.send("media-manager:navigation");
                }
            });
            await contents.loadURL(origin);
            place(placement);
            return { ready: true };
        })().catch(error => {
            failure = error.message; closeView(); child?.stdin.end();
            return { error: failure };
        }).finally(() => { pending = null; });
        return pending;
    }
    return {
        start, place,
        refresh: async () => {
            if (!view || failure || view.webContents.isDestroyed()) return start();
            try {
                await view.webContents.executeJavaScript("(async () => { const ui = document.querySelector('media-organizer'); if (!ui) throw new Error('Media Manager is still loading.'); await ui.refresh(); if (ui.data) await ui.load(ui.data.uiRunId, { preserveFilters: true }); })()");
                return { ready: true };
            } catch { return { error: "Could not refresh Media Manager. Try again." }; }
        },
        status: () => ({ ready: Boolean(view && !failure), error: failure }),
        focus: async () => {
            if (!placement.visible || !view?.getVisible() || view.webContents.isDestroyed()) return { error: "Media Manager is not visible. Reopen its tab." };
            view.webContents.focus();
            const focused = await view.webContents.executeJavaScript("(() => { const ui = document.querySelector('media-organizer'); return Boolean(ui?.enterWorkspace()); })()", true);
            return focused ? { focused: true } : { error: "Media Manager is still loading. Try again." };
        },
        hide: () => place({ visible: false }),
        dispose: () => { disposed = true; closeView(); child?.stdin.end(); },
    };
}

module.exports = { createMediaManager, childEnvironment, mediaOrigin };
