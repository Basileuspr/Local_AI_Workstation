import { describe, expect, it, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mirror from '../../electron/uiDesignMirror';
import shutdown from '../../electron/appShutdown';
import { editCount, withChange, snapshotDocument } from '../../electron/ui-design-mirror/model.mjs';

const node = { id: 'n0', tag: 'h2', label: 'A heading', scope: 'dashboard', selector: '#app > h2:nth-of-type(1)', text: 'A heading', styles: { color: 'rgb(0, 0, 0)', 'font-size': '24px' } };
const captures = [{ id: 'capture-1', snapshot: { title: 'Dashboard', capturedAt: '2026-10-30T12:00:00Z', width: 1200, height: 800, nodes: [node] } }];
const directories = [];
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });

async function host(directory) {
    if (!directory) { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'law-mirror-unit-')); directories.push(directory); }
    const handlers = new Map(), windows = [];
    class Window extends EventEmitter {
        constructor(options) {
            super(); this.options = options; this.destroyed = false;
            const session = new EventEmitter();
            session.setPermissionCheckHandler = fn => { this.permissions = fn; };
            session.setPermissionRequestHandler = () => {};
            session.webRequest = { onBeforeRequest: fn => { this.filter = fn; } };
            this.webContents = Object.assign(new EventEmitter(), { session, mainFrame: { url: '' }, setWindowOpenHandler: fn => { this.popups = fn; } });
            windows.push(this);
        }
        isDestroyed() { return this.destroyed; } isMinimized() { return false; }
        setMenu() {} show() {} focus() {}
        async loadURL(url) { this.webContents.mainFrame.url = url; }
        destroy() { this.destroyed = true; this.emit('closed'); }
    }
    const source = { isDestroyed: () => false, webContents: { executeJavaScript: async () => ({ ...captures[0].snapshot,
        version: 1, html: '<div id="app"></div>', css: '', htmlAttributes: '', bodyAttributes: '', workspaces: [], warnings: [] }) } };
    const manager = mirror.createUIDesignMirror({ BrowserWindow: Window, ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
        dialog: { showSaveDialog: async () => ({ canceled: true }) }, directory, getWindow: () => source });
    await manager.open();
    const window = windows[0], event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
    const invoke = (action, value, sender = event) => handlers.get(`design-mirror:${action}`)(sender, value);
    return { directory, manager, window, windows, invoke, event };
}

describe('UI Design Mirror requests', () => {
    it('keeps each target separate, records original values and removes reversions', () => {
        const other = { ...node, id: 'n1' };
        let edits = withChange({}, 'capture-1', node, 'font-size', '32px');
        edits = withChange(edits, 'capture-1', node, 'color', 'rgb(255, 0, 0)');
        edits = withChange(edits, 'capture-1', other, 'text', 'Different heading');
        expect(editCount(edits)).toBe(3);
        expect(node.styles['font-size']).toBe('24px');
        edits = withChange(edits, 'capture-1', node, 'font-size', '24px');
        edits = withChange(edits, 'capture-1', node, 'color', null);
        expect(edits).toEqual({ 'capture-1': { n1: { text: 'Different heading' } } });
        edits = withChange(edits, 'capture-1', other, 'text', null);
        expect(edits).toEqual({});
    });
    it('accepts only known targets and safe properties while retaining text as plain data', () => {
        const dirty = { 'capture-1': { n0: { color: 'red', 'font-size': '24px', 'background-image': 'url(http://127.0.0.1/private)',
            script: 'bad', text: '<img src=x onerror=bad()>', note: 'Keep this heading prominent.', height: '1px;display:none', width: 'x'.repeat(501) }, n999: { color: 'red' } }, unknown: { n0: { color: 'red' } } };
        expect(mirror.normalizeRequests(dirty, captures)).toEqual({ 'capture-1': { n0: { color: 'red', text: '<img src=x onerror=bad()>', note: 'Keep this heading prominent.' } } });
        const report = mirror.reviewDocument({ captures, requests: dirty });
        expect(report.applied).toBe(false);
        expect(report.captures[0].edits[0].changes[0]).toEqual({ property: 'color', before: 'rgb(0, 0, 0)', requested: 'red' });
        expect(report.captures[0]).not.toHaveProperty('html');
    });
    it('does not count blank notes and does not mutate undo history', () => {
        const original = withChange({}, 'capture-1', node, 'note', 'Make the title clearer.');
        expect(withChange(original, 'capture-1', node, 'note', ' ')).toEqual({});
        expect(editCount(original)).toBe(1);
    });
    it('opens through the menu without invoking lifecycle actions', () => {
        let opens = 0, exits = 0;
        const menu = shutdown.applicationMenu(() => exits++, () => opens++);
        menu.find(item => item.label === 'Design').submenu[0].click();
        expect(opens).toBe(1); expect(exits).toBe(0);
        expect(mirror.menuSnapshot({ items: [{ label: '&File', submenu: { items: [{ label: 'Exit && Restart' }, { type: 'separator' }] } }, { label: 'Hidden', visible: false }] }))
            .toEqual([{ label: 'File', items: [{ label: 'Exit & Restart' }, { label: '—' }] }]);
    });
    it('renders a network-free, scriptless document and prevents CSS ending its style element', () => {
        const html = snapshotDocument({ html: '<div id="app"></div>', css: 'a::after { content:"</style><script>bad()</script>" }', htmlAttributes: '', bodyAttributes: '' });
        expect(html).toContain("script-src 'none'"); expect(html).toContain("connect-src 'none'");
        expect(html).not.toContain('</style><script>');
    });
});

describe('UI Design Mirror host boundary', () => {
    it('reuses its child, denies other frames/hosts, and permits only local editor assets', async () => {
        const h = await host();
        await h.manager.open(); expect(h.windows).toHaveLength(1);
        expect(h.window.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false });
        expect(h.window.options.webPreferences.partition).not.toMatch(/^persist:/);
        expect(h.window.permissions()).toBe(false); expect(h.window.popups()).toEqual({ action: 'deny' });
        for (const sender of [{ ...h.event, sender: {} }, { ...h.event, senderFrame: { url: h.event.senderFrame.url } }])
            expect(await h.invoke('load', null, sender)).toHaveProperty('error');
        const allowed = url => new Promise(resolve => h.window.filter({ url }, resolve));
        expect(await allowed(h.window.webContents.mainFrame.url)).toEqual({ cancel: false });
        for (const url of ['http://127.0.0.1:8000/health', 'https://example.com/', 'file:///C:/Users/private.txt', 'ws://localhost:8000', 'app://local/index.html'])
            expect(await allowed(url)).toEqual({ cancel: true });
        await h.manager.dispose();
    });
    it('persists only known requests, serializes writes, restores from disk and bounds captures', async () => {
        const h = await host(), state = await h.invoke('load'), id = state.captures[0].id;
        const first = h.invoke('save', { captureIds: [id], requests: { [id]: { n0: { color: 'red' } } } });
        const last = h.invoke('save', { captureIds: [id], requests: { [id]: { n0: { color: 'blue' }, bad: { color: 'red' } } } });
        await Promise.all([first, last]);
        await h.manager.dispose();
        const restored = await host(h.directory);
        expect((await restored.invoke('load')).requests).toEqual({ [id]: { n0: { color: 'blue' } } });
        for (let i = 1; i < 8; i++) expect(await restored.invoke('capture')).toHaveProperty('snapshot');
        expect((await restored.invoke('capture')).error).toMatch(/eight captures/);
        expect(await restored.invoke('export')).toEqual({ cancelled: true });
        await restored.manager.dispose();
    });
    it('retains an unreadable prior draft in a recovery file before replacing it', async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'law-mirror-unit-')); directories.push(directory);
        const folder = path.join(directory, 'ui-design-mirror'); await fs.mkdir(folder);
        await fs.writeFile(path.join(folder, 'draft.json'), '{corrupt-draft');
        const h = await host(directory);
        const recovery = (await fs.readdir(folder)).find(file => file.endsWith('.recovery'));
        expect(await fs.readFile(path.join(folder, recovery), 'utf8')).toBe('{corrupt-draft');
        expect(JSON.parse(await fs.readFile(path.join(folder, 'draft.json'), 'utf8')).captures).toHaveLength(1);
        await h.manager.dispose();
    });
});
