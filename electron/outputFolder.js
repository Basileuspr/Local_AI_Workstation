const fs = require("node:fs/promises");

async function chooseOutputFolder({ showDialog, home, stat = fs.stat }) {
    const choice = await showDialog({ title: "Point image output to a folder", defaultPath: home,
        properties: ["openDirectory", "createDirectory", "dontAddToRecent"] });
    if (choice.canceled || !choice.filePaths?.length) return { canceled: true };
    const folder = choice.filePaths[0];
    if (!(await stat(folder)).isDirectory()) throw new Error("Choose an output folder.");
    return { folder };
}

module.exports = { chooseOutputFolder };
