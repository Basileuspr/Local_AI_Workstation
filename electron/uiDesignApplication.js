const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { applicationRequests, safeStyle } = require('./uiDesignTargets');
const { installDesignRuntime } = require('./uiDesignRuntime');

function validRules(rules) {
    return Array.isArray(rules) && rules.length <= 1000 && rules.every(rule => typeof rule.id === 'string' && rule.id.length <= 100
        && rule.target && typeof rule.target.selector === 'string' && rule.target.selector.length <= 4000
        && /^[a-z][\w-]*$/.test(rule.target.tag) && Array.isArray(rule.target.classes) && rule.target.classes.every(value => typeof value === 'string')
        && rule.target.attributes && Object.values(rule.target.attributes).every(value => typeof value === 'string')
        && (rule.target.text === undefined || typeof rule.target.text === 'string') && rule.changes && typeof rule.changes === 'object'
        && Object.entries(rule.changes).every(([key, value]) => ['text', 'placeholder'].includes(key) ? typeof value === 'string' && value.length <= 500 : safeStyle(key, value)));
}
function createDesignApplication({ directory, getWindow, writeFile = fs.writeFile }) {
    const file = path.join(directory, 'ui-design-mirror', 'applied.json');
    let state, ticket, replayError = '', pending = Promise.resolve();
    const attachments = new Map();
    const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    async function load() {
        if (state) return state;
        let next = { version: 1, revision: 0, rules: [], undo: null };
        try {
            if ((await fs.stat(file)).size > 2 * 1024 * 1024) throw Error('Saved design overrides are too large.');
            next = JSON.parse(await fs.readFile(file, 'utf8'));
            if (next.version !== 1 || !Number.isSafeInteger(next.revision) || !validRules(next.rules) || next.undo !== null && !validRules(next.undo)) throw Error('Saved design overrides have an unsupported format.');
        } catch (error) { if (error.code !== 'ENOENT') throw Error(`Could not load applied design. The file was preserved. ${error.message}`); }
        state = next; return state;
    }
    async function persist(next) {
        const text = JSON.stringify(next);
        if (Buffer.byteLength(text) > 2 * 1024 * 1024 || !validRules(next.rules)) throw Error('Applied design is too large. Undo or reduce the number of edits.');
        await fs.mkdir(path.dirname(file), { recursive: true });
        const temporary = `${file}.${randomUUID()}.tmp`;
        try { await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx' }); await fs.rename(temporary, file); }
        finally { await fs.rm(temporary, { force: true }); }
    }
    async function runtime(method, ...args) {
        const window = getWindow();
        if (!window || window.isDestroyed() || window.webContents.isDestroyed()) throw Error('The application window is unavailable.');
        const result = await window.webContents.executeJavaScript(`(()=>{try{(${installDesignRuntime.toString()})(); return {value:window.__workstationDesignRuntime.${method}(...${JSON.stringify(args)})};}catch(error){return {error:error.message};}})()`);
        if (result.error) throw Error(result.error);
        return result.value;
    }
    // Serialize replay, apply and undo, including a reload while saving to disk.
    function serial(operation) {
        const result = pending.catch(() => {}).then(operation); pending = result; return result;
    }
    async function prepare(draft) {
        const saved = await load();
        if (replayError) throw Error(replayError);
        const rows = await runtime('inspect', applicationRequests(draft));
        const identities = new Map();
        for (const row of rows) {
            if (row.status === 'blocked') continue;
            const key = `${row.ruleId || hash(row.target)}:${row.property}`;
            const prior = identities.get(key);
            if (prior && prior.value !== row.value) {
                prior.status = row.status = 'blocked'; prior.reason = row.reason = 'Conflicting requests for this element. Keep one requested value.';
            } else if (prior) {
                row.status = prior.status === 'blocked' ? 'blocked' : 'duplicate'; row.reason = prior.status === 'blocked' ? prior.reason : 'Included with the same request from another capture';
            } else identities.set(key, row);
        }
        ticket = { id: randomUUID(), revision: saved.revision, draft: hash(draft), rows };
        return { ticket: ticket.id, rows, ready: rows.filter(row => row.status === 'ready').length, canUndo: saved.undo !== null };
    }
    async function commit(next, expected = []) {
        const previous = await load();
        try { await runtime('replace', next.rules, expected); await persist(next); }
        catch (error) {
            try { await runtime('replace', previous.rules); }
            catch { replayError = 'Saving failed and the app could not be restored. Restart to reload the previous saved design.'; }
            throw Error(`Design was not saved. ${error.message}${replayError ? ` ${replayError}` : ' The previous design has been restored.'}`);
        }
        state = next; ticket = null;
        return { applied: true, revision: next.revision, canUndo: next.undo !== null };
    }
    return {
        prepare: draft => serial(() => prepare(draft)),
        apply: (id, draft) => serial(async () => {
            const saved = await load();
            if (!ticket || id !== ticket.id || ticket.revision !== saved.revision || ticket.draft !== hash(draft)) throw Error('This review is out of date. Refresh the application check.');
            const ready = ticket.rows.filter(row => row.status === 'ready');
            if (!ready.length) throw Error('There are no ready changes to apply.');
            const rules = structuredClone(saved.rules);
            for (const row of ready) {
                const id = row.ruleId || hash(row.target);
                let rule = rules.find(item => item.id === id);
                if (!rule) { rule = { id, target: row.target, changes: {} }; rules.push(rule); }
                rule.changes[row.property] = row.value;
            }
            return { ...await commit({ version: 1, revision: saved.revision + 1, rules, undo: saved.rules }, ready), count: ready.length };
        }),
        undo: () => serial(async () => {
            const saved = await load();
            if (saved.undo === null) throw Error('There is no applied batch to undo.');
            await commit({ version: 1, revision: saved.revision + 1, rules: saved.undo, undo: null });
            return { undone: true };
        }),
        attach(window) {
            if (attachments.has(window.webContents)) return;
            const replay = () => {
                void serial(async () => {
                    const saved = await load();
                    await runtime('replace', saved.rules); replayError = '';
                }).catch(error => { replayError = error.message; console.error('UI design replay:', error.message); });
            };
            attachments.set(window.webContents, replay);
            window.webContents.on('did-finish-load', replay);
        },
        dispose: () => { for (const [contents, replay] of attachments) contents.removeListener('did-finish-load', replay); attachments.clear(); return pending.catch(() => {}); },
    };
}
module.exports = { createDesignApplication, validRules };
