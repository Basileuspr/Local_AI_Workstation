const fs = require('node:fs');
const path = require('node:path');

const TOOL_NAMES = { ghidra: 'Ghidra', dnspyex: 'dnSpyEx', jadx: 'JADX', x64dbg: 'x64dbg', frida: 'Frida' };
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

// Installation receipts are local to this desktop profile. The renderer receives
// opaque launcher IDs and availability, never paths or executable arguments.
function createReverseEngineerInstallations({ directory }) {
    const manifest = path.join(directory, 'reverse-engineer-installations.json');
    const registry = path.join(directory, 'program-launchers.json');
    const isFile = filename => { try { return fs.statSync(filename).isFile(); } catch { return false; } };
    return function installations() {
        try {
            if (!fs.existsSync(manifest)) return { tools: {} };
            const receipt = JSON.parse(fs.readFileSync(manifest, 'utf8'));
            const records = fs.existsSync(registry) ? JSON.parse(fs.readFileSync(registry, 'utf8')) : [];
            if (receipt?.schema_version !== 1 || !receipt.tools || typeof receipt.tools !== 'object'
                || Array.isArray(receipt.tools) || !Array.isArray(records)) throw Error('Invalid receipt');
            const tools = {};
            for (const [key, item] of Object.entries(receipt.tools)) {
                if (!Object.hasOwn(TOOL_NAMES, key) || !item || typeof item.id !== 'string' || !uuid.test(item.id)
                    || typeof item.version !== 'string' || !item.version.trim() || item.version.length > 80
                    || !Array.isArray(item.checkFiles) || !item.checkFiles.length || item.checkFiles.length > 20
                    || item.checkFiles.some(file => typeof file !== 'string' || !path.isAbsolute(file))) throw Error('Invalid receipt');
                const record = records.find(entry => entry?.id === item.id);
                const available = !!record && typeof record.path === 'string' && path.isAbsolute(record.path)
                    && /\.(exe|lnk)$/i.test(record.path) && isFile(record.path) && item.checkFiles.every(isFile);
                tools[key] = { id: item.id, name: TOOL_NAMES[key], version: item.version, available,
                    detail: available ? 'Installed locally' : 'Installation files are missing. Restore the installation or choose a different program.' };
            }
            return { tools };
        } catch {
            return { tools: {}, error: 'Installed tool details could not be read. Refresh to retry, or choose a program manually.' };
        }
    };
}

module.exports = { createReverseEngineerInstallations };
