import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import targets from '../../electron/uiDesignTargets';
import application from '../../electron/uiDesignApplication';

const directories = [];
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
const draft = (changes = { color: 'red' }, html = '<div id="app"><h2 id="heading" data-mirror-id="n1">Title</h2></div>') => ({
    captures: [{ id: 'capture', snapshot: { html, nodes: [{ id: 'n1', tag: 'h2', scope: 'shell', text: 'Title' }] } }], requests: { capture: { n1: changes } },
});

describe('Persistent UI design application', () => {
    it('upgrades existing snapshots into non-positional targets and rejects identical repeated controls', () => {
        const [row] = targets.applicationRequests(draft());
        expect(row.target.selector).toBe('[id="heading"]');
        expect(row.target.text).toBe('Title');
        const [repeated] = targets.applicationRequests(draft({ color: 'red' }, '<div id="app"><h2 data-mirror-id="n1">Title</h2><h2>Title</h2></div>'));
        expect(repeated.target).toBeNull();
        expect(repeated.reason).toMatch(/uniquely/);
        const [distinct] = targets.applicationRequests(draft({ color: 'red' }, '<div id="app"><h2 data-mirror-id="n1">Title</h2><h2>Other</h2></div>'));
        expect(distinct.target.selector).toBe('h2');
    });
    it('keeps notes and native menus request-only and rejects unsafe persisted styles', () => {
        const state = draft({ note: 'Make this draggable', color: 'red' });
        state.captures[0].snapshot.nodes[0].scope = 'menu';
        expect(targets.applicationRequests(state).map(row => row.reason)).toEqual([
            'Request only: written UX changes need implementation.', 'Request only: Windows draws the native menu bar.',
        ]);
        for (const value of ['url(http://private)', 'url(https://private)', 'expression(x)', 'red;display:none', 'var(--x)\\']) expect(targets.safeStyle('color', value)).toBe(false);
        expect(targets.safeStyle('color', '#abcdef')).toBe(true);
        expect(targets.safeStyle('display', 'none')).toBe(false);
        for (const value of ['image-set("https://private" 1x)', '-webkit-image-set("https://private" 1x)', 'var(--remote-image)', 'linear-gradient(red,blue), image-set("https://private" 1x)']) expect(targets.safeStyle('background-image', value)).toBe(false);
        expect(targets.safeStyle('background-image', 'linear-gradient(45deg, rgba(0, 0, 0, 0), #abcdef)')).toBe(true);
    });
    async function fixture() {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'law-design-apply-unit-')); directories.push(directory);
        let rules = [], fail = false, failRuntime = false;
        const runtime = { inspect: rows => rows.map(row => ({ ...row, status: row.reason ? 'blocked' : 'ready', current: 'black', reason: row.reason || 'Ready' })),
            replace: next => { rules = structuredClone(next); if (failRuntime) { failRuntime = false; throw Error('Renderer interrupted'); } return true; } };
        const source = { isDestroyed: () => false, webContents: { isDestroyed: () => false,
            executeJavaScript: code => Promise.resolve(Function('window', `return eval(${JSON.stringify(code)})`)({ __workstationDesignRuntime: runtime })) } };
        const options = { directory, getWindow: () => source, writeFile: async (...args) => { if (fail) throw Error('Disk full'); await fs.writeFile(...args); } };
        return { directory, options, create: () => application.createDesignApplication(options), rules: () => rules, fail: value => { fail = value; }, failRuntime: () => { failRuntime = true; } };
    }
    it('requires a current review ticket, merges edits, persists undo across a new service, and never changes the draft', async () => {
        const f = await fixture(), service = f.create(), state = draft(), original = structuredClone(state);
        await expect(service.apply('invented', state)).rejects.toThrow(/out of date/);
        const review = await service.prepare(state);
        expect(review.ready).toBe(1);
        await expect(service.apply(review.ticket, draft({ color: 'blue' }))).rejects.toThrow(/out of date/);
        await service.apply(review.ticket, state);
        expect(f.rules()[0].changes).toEqual({ color: 'red' });
        expect(state).toEqual(original);
        await expect(service.apply(review.ticket, state)).rejects.toThrow(/out of date/);
        const restarted = f.create();
        expect((await restarted.prepare(state)).canUndo).toBe(true);
        await restarted.undo(); expect(f.rules()).toEqual([]);
        const saved = JSON.parse(await fs.readFile(path.join(f.directory, 'ui-design-mirror/applied.json'), 'utf8'));
        expect(saved).toMatchObject({ rules: [], undo: null, revision: 2 });
        await expect(restarted.undo()).rejects.toThrow(/no applied batch/);
    });
    it('rolls back live changes on a failed save and retains the last saved design', async () => {
        const f = await fixture(), service = f.create(), state = draft();
        await service.apply((await service.prepare(state)).ticket, state);
        const file = path.join(f.directory, 'ui-design-mirror/applied.json'), before = await fs.readFile(file, 'utf8');
        const next = draft({ color: 'blue' });
        const review = await service.prepare(next); f.fail(true);
        await expect(service.apply(review.ticket, next)).rejects.toThrow(/previous design has been restored/);
        expect(f.rules()[0].changes).toEqual({ color: 'red' });
        expect(await fs.readFile(file, 'utf8')).toBe(before);
        expect(await fs.readdir(path.dirname(file))).toEqual(['applied.json']);
    });
    it('blocks conflicting capture requests instead of silently picking the last value', async () => {
        const f = await fixture(), service = f.create(), state = draft();
        state.captures.push({ ...structuredClone(state.captures[0]), id: 'other' });
        state.requests.other = { n1: { color: 'blue' } };
        const review = await service.prepare(state);
        expect(review.ready).toBe(0); expect(review.rows.every(row => row.status === 'blocked')).toBe(true);
        await expect(service.apply(review.ticket, state)).rejects.toThrow(/no ready changes/);
        state.requests.other.n1.color = 'red';
        const deduplicated = await service.prepare(state);
        expect(deduplicated.ready).toBe(1); expect(deduplicated.rows[1].status).toBe('duplicate');
    });
    it('restores the previous design when the renderer fails during application', async () => {
        const f = await fixture(), service = f.create(), state = draft();
        const review = await service.prepare(state); f.failRuntime();
        await expect(service.apply(review.ticket, state)).rejects.toThrow(/Renderer interrupted/);
        expect(f.rules()).toEqual([]);
        await expect(fs.stat(path.join(f.directory, 'ui-design-mirror/applied.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    });
    it('preserves a corrupt applied design without replacing it with empty defaults', async () => {
        const f = await fixture(), file = path.join(f.directory, 'ui-design-mirror/applied.json');
        await fs.mkdir(path.dirname(file)); await fs.writeFile(file, '{broken');
        await expect(f.create().prepare(draft())).rejects.toThrow(/file was preserved/);
        expect(await fs.readFile(file, 'utf8')).toBe('{broken');
        expect(f.rules()).toEqual([]);
    });
});
