const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const MAX_FILE_BYTES = 20 * 1024 ** 2;
const BATCH_BYTES = 16 * 1024 ** 2;
const BATCH_FILES = 100;
const validId = value => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);

// Paths stay in the main process. The renderer receives an opaque grant and
// reads one bounded batch at a time, never an entire folder of image bytes.
function createFaceImports({ io = fs } = {}) {
    const grants = new Map();
    return {
        async choose(owner, { directory = false } = {}, { showDialog, home }) {
            if (grants.has(owner)) throw new Error("Finish or stop the current face import first.");
            const result = await showDialog({
                title: directory ? "Choose a folder of images" : "Choose images to scan", defaultPath: home,
                filters: directory ? undefined : [{ name: "Images", extensions: Object.keys(TYPES) }],
                properties: directory ? ["openDirectory", "dontAddToRecent"] : ["openFile", "multiSelections", "dontAddToRecent"],
            });
            if (result.canceled) return { canceled: true };
            let paths = result.filePaths;
            if (directory) {
                const folder = paths[0];
                const entries = await io.readdir(folder, { withFileTypes: true });
                paths = entries.filter(entry => entry.isFile() && TYPES[path.extname(entry.name).slice(1).toLowerCase()])
                    .map(entry => path.join(folder, entry.name)).sort();
            }
            if (!paths?.length) throw new Error("That selection has no supported images in it.");
            const grant = { ticket: randomUUID(), paths, index: 0, busy: false };
            grants.set(owner, grant);
            return { ticket: grant.ticket, total: paths.length };
        },
        async next(owner, ticket) {
            const grant = grants.get(owner);
            if (!grant || grant.ticket !== ticket) throw new Error("Choose the image folder again; its import has closed.");
            if (grant.busy) throw new Error("The previous image batch is still opening.");
            grant.busy = true;
            const files = [], errors = [];
            let bytes = 0, consumed = 0;
            try {
                while (grant.index < grant.paths.length && consumed < BATCH_FILES) {
                    const selected = grant.paths[grant.index];
                    const name = path.win32.basename(selected);
                    try {
                        const type = TYPES[path.extname(selected).slice(1).toLowerCase()];
                        const info = await io.lstat(selected);
                        if (!type || !info.isFile() || info.isSymbolicLink()) throw new Error("Not a supported image file.");
                        if (info.size > MAX_FILE_BYTES) throw new Error("Images must be at most 20 MiB each.");
                        if (files.length && bytes + info.size > BATCH_BYTES) break;
                        // Bound the read even if a file grows after stat. Opening the
                        // file handle also lets us recheck the object actually read.
                        const handle = await io.open(selected, "r");
                        let payload;
                        try {
                            const opened = await handle.stat();
                            if (!opened.isFile() || opened.size !== info.size || opened.mtimeMs !== info.mtimeMs) throw new Error("Image changed while opening; skipped.");
                            payload = Buffer.alloc(info.size + 1);
                            let offset = 0;
                            while (offset < payload.length) {
                                const read = await handle.read(payload, offset, payload.length - offset, offset);
                                if (!read.bytesRead) break;
                                offset += read.bytesRead;
                            }
                            if (offset !== info.size) throw new Error("Image changed while opening; skipped.");
                            payload = payload.subarray(0, offset);
                        } finally { await handle.close(); }
                        bytes += payload.length;
                        files.push({ name, type, lastModified: info.mtimeMs, bytes: payload });
                    } catch (error) { errors.push({ source: name, error: error.code ? "Could not read this image." : error.message }); }
                    grant.index++; consumed++;
                    if (grants.get(owner) !== grant) return { canceled: true, files: [], errors: [], consumed: 0, done: true };
                }
                return { files, errors, consumed, done: grant.index === grant.paths.length };
            } finally { grant.busy = false; }
        },
        release(owner, ticket) {
            const grant = grants.get(owner);
            if (grant && (!ticket || grant.ticket === ticket)) grants.delete(owner);
            return { released: true };
        },
    };
}

async function saveFaceFolder({ datasetId, faceIds }, { showDialog, home, request, io = fs }) {
    if (!validId(datasetId) || !Array.isArray(faceIds) || !faceIds.length || faceIds.length > 20000 || !faceIds.every(validId)) {
        throw new Error("Choose faces from a saved dataset first.");
    }
    const ids = [...new Set(faceIds)];
    const dataset = await (await request(`/faces/datasets/${datasetId}`)).json();
    const known = new Set((dataset.faces || []).map(face => face.id));
    if (ids.some(id => !known.has(id))) throw new Error("Some selected faces are no longer in this dataset. Reload it and try again.");
    const choice = await showDialog({ title: `Save ${ids.length} face crops — choose a parent folder`, defaultPath: home,
        properties: ["openDirectory", "createDirectory", "dontAddToRecent"] });
    if (choice.canceled) return { canceled: true };
    const parent = await io.realpath(choice.filePaths[0]);
    if (!(await io.stat(parent)).isDirectory()) throw new Error("Choose a destination folder.");
    // A fresh child folder keeps unrelated files and previous exports intact.
    const name = String(dataset.name || "Faces").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[ .]+$/g, "").slice(0, 60) || "Faces";
    const folder = await io.mkdtemp(path.join(parent, `Faces-${name}-`));
    const errors = [];
    let saved = 0;
    for (const [index, id] of ids.entries()) {
        let temporary;
        try {
            const response = await request(`/faces/datasets/${datasetId}/faces/${id}/crop`);
            const bytes = Buffer.from(await response.arrayBuffer());
            if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Face crop was not a PNG image.");
            const pending = path.join(folder, `.pending-${randomUUID()}`);
            const handle = await io.open(pending, "wx");
            temporary = pending;
            try { await handle.writeFile(bytes); }
            finally { await handle.close(); }
            await io.rename(pending, path.join(folder, `face-${String(index + 1).padStart(5, "0")}-${id}.png`));
            temporary = null;
            saved++;
        } catch (error) {
            if (temporary) await io.unlink(temporary).catch(() => {});
            errors.push({ face_id: id, error: error.code ? "Could not write this face crop." : error.message });
            // Stop on filesystem failures (e.g. full disk); retain completed copies.
            if (error.code) break;
        }
    }
    return { folder, saved, total: ids.length, errors };
}

module.exports = { createFaceImports, saveFaceFolder, BATCH_BYTES, BATCH_FILES, MAX_FILE_BYTES };
