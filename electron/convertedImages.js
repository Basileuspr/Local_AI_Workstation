"use strict";
const fs = require('node:fs/promises');
const path = require('node:path');
const FORMATS = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/bmp':'bmp','image/tiff':'tiff','image/vnd.microsoft.icon':'ico','image/x-icon':'ico'};
const MAX_BYTES = 128 * 1024 ** 2;

function convertedFilename(disposition, extension) {
    let name;
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition || '');
    if (encoded) { try { name = decodeURIComponent(encoded[1]); } catch {} }
    if (!name) name = /filename="([^"]+)"/i.exec(disposition || '')?.[1];
    name = path.win32.basename(name || `converted.${extension}`).replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/[ .]+$/g, '');
    if (!name || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) name = `converted.${extension}`;
    if (!name.toLowerCase().endsWith('.' + extension)) name += '.' + extension;
    return name;
}

function createConvertedImageSaver({getResponse, showDialog, downloads, writeFile = fs.writeFile}) {
    let saving = false;
    return async function saveConvertedImage(id) {
        if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) throw Error('Choose a valid converted image.');
        if (saving) throw Error('Finish the current image save first.');
        saving = true;
        try {
            const response = await getResponse(id);
            if (!response.ok) {
                const value = await response.json().catch(() => ({}));
                throw Error(typeof value.detail === 'string' ? value.detail : `Converted image could not be downloaded (${response.status}).`);
            }
            const extension = FORMATS[(response.headers.get('content-type') || '').split(';')[0].trim()];
            if (!extension) throw Error('The backend did not return a converted image. Convert it again and retry.');
            if (Number(response.headers.get('content-length')) > MAX_BYTES) throw Error('The converted image is too large to save.');
            const bytes = Buffer.from(await response.arrayBuffer());
            if (!bytes.length || bytes.length > MAX_BYTES) throw Error('The converted image is empty or too large to save.');
            if (extension === 'ico' && (bytes.length < 6 || bytes.readUInt32LE(0) !== 0x00010000 || !bytes.readUInt16LE(4))) throw Error('The converted icon is invalid. Convert it again and retry.');
            const name = convertedFilename(response.headers.get('content-disposition'), extension);
            const choice = await showDialog({title:'Save converted image',defaultPath:path.join(downloads(), name),
                filters:[{name:extension.toUpperCase() + ' image',extensions:[extension]}],properties:['showOverwriteConfirmation']});
            if (choice.canceled || !choice.filePath) return {canceled:true};
            const target = choice.filePath.toLowerCase().endsWith('.' + extension) ? choice.filePath : choice.filePath + '.' + extension;
            await writeFile(target, bytes);
            return {saved:true,name:path.basename(target),size:bytes.length};
        } finally { saving = false; }
    };
}
module.exports = {createConvertedImageSaver, convertedFilename};
