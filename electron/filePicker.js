const fs = require("fs/promises");
const path = require("path");

const TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", txt: "text/plain", md: "text/markdown", pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };

function extensionsFor(accept = "") {
    return Object.keys(TYPES).filter(ext => String(accept).split(",").some(value => {
        const item = value.trim().toLowerCase();
        return item === `.${ext}` || item === TYPES[ext] || (item === "image/*" && TYPES[ext].startsWith("image/"));
    }));
}

async function pickFiles({ accept, multiple, directory }, { showDialog, home, readFile = fs.readFile, stat = fs.stat, readDir = fs.readdir }) {
    const extensions = extensionsFor(accept);
    if (!extensions.length) throw new Error("Unsupported upload type.");
    const result = await showDialog({
        title: directory ? "Choose a folder of images" : "Choose files to upload", defaultPath: home,
        filters: directory ? undefined : [{ name: "Supported files", extensions }],
        properties: directory
            ? ["openDirectory", "dontAddToRecent"]
            : ["openFile", "dontAddToRecent", ...(multiple ? ["multiSelections"] : [])],
    });
    if (result.canceled) return { canceled: true, files: [] };
    if (directory) {
        // One folder, its own files only. Never walk into subfolders, so a
        // mis-chosen parent cannot pull in an entire drive.
        const folder = result.filePaths[0];
        const names = await readDir(folder);
        result.filePaths = names
            .filter(name => extensions.includes(path.extname(name).slice(1).toLowerCase()))
            .sort()
            .map(name => path.join(folder, name));
        if (!result.filePaths.length) throw new Error("That folder has no supported images in it.");
    }
    if (result.filePaths.length > 100 || (!multiple && result.filePaths.length > 1)) throw new Error("Select up to 100 files at a time.");
    const files = [];
    let total = 0;
    for (const selected of result.filePaths) {
        const ext = path.extname(selected).slice(1).toLowerCase();
        if (!extensions.includes(ext)) throw new Error("A selected file has an unsupported type.");
        const info = await stat(selected);
        total += info.size;
        if (!info.isFile() || info.size > 100 * 1024 ** 2 || total > 512 * 1024 ** 2) throw new Error("Choose files up to 100 MiB each, and batches up to 512 MiB.");
        const bytes = await readFile(selected);
        if (bytes.length !== info.size) throw new Error("A selected file changed while opening. Please choose it again.");
        files.push({ name: path.basename(selected), type: TYPES[ext], lastModified: info.mtimeMs, bytes });
    }
    return { canceled: false, files };
}

module.exports = { extensionsFor, pickFiles };
