"use strict";

function embedUrl(service, value) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
        if (service === 'spotify' && url.hostname === 'open.spotify.com' &&
            /^\/embed\/(track|album|artist|playlist|episode|show)\/[A-Za-z0-9]{22}$/.test(url.pathname) && !url.search) return url.href;
        if (service === 'discord' && url.hostname === 'discord.com' && url.pathname === '/widget' &&
            /^\d{17,20}$/.test(url.searchParams.get('id') || '') && url.searchParams.get('theme') === 'dark' &&
            [...url.searchParams.keys()].length === 2) return url.href;
    } catch {}
    return null;
}

function createLinkedContent({WebContentsView, session, getWindow}) {
    let view = null, current = '', service = '';
    function hide() { if (view && !view.webContents.isDestroyed()) view.setVisible(false); }
    function close() {
        if (!view) return;
        const win = getWindow();
        if (win && !win.isDestroyed()) win.contentView.removeChildView(view);
        if (!view.webContents.isDestroyed()) view.webContents.close({waitForBeforeUnload: false});
        view = null; current = ''; service = '';
    }
    async function open(value) {
        const url = embedUrl(value?.service, value?.url);
        if (!url) throw Error('Choose an official Spotify embed or Discord server widget.');
        if (service !== value.service) close();
        if (!view) {
            service = value.service;
            // No host preload, local session cookies, IPC, microphone, camera or downloads.
            const isolated = session.fromPartition(`linked-content-${service}`);
            isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
            isolated.setPermissionCheckHandler(() => false);
            isolated.on('will-download', event => event.preventDefault());
            view = new WebContentsView({webPreferences: {session: isolated, sandbox: true, contextIsolation: true,
                nodeIntegration: false, webSecurity: true, preload: undefined}});
            view.setVisible(false); getWindow().contentView.addChildView(view);
            const wc = view.webContents;
            wc.setWindowOpenHandler(() => ({action: 'deny'}));
            wc.on('will-attach-webview', event => event.preventDefault());
            wc.on('will-navigate', (event, next) => { if (!embedUrl(service, next)) event.preventDefault(); });
            wc.on('will-redirect', (event, next) => { if (!embedUrl(service, next)) event.preventDefault(); });
        }
        if (current !== url) {
            current = url;
            try { await view.webContents.loadURL(url); }
            catch { close(); throw Error('The embedded service could not load. Check its link and connection.'); }
        }
        return {ready: true, service};
    }
    function place(value) {
        if (!view || view.webContents.isDestroyed()) return;
        const win = getWindow(), b = value?.bounds;
        if (!win || !value?.visible || !b || ![b.x,b.y,b.width,b.height].every(Number.isFinite)) return hide();
        const [w,h] = win.getContentSize(), scale = win.webContents.getZoomFactor();
        const x = Math.max(0, Math.round(b.x * scale)), y = Math.max(0, Math.round(b.y * scale));
        const width = Math.min(w, Math.round((b.x+b.width) * scale)) - x;
        const height = Math.min(h, Math.round((b.y+b.height) * scale)) - y;
        if (width < 1 || height < 1) return hide();
        view.setBounds({x,y,width,height}); view.setVisible(true);
    }
    function spotifyAudioFrame() {
        if (service !== 'spotify' || !view || view.webContents.isDestroyed() || !embedUrl('spotify', view.webContents.getURL())) return null;
        return view.webContents.mainFrame;
    }
    return {open, place, hide, close, spotifyAudioFrame};
}
module.exports = {embedUrl, createLinkedContent};
