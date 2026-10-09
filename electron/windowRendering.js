const fs = require('node:fs');
const path = require('node:path');

const MODES = ['compatible', 'hardware', 'software'];
const defaultMode = platform => platform === 'win32' ? 'compatible' : 'hardware';

// Read before app.ready: Chromium's graphics backend cannot change mid-session.
function configureRendering({ app, platform = process.platform, environment = process.env, args = process.argv, log }) {
    const file = path.join(app.getPath('userData'), 'window-rendering.json');
    let savedMode = defaultMode(platform);
    try {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (MODES.includes(value.mode) && (value.mode !== 'compatible' || platform === 'win32')) savedMode = value.mode;
    } catch (error) {
        if (error.code !== 'ENOENT') log?.warn('Rendering preference unavailable; using the platform default.');
    }
    const forcedSoftware = environment.LAW_DISABLE_GPU === '1' || args.includes('--law-software-rendering');
    const activeMode = forcedSoftware ? 'software' : savedMode;
    if (activeMode === 'software') app.disableHardwareAcceleration();
    else if (activeMode === 'compatible' && platform === 'win32') {
        // Avoid the Windows DirectComposition presentation path that can retain
        // stale text/menu pixels on some drivers. Paint page/text tiles on the
        // CPU; GPU composition, video and WebGL retain their normal availability.
        app.commandLine.appendSwitch('disable-direct-composition');
        app.commandLine.appendSwitch('disable-gpu-rasterization');
    }
    function state() { return { activeMode, savedMode, restartRequired: savedMode !== activeMode, forcedSoftware, platform }; }
    function save(mode) {
        if (!MODES.includes(mode) || (mode === 'compatible' && platform !== 'win32')) throw new Error('Choose a supported window rendering mode.');
        // Atomic replacement preserves the previous preference if writing fails.
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const temp = `${file}.${process.pid}.tmp`;
        try { fs.writeFileSync(temp, JSON.stringify({ mode }, null, 2)); fs.renameSync(temp, file); }
        finally { try { fs.unlinkSync(temp); } catch {} }
        savedMode = mode;
        return state();
    }
    return { state, save };
}

function attachWindowRendering({ window, screen, log, delay = 80, nativePulseDelay = 500 }) {
    let disposed = false, timer = null, paintTimer = null, nativePulse = null, lastDisplay = '', repaintCount = 0;
    let queuedInteractive=false,skippedMediaRepaints=0;
    const nativeMedia=new Map(),nativeListeners=new Map();
    const listeners = [];
    const live = () => !disposed && !window.isDestroyed() && !window.webContents.isDestroyed();
    const visible = () => live() && window.isVisible() && !window.isMinimized();
    let hasShown = visible();
    const childViews = () => (window.contentView?.children || []).filter(view => view.webContents && !view.webContents.isDestroyed());
    const nativeVisible = () => childViews().some(view => view.getVisible());
    const nativePlaying = () => childViews().some(view=>view.getVisible() && nativeMedia.get(view.webContents));
    function observeNativeMedia() {
        for(const view of childViews()) {
            const wc=view.webContents;
            if(nativeListeners.has(wc) || !wc.on)return;
            const removers=[];
            const watch=(name,fn)=>{wc.on(name,fn);removers.push(()=>wc.removeListener(name,fn));};
            const cleanup=()=>{for(const remove of removers)remove();nativeListeners.delete(wc);nativeMedia.delete(wc);};
            nativeListeners.set(wc,cleanup);
            watch('media-started-playing',()=>{
                nativeMedia.set(wc,true);clearTimeout(nativePulse);nativePulse=null;
            });
            const paused=()=>{nativeMedia.delete(wc);repaint();};
            watch('media-paused',paused);
            watch('did-start-navigation',(_event,_url,inPlace,mainFrame)=>{if(mainFrame && !inPlace)nativeMedia.delete(wc);});
            watch('destroyed',cleanup);
        }
    }
    function paint(passive=false) {
        if (!visible()) return;
        if(passive && nativePlaying()){skippedMediaRepaints++;return;}
        // This invalidates the real native window, including child surfaces.
        // A layout notification alone never requested this full-window repaint.
        try { window.webContents.invalidate(); repaintCount++; }
        catch (error) { log?.warn('Window repaint request failed:', error.message); }
    }
    function watchNativeViews() {
        observeNativeMedia();
        if (nativePulse !== null || !visible() || !nativeVisible() || nativePlaying()) return;
        // Native Browser/Media Manager pages have no host preload or DOM bridge.
        // Keep their changing text presented without granting either host access.
        nativePulse = setTimeout(() => {
            nativePulse = null;
            if (visible() && nativeVisible() && !nativePlaying()) { paint(true); watchNativeViews(); }
        }, nativePulseDelay);
    }
    function repaint({passive=false}={}) {
        if (!visible()) return;
        watchNativeViews();
        if(passive && nativePlaying()){skippedMediaRepaints++;return;}
        queuedInteractive ||= !passive;
        if (paintTimer !== null) return;
        paintTimer = setTimeout(() => {paintTimer=null;const passive=!queuedInteractive;queuedInteractive=false;paint(passive);}, delay);
    }
    function displayKey() {
        const display = screen.getDisplayMatching(window.getBounds());
        return `${display.id}:${display.scaleFactor}:${display.rotation}`;
    }
    function refresh() {
        timer = null;
        if (!visible()) return;
        // The renderer re-measures native Browser/Media Manager surfaces in its
        // next frame, after Chromium has applied the new size/DPI/zoom.
        window.webContents.send('app:window-layout');
        repaint();
    }
    function schedule() {
        if (!live() || timer !== null) return;
        timer = setTimeout(refresh, delay);
    }
    function visibility() {
        if (!live()) return;
        if (visible()) hasShown = true;
        // A visible window must keep swapping frames even when a native dropdown
        // or another window takes focus. The initial hidden window must paint to
        // emit ready-to-show; only later hidden/tray windows should sleep.
        window.webContents.setBackgroundThrottling(hasShown && !visible());
        for (const view of childViews()) view.webContents.setBackgroundThrottling(!visible() || !view.getVisible());
        if (visible()) schedule();
        else {
            clearTimeout(timer); timer = null;
            clearTimeout(paintTimer); paintTimer = null;
            clearTimeout(nativePulse); nativePulse = null;
        }
    }
    function moved() {
        if (!live()) return;
        const key = displayKey();
        if (key !== lastDisplay) { lastDisplay = key; schedule(); }
    }
    function metrics(_event, display) {
        if (!live()) return;
        if (display.id === screen.getDisplayMatching(window.getBounds()).id) { lastDisplay = displayKey(); schedule(); }
    }
    function listen(target, name, listener) { target.on(name, listener); listeners.push(() => target.removeListener(name, listener)); }
    for (const name of ['show', 'restore', 'focus']) listen(window, name, visibility);
    for (const name of ['hide', 'minimize']) listen(window, name, visibility);
    for (const name of ['resized', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) listen(window, name, schedule);
    listen(window, 'move', moved);
    listen(screen, 'display-metrics-changed', metrics);
    for (const name of ['display-added', 'display-removed']) listen(screen, name, schedule);
    listen(window.webContents, 'did-finish-load', visibility);
    listen(window.webContents, 'zoom-changed', schedule);
    listen(window.webContents, 'before-input-event', repaint);
    listen(window, 'unresponsive', () => log?.warn('Desktop renderer is unresponsive; preserving the window and unsaved work.'));
    listen(window, 'responsive', schedule);
    function dispose() {
        disposed = true; clearTimeout(timer); timer = null;
        clearTimeout(paintTimer); paintTimer = null;
        clearTimeout(nativePulse); nativePulse = null;
        for(const remove of nativeListeners.values())remove();nativeListeners.clear();nativeMedia.clear();
        for (const remove of listeners.splice(0)) remove();
    }
    listen(window, 'closed', dispose);
    lastDisplay = displayKey(); visibility();
    return { refresh: schedule, repaint, state: () => ({ repaintCount,skippedMediaRepaints,nativeMediaPlaying:nativePlaying() }), dispose };
}

module.exports = { MODES, defaultMode, configureRendering, attachWindowRendering };
