'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const MAX_BYTES = 128 * 1024 * 1024;
const EXTENSIONS = { png: 'png', jpeg: 'jpg', webp: 'webp', bmp: 'bmp', lawpaint: 'lawpaint' };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function paintExport(request) {
  if (!request || !Object.hasOwn(EXTENSIONS, request.format)) throw Error('Choose a supported Canvas file format.');
  if (!(request.bytes instanceof Uint8Array) || !request.bytes.byteLength || request.bytes.byteLength > MAX_BYTES) throw Error('Canvas exports must contain 1 byte to 128 MB.');
  const bytes = Buffer.from(request.bytes), format = request.format;
  const valid = format === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : format === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : format === 'webp' ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
    : format === 'bmp' ? bytes.toString('ascii', 0, 2) === 'BM' : (() => {
      try { const value = JSON.parse(bytes.toString('utf8')); return value.format === 'law-paint' && value.version === 1 && Array.isArray(value.layers) && value.layers.length > 0 && value.layers.length <= 16; } catch { return false; }
    })();
  if (!valid) throw Error('The export data does not match the selected file format.');
  const stem = String(request.name || 'Untitled').split(/[\\/]/).pop().replace(/\.(png|jpe?g|webp|bmp|lawpaint)$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 150) || 'Untitled';
  return { bytes, format, name: `${stem}.${EXTENSIONS[format]}` };
}

function registerPaintIpc({ ipcMain, dialog, getWindow, trustedDesktop, BrowserWindow }) {
  const tickets = new WeakMap(), busy = new WeakSet();
  ipcMain.handle('paint:save', async (event, request) => {
    if (!trustedDesktop(event)) return { error: 'Canvas files require the trusted desktop window.' };
    if (busy.has(event.sender)) return { error: 'Finish the current Canvas file dialog first.' };
    busy.add(event.sender);
    let temporary;
    try {
      const output = paintExport(request), owned = tickets.get(event.sender) || new Map();
      let filePath, previous, ticket = request.ticket;
      if (ticket) {
        const granted = owned.get(ticket);
        if (!granted || granted.format !== output.format) throw Error('Choose Save as to save this file.');
        filePath = granted.path; previous = granted.hash;
        let current;
        try { current = await fs.readFile(filePath); } catch { throw Error('The saved file is unavailable. Choose Save as to create another copy.'); }
        if (digest(current) !== previous) throw Error('This file changed outside Canvas. Choose Save as to preserve both versions.');
      } else {
        const choice = await dialog.showSaveDialog(getWindow(), { title: output.format === 'lawpaint' ? 'Save editable Canvas project' : 'Save Canvas image', defaultPath: output.name,
          filters: [{ name: output.format === 'lawpaint' ? 'Canvas project' : output.format.toUpperCase() + ' image', extensions: [EXTENSIONS[output.format]] }], properties: ['showOverwriteConfirmation'] });
        if (choice.canceled || !choice.filePath || !trustedDesktop(event)) return { canceled: true };
        filePath = choice.filePath;
        if (path.extname(filePath).toLowerCase() !== `.${EXTENSIONS[output.format]}` && !(output.format === 'jpeg' && path.extname(filePath).toLowerCase() === '.jpeg')) throw Error(`Use the .${EXTENSIONS[output.format]} extension for this export.`);
        try { previous = digest(await fs.readFile(filePath)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        ticket = randomUUID();
      }
      temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
      await fs.writeFile(temporary, output.bytes, { flag: 'wx' });
      if (previous) {
        if (digest(await fs.readFile(filePath)) !== previous) throw Error('The destination changed while saving. Choose another filename.');
        await fs.rename(temporary, filePath);
      } else {
        // An exclusive copy also protects a newly created filename from races.
        await fs.copyFile(temporary, filePath, require('node:fs').constants.COPYFILE_EXCL);
      }
      owned.set(ticket, { path: filePath, format: output.format, hash: digest(output.bytes) });
      tickets.set(event.sender, owned);
      return { saved: true, ticket, format: output.format, name: path.basename(filePath) };
    } catch (error) { return { error: error.message }; }
    finally { if (temporary) await fs.unlink(temporary).catch(() => {}); busy.delete(event.sender); }
  });
  ipcMain.handle('paint:print', async (event, request) => {
    if (!trustedDesktop(event)) return { error: 'Printing requires the trusted desktop window.' };
    if (busy.has(event.sender)) return { error: 'Finish the current Canvas file dialog first.' };
    busy.add(event.sender); let printWindow;
    try {
      const output = paintExport({ ...request, format: 'png' });
      printWindow = new BrowserWindow({ show: false, parent: getWindow(), webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      const html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>@page{margin:12mm}body{margin:0}img{display:block;max-width:100%;max-height:96vh;object-fit:contain}</style></head><body><img alt="Canvas artwork" src="data:image/png;base64,${output.bytes.toString('base64')}"></body></html>`;
      await printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      await new Promise((resolve, reject) => printWindow.webContents.print({ silent: false, printBackground: true }, (success, reason) => success ? resolve() : reject(Error(reason || 'Print cancelled.'))));
      return { printed: true };
    } catch (error) { return { error: error.message }; }
    finally { if (printWindow && !printWindow.isDestroyed()) printWindow.destroy(); busy.delete(event.sender); }
  });
}
module.exports = { paintExport, registerPaintIpc };
