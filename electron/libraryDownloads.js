// Native, atomic saves: image bytes never cross renderer IPC or become a Blob.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createHash, randomUUID } = require('node:crypto');
const { convertedFilename } = require('./convertedImages');
const FORMATS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'application/zip': 'zip' };

function createLibrarySaver({ getResponse, showDialog, downloads }) {
    let busy = false;
    return async id => {
        if (busy) throw Error('Finish the current image save first.');
        busy = true;
        let temporary, response;
        try {
            const head = await getResponse(id, 'HEAD');
            if (!head.ok) throw Error('This image is unavailable or locked.');
            const extension = FORMATS[(head.headers.get('content-type') || '').split(';')[0]];
            if (!extension) throw Error('The source is not a supported image.');
            const name = convertedFilename(head.headers.get('content-disposition'), extension);
            const choice = await showDialog({ title: extension === 'zip' ? 'Export original images and captions' : 'Save original image as', defaultPath: path.join(downloads(), name),
                filters: [{ name: extension.toUpperCase() + (extension === 'zip' ? ' archive' : ' image'), extensions: [extension] }], properties: ['showOverwriteConfirmation'] });
            if (choice.canceled || !choice.filePath) return { canceled: true };
            const target = choice.filePath;
            response = await getResponse(id, 'GET');
            if (!response.ok || !response.body) throw Error('This image is unavailable or locked.');
            const expected = response.headers.get('x-law-sha256');
            if (!/^[a-f0-9]{64}$/.test(expected || '')) throw Error('Image integrity information is missing. Restart the app and retry.');
            const expectedSize = Number(response.headers.get('content-length'));
            const hash = createHash('sha256'); let size = 0;
            const meter = new Transform({ transform(chunk, _encoding, callback) { size += chunk.length; hash.update(chunk); callback(null, chunk); } });
            temporary = path.join(path.dirname(target), `.law-image-${randomUUID()}.partial`);
            await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(temporary, { flags: 'wx' }));
            if (!size || size !== expectedSize || hash.digest('hex') !== expected) throw Error('The image transfer was incomplete. Retry saving it.');
            const file = await fsp.open(temporary, 'r+');
            try { await file.sync(); } finally { await file.close(); }
            await fsp.rename(temporary, target); temporary = null;
            return { saved: true, path: target, name: path.basename(target), size };
        } finally {
            if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
            if (temporary) await fsp.unlink(temporary).catch(() => {});
            busy = false;
        }
    };
}

function registerLibraryDownloadIpc({ ipcMain, trustedDesktop, getConnection, showDialog, downloads, shell, fetchResponse = fetch }) {
    const saved = new Map();
    const response = (id, method = 'GET', suffix = 'content?download=true') => {
        const { base, token } = getConnection();
        return fetchResponse(`${base}/image-library/images/${id}/${suffix}`, { method, headers: { 'X-LAW-Session': token }, redirect: 'error' });
    };
    const save = createLibrarySaver({ getResponse: response, showDialog, downloads });
    const valid = (event, id) => trustedDesktop(event) && typeof id === 'string' && /^[a-f0-9]{32}$/.test(id);
    ipcMain.handle('image-library:download', async (event, id) => {
        if (!valid(event, id)) return { error: 'Choose a saved library image in the desktop app.' };
        try {
            const result = await save(id);
            if (result.saved) { result.receipt = randomUUID(); saved.set(result.receipt, result.path); }
            return result;
        } catch (error) { return { error: error.message }; }
    });
    ipcMain.handle('image-library:reveal', async (event, id) => {
        if (!valid(event, id)) return { error: 'Choose a saved library image in the desktop app.' };
        try {
            const result = await response(id, 'GET', 'location'), value = await result.json();
            if (!result.ok || !path.isAbsolute(value.path || '')) throw Error(value.detail || 'Image unavailable.');
            shell.showItemInFolder(value.path); return { ok: true };
        } catch (error) { return { error: error.message }; }
    });
    ipcMain.handle('image-library:export', async (event, ids) => {
        if (!trustedDesktop(event) || !Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every(id => valid(event, id))) return { error: 'Choose 1–500 saved images.' };
        let archive;
        try {
            const { base, token } = getConnection();
            archive = await fetchResponse(`${base}/image-library/export`, { method: 'POST', redirect: 'error', headers: { 'X-LAW-Session': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
            const exportSave = createLibrarySaver({ showDialog, downloads, getResponse: async (_id, method) => method === 'HEAD' ? new Response(null, { status: archive.status, headers: archive.headers }) : archive });
            return await exportSave('archive');
        } catch (error) { return { error: error.message }; }
        finally { if (archive?.body && !archive.body.locked) await archive.body.cancel().catch(() => {}); }
    });
    ipcMain.handle('image-library:saved-file', async (event, receipt, action) => {
        if (!trustedDesktop(event) || !saved.has(receipt) || !['open', 'reveal'].includes(action)) return { error: 'Save the image first.' };
        try {
            const target = saved.get(receipt);
            if (action === 'reveal') shell.showItemInFolder(target);
            else { const error = await shell.openPath(target); if (error) throw Error(error); }
            return { ok: true };
        } catch (error) { return { error: error.message }; }
    });
}

module.exports = { registerLibraryDownloadIpc, createLibrarySaver };
