const { createReadStream } = require('fs');
const { createHash } = require('crypto');
const path = require('path');
const { pickLocalPath } = require('./filePicker');

async function fingerprint(target) {
    try {
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(target)) hash.update(chunk);
        return hash.digest('hex');
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function createLocalFiles({ request, openDialog, saveDialog, confirm, home }) {
    const files = new Map(); let busy = false; let dirty = false;
    return {
        setDirty(value) { dirty = !!value; },
        async canLeave() { return !dirty || await confirm('Discard unsaved document changes?', 'Your latest document edits have not been saved.'); },
        async open() {
            if (busy) return { canceled: true };
            busy = true;
            try {
                const handlers = await request('/handlers');
                const extensions = handlers.filter(h => h.available).flatMap(h => h.extensions.map(e => e.slice(1)));
                const selected = await pickLocalPath(extensions, { home, showDialog: openDialog });
                if (!selected) return { canceled: true };
                const result = await request('/open', { path: selected });
                files.set(result.id, selected);
                // The renderer receives an opaque session, never filesystem authority.
                return result;
            } finally { busy = false; }
        },
        async save({ id, changes, saveAs, acknowledged }) {
            if (busy) return { canceled: true };
            if (!files.has(id)) throw new Error('Reopen this document with the desktop file dialog.');
            busy = true;
            try {
                let target = files.get(id);
                if (saveAs) {
                    const choice = await saveDialog({ title: 'Save document as', defaultPath: target,
                        filters: [{ name: 'Word document', extensions: ['docx'] }], properties: ['showOverwriteConfirmation', 'dontAddToRecent'] });
                    if (choice.canceled || !choice.filePath) return { canceled: true };
                    target = choice.filePath;
                } else if (!await confirm('Save document changes?', `Replace ${path.basename(target)} with your edits?`)) return { canceled: true };
                if (path.extname(target).toLowerCase() !== '.docx') throw new Error('Choose a .docx destination.');
                const expected_target = await fingerprint(target);
                const result = await request(`/${id}/save`, { target, changes, expected_target, acknowledged: !!acknowledged });
                files.set(id, target); dirty = false; return result;
            } finally { busy = false; }
        },
        forget(id) { files.delete(id); dirty = false; },
    };
}
module.exports = { createLocalFiles, fingerprint };
