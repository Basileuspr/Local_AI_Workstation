const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function createProgramLaunchers({ file, dialog, shell, getWindow }) {
    function read() {
        if (!fs.existsSync(file)) return [];
        const records = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!Array.isArray(records)) throw new Error("The saved program list could not be read.");
        return records;
    }
    return {
        async choose() {
            const result = await dialog.showOpenDialog(getWindow(), { title: "Choose a program or shortcut", properties: ["openFile"], filters: [{ name: "Windows programs and shortcuts", extensions: ["exe", "lnk"] }] });
            if (result.canceled || !result.filePaths.length) return null;
            const selected = path.resolve(result.filePaths[0]);
            if (!/\.(exe|lnk)$/i.test(selected)) throw new Error("Choose an .exe program or .lnk shortcut.");
            const records = read();
            const existing = records.find(item => item.path === selected);
            if (existing) return { id: existing.id, name: existing.name };
            const record = { id: randomUUID(), name: path.basename(selected), path: selected };
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file + ".tmp", JSON.stringify([...records, record]), "utf8");
            fs.renameSync(file + ".tmp", file);
            return { id: record.id, name: record.name };
        },
        async open(id) {
            if (typeof id !== "string") throw new Error("Invalid program shortcut.");
            const record = read().find(item => item.id === id);
            if (!record) throw new Error("Choose this program again using Edit button.");
            const error = await shell.openPath(record.path);
            if (error) throw new Error(error);
            return { ok: true };
        },
    };
}
module.exports = { createProgramLaunchers };
