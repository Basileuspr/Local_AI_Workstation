const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { captureDesignSnapshot } = require('./uiDesignSnapshot');
const { createDesignApplication } = require('./uiDesignApplication');
const { STYLE_KEYS, safeStyle } = require('./uiDesignTargets');

const MAX_BYTES = 48 * 1024 * 1024;

function normalizeRequests(value, captures) {
    const result = {};
    for (const capture of captures) {
        const submitted = value?.[capture.id];
        if (!submitted || typeof submitted !== 'object') continue;
        const changes = {};
        for (const node of capture.snapshot.nodes) {
            const request = submitted[node.id];
            if (!request || typeof request !== 'object') continue;
            const clean = {};
            for (const [key, next] of Object.entries(request)) {
                if (typeof next !== 'string' || next.length > (key === 'note' ? 2000 : 500)) continue;
                if (key === 'note') { if (next.trim()) clean.note = next; }
                else if (key === 'text' || key === 'placeholder') {
                    if (typeof node[key] === 'string' && next !== node[key]) clean[key] = next;
                } else if (next !== node.styles[key] && safeStyle(key, next)) clean[key] = next;
            }
            if (Object.keys(clean).length) changes[node.id] = clean;
        }
        if (Object.keys(changes).length) result[capture.id] = changes;
    }
    return result;
}

function reviewDocument(state) {
    const requests = normalizeRequests(state.requests, state.captures);
    return { format: 'local-ai-workstation-ui-design-requests', version: 2, exportAppliesChanges: false, exportedAt: new Date().toISOString(),
        captures: state.captures.filter(capture => requests[capture.id]).map(capture => ({ title: capture.snapshot.title,
            capturedAt: capture.snapshot.capturedAt, viewport: { width: capture.snapshot.width, height: capture.snapshot.height },
            edits: capture.snapshot.nodes.filter(node => requests[capture.id][node.id]).map(node => ({
                target: { selector: node.selector, label: node.label, workspace: node.scope, tag: node.tag },
                changes: Object.entries(requests[capture.id][node.id]).map(([property, after]) => ({ property,
                    before: property === 'note' ? '' : node[property] ?? node.styles[property], requested: after })),
            })) })) };
}

function menuSnapshot(menu) {
    return (menu?.items || []).filter(item => item.visible !== false).map(item => ({
        label: item.type === 'separator' ? '—' : (item.label || item.role || '').replace(/&&/g, '\0').replace(/&/g, '').replace(/\0/g, '&'),
        ...(item.submenu ? { items: menuSnapshot(item.submenu) } : {}),
    }));
}

function createUIDesignMirror({ BrowserWindow, ipcMain, dialog, getWindow, getMenu, directory }) {
    const folder = path.join(__dirname, 'ui-design-mirror');
    const entry = pathToFileURL(path.join(folder, 'index.html')).href;
    const assets = new Set(['index.html', 'editor.js', 'editor.css', 'model.mjs'].map(name => pathToFileURL(path.join(folder, name)).href));
    const file = path.join(directory, 'ui-design-mirror', 'draft.json');
    const application = createDesignApplication({ directory, getWindow });
    let win = null, state, opening, saving = Promise.resolve(), commands = Promise.resolve(), disposed = false;
    const trusted = event => win && !win.isDestroyed() && event.sender === win.webContents
        && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url === entry;
    async function load() {
        if (state) return state;
        state = { version: 1, captures: [], requests: {} };
        try {
            if ((await fs.stat(file)).size > MAX_BYTES) throw Error('Saved mirror draft is too large.');
            const saved = JSON.parse(await fs.readFile(file, 'utf8'));
            if (saved.version !== 1 || !Array.isArray(saved.captures) || saved.captures.length > 8 || saved.captures.some(c =>
                !/^[a-f\d-]{36}$/.test(c.id) || !Array.isArray(c.snapshot?.nodes) || c.snapshot.nodes.length > 31000 ||
                !Array.isArray(c.snapshot.workspaces) || !Array.isArray(c.snapshot.warnings) ||
                !['html', 'css', 'htmlAttributes', 'bodyAttributes', 'title', 'capturedAt'].every(key => typeof c.snapshot[key] === 'string') ||
                !['width', 'height'].every(key => Number.isFinite(c.snapshot[key]) && c.snapshot[key] > 0 && c.snapshot[key] <= 32000) ||
                c.snapshot.nodes.some(node => !/^n\d+$/.test(node.id) || !node.styles || typeof node.styles !== 'object' ||
                    !['tag', 'label', 'selector', 'scope'].every(key => typeof node[key] === 'string')))) throw Error('Saved mirror draft has an unsupported format.');
            state = { version: 1, captures: saved.captures, requests: normalizeRequests(saved.requests, saved.captures) };
        } catch (error) { if (error.code !== 'ENOENT') state.warning = 'The previous draft could not be read. Its file has been preserved; new captures are in memory until you save.'; }
        return state;
    }
    async function persist() {
        const text = JSON.stringify(state);
        if (Buffer.byteLength(text) > MAX_BYTES) throw Error('The draft is too large to save. Remove an unused capture.');
        const pending = saving.catch(() => {}).then(async () => {
            await fs.mkdir(path.dirname(file), { recursive: true });
            const temporary = `${file}.${randomUUID()}.tmp`;
            try {
                await fs.writeFile(temporary, text, { encoding: 'utf8', flag: 'wx' });
                // Retain an unreadable prior draft before the first replacement.
                if (state.warning) { await fs.copyFile(file, `${file}.${Date.now()}.recovery`).catch(error => { if (error.code !== 'ENOENT') throw error; }); delete state.warning; }
                await fs.rename(temporary, file);
            } finally { await fs.rm(temporary, { force: true }); }
        });
        saving = pending; await pending;
    }
    async function capture() {
        await load();
        if (state.captures.length >= 8) throw Error('Keep up to eight captures. Remove an unused capture before adding another.');
        const main = getWindow();
        if (!main || main.isDestroyed()) throw Error('The application window is unavailable.');
        const snapshot = await main.webContents.executeJavaScript(`(${captureDesignSnapshot.toString()})(${JSON.stringify(menuSnapshot(getMenu?.()))})`);
        const item = { id: randomUUID(), snapshot };
        if (Buffer.byteLength(JSON.stringify(snapshot)) + Buffer.byteLength(JSON.stringify(state)) > MAX_BYTES) throw Error('This capture is too large. Close large lists in the app and try again.');
        state.captures.push(item);
        return item;
    }
    for (const [action, handler] of Object.entries({
        load,
        prepare: async () => application.prepare(await load()),
        apply: async value => application.apply(value?.ticket, await load()),
        undo: () => application.undo(),
        capture: async () => { const item = await capture(); await persist(); return item; },
        save: async value => {
            await load();
            if (!value || !Array.isArray(value.captureIds)) throw Error('Invalid mirror draft.');
            state.captures = state.captures.filter(item => value.captureIds.includes(item.id));
            state.requests = normalizeRequests(value.requests, state.captures);
            await persist(); return { saved: true };
        },
        export: async () => {
            const report = reviewDocument(await load());
            if (!report.captures.length) throw Error('Make a design request before exporting.');
            const chosen = await dialog.showSaveDialog(win, { title: 'Export requested UI edits', defaultPath: 'workstation-ui-design-requests.json',
                filters: [{ name: 'Design requests (JSON)', extensions: ['json'] }] });
            if (chosen.canceled || !chosen.filePath) return { cancelled: true };
            const temporary = `${chosen.filePath}.${randomUUID()}.tmp`;
            try {
                await fs.writeFile(temporary, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
                await fs.rename(temporary, chosen.filePath);
            } finally { await fs.rm(temporary, { force: true }); }
            return { exported: true };
        },
    })) ipcMain.handle(`design-mirror:${action}`, async (event, value) => {
        if (!trusted(event)) return { error: 'UI Design Mirror access required.' };
        const next = commands.catch(() => {}).then(() => handler(value));
        commands = next;
        try { return await next; } catch (error) { return { error: error.message }; }
    });
    async function open() {
        if (disposed) return;
        if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); return; }
        if (opening) return opening;
        opening = (async () => {
            await load();
            if (!state.captures.length) { await capture(); await persist(); }
            if (disposed) return;
            win = new BrowserWindow({ parent: getWindow(), width: 1480, height: 980, minWidth: 850, minHeight: 620,
                show: false, title: 'UI Design Mirror · Local AI Workstation', backgroundColor: '#10141c',
                webPreferences: { preload: path.join(__dirname, 'uiDesignMirrorPreload.js'), sandbox: true,
                    contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false,
                    partition: `ui-design-mirror-${randomUUID()}` } });
            win.setMenu(null);
            const contents = win.webContents;
            contents.setWindowOpenHandler(() => ({ action: 'deny' }));
            contents.session.setPermissionRequestHandler((_wc, _permission, done) => done(false));
            contents.session.setPermissionCheckHandler(() => false);
            contents.session.on('will-download', event => event.preventDefault());
            contents.session.webRequest.onBeforeRequest((request, done) => done({ cancel: !assets.has(request.url) && !request.url.startsWith('data:image/') && request.url !== 'about:blank' && request.url !== 'about:srcdoc' }));
            contents.on('will-navigate', event => event.preventDefault());
            contents.on('will-frame-navigate', event => event.preventDefault());
            contents.on('will-attach-webview', event => event.preventDefault());
            win.once('closed', () => { win = null; });
            try { await win.loadURL(entry); win?.show(); }
            catch (error) { win?.destroy(); throw error; }
        })().finally(() => { opening = null; });
        return opening;
    }
    return { open, attach: application.attach, async dispose() { disposed = true; await commands.catch(() => {}); await saving.catch(() => {}); await application.dispose(); win?.destroy(); } };
}
module.exports = { createUIDesignMirror, normalizeRequests, reviewDocument, menuSnapshot, STYLE_KEYS };
