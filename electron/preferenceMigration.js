// Only known application preferences cross the old file:// -> app:// boundary.
// Existing app:// values always win. The original storage is never cleared.
const KEYS = ["local-ai-workstation-preferences-v1", "local-ai-workstation-roleplay", "local-ai-workstation-prompt-phrases-v1"];
const MARKER = "law-app-origin-migrated-v1";
const plain = value => value && typeof value === "object" && !Array.isArray(value);
function merge(older, newer) {
    if (plain(older) && plain(newer)) {
        const result = { ...older };
        for (const key of Object.keys(newer)) {
            if (["__proto__", "constructor", "prototype"].includes(key)) continue;
            result[key] = key in older ? merge(older[key], newer[key]) : newer[key];
        }
        return result;
    }
    if (Array.isArray(older) && Array.isArray(newer) && [...older, ...newer].every(item => plain(item) && typeof item.id === "string")) {
        return [...older.filter(item => !newer.some(current => current.id === item.id)), ...newer];
    }
    return newer;
}
function migrateValues(older, newer) {
    const result = {};
    for (const key of KEYS) {
        if (!older[key] || older[key].length > 2_000_000) continue;
        // Invalid old data is preserved in its old origin and reported for retry.
        const oldValue = JSON.parse(older[key]);
        result[key] = JSON.stringify(newer[key] == null ? oldValue : merge(oldValue, JSON.parse(newer[key])));
    }
    return result;
}
async function migratePreferences({ BrowserWindow, oldPath, appUrl }) {
    const window = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const execute = code => window.webContents.executeJavaScriptInIsolatedWorld(991, [{code}]);
    const read = () => execute(`Object.fromEntries(${JSON.stringify([...KEYS, MARKER])}.map(k => [k, localStorage.getItem(k)]))`);
    try {
        await window.loadURL(appUrl);
        const current = await read();
        if (current[MARKER]) return;
        await window.loadFile(oldPath);
        const values = migrateValues(await read(), current);
        await window.loadURL(appUrl);
        // No renderer scripts have run in this hidden migration window.
        await execute(`(() => { for (const [k,v] of Object.entries(${JSON.stringify(values)})) localStorage.setItem(k,v); localStorage.setItem(${JSON.stringify(MARKER)}, '1'); })()`);
    } finally { window.destroy(); }
}
module.exports = { KEYS, MARKER, migrateValues, migratePreferences };
