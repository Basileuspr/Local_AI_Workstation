const fs = require("fs/promises");

async function openDriveRoot(root, openPath, stat = fs.stat) {
    // Expose only drive roots, never arbitrary files, commands or network URLs.
    if (typeof root !== "string" || !/^[a-z]:[\\/]$/i.test(root)) {
        return { error: "Choose a local drive root, such as C:\\." };
    }
    const target = `${root[0].toUpperCase()}:\\`;
    try {
        if (!(await stat(target)).isDirectory()) {
            return { error: "This drive is not available." };
        }
        const error = await openPath(target);
        return { error: error || null };
    } catch {
        return { error: "Could not open this drive. Check that it is connected and accessible." };
    }
}

module.exports = { openDriveRoot };
