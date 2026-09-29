const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

function createGifFiles({showSaveDialog, showOpenDialog, showItemInFolder, downloads}) {
    const saved = new Map();
    const folders = new Map();
    let choosing = false;
    let saving = false;
    return {
        async chooseOutput() {
            if (choosing) return {canceled:true};
            choosing = true;
            try {
                const choice = await showOpenDialog({title:'Point GIF output to a folder', defaultPath:downloads(), properties:['openDirectory','createDirectory','dontAddToRecent']});
                if (choice.canceled || !choice.filePaths?.length) return {canceled:true};
                const folder = choice.filePaths[0];
                if (!path.isAbsolute(folder) || !(await fs.stat(folder)).isDirectory()) throw new Error('Choose an output folder.');
                const id = randomUUID(); folders.set(id, folder);
                if (folders.size > 32) folders.delete(folders.keys().next().value);
                return {id, folder};
            } catch (error) {return {error:`Could not select the GIF output folder: ${error.message}`};}
            finally {choosing=false;}
        },
        async save({bytes, name, folderId} = {}) {
            if (saving) return {canceled: true};
            if (!(bytes instanceof ArrayBuffer || bytes instanceof Uint8Array)) return {error: 'Invalid GIF data.'};
            const data = Buffer.from(bytes);
            if (data.length < 13 || data.length > 100 * 1024 * 1024 || !/^GIF8[79]a$/.test(data.toString('ascii', 0, 6))) return {error: 'Choose a valid GIF up to 100 MiB.'};
            saving = true;
            let temporary;
            try {
                let filename = path.basename(String(name || 'Animation.gif')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 110);
                if (!/\.gif$/i.test(filename)) filename += '.gif';
                if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) filename = `_${filename}`;
                let target;
                if (folderId !== undefined) {
                    const folder = folders.get(folderId);
                    if (!folder) return {error:'Choose the GIF output folder again.'};
                    if (!(await fs.stat(folder)).isDirectory()) return {error:'The GIF output folder is unavailable. Choose another folder or clear Point output.'};
                    // Exclusive creation preserves existing exports, even if another
                    // process creates the same name while this save is in flight.
                    for (let index=0; index<1000; index++) {
                        const candidate = path.join(folder, index ? `${filename.slice(0,-4)} (${index+1}).gif` : filename);
                        let file;
                        try {file = await fs.open(candidate, 'wx');}
                        catch (error) {if (error.code === 'EEXIST') continue; throw error;}
                        try {await file.writeFile(data); await file.close(); target=candidate;}
                        catch (error) {await file.close().catch(()=>{}); await fs.unlink(candidate).catch(()=>{}); throw error;}
                        break;
                    }
                    if (!target) return {error:'Too many GIFs have this name. Choose a different animation name.'};
                } else {
                const result = await showSaveDialog({title: 'Save GIF', defaultPath: path.join(downloads(), filename), filters: [{name: 'GIF animation', extensions: ['gif']}], properties: ['showOverwriteConfirmation']});
                if (result.canceled || !result.filePath) return {canceled: true};
                target = result.filePath;
                if (!path.isAbsolute(target) || path.extname(target).toLowerCase() !== '.gif') return {error: 'Save the animation with a .gif extension.'};
                temporary = path.join(path.dirname(target), `.gif-${randomUUID()}.tmp`);
                await fs.writeFile(temporary, data, {flag: 'wx'});
                await fs.rename(temporary, target);
                temporary = null;
                }
                const id = randomUUID();
                saved.set(id, target);
                if (saved.size > 128) saved.delete(saved.keys().next().value);
                return {id, path: target};
            } catch (error) { return {error: `Could not save the GIF: ${error.message}`}; }
            finally { if (temporary) await fs.unlink(temporary).catch(() => {}); saving = false; }
        },
        async reveal(id) {
            // The renderer can only reveal a file saved through this chooser.
            const target = saved.get(id);
            if (!target) return {error: 'Save this GIF first to open its file location.'};
            try {
                if (!(await fs.stat(target)).isFile()) throw new Error('missing');
                showItemInFolder(target);
                return {ok: true};
            } catch { return {error: 'The saved GIF could not be found or opened. It may have been moved or deleted.'}; }
        },
    };
}
module.exports = {createGifFiles};
