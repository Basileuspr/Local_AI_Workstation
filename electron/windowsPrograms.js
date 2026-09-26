const fs = require("node:fs");
const path = require("node:path");

// Windows execution aliases are reparse points: stat/exists can report them missing.
function entryExists(target) {
    try { fs.lstatSync(target); return true; } catch { return false; }
}

function findWindowsProgram(name, environment = process.env, exists = entryExists) {
    const folders = (environment.Path || environment.PATH || "").split(";").filter(Boolean);
    if (environment.LOCALAPPDATA) folders.push(path.win32.join(environment.LOCALAPPDATA, "Microsoft", "WindowsApps"));
    for (const folder of folders) {
        const target = path.win32.join(folder.replace(/^"|"$/g, ""), name);
        if (exists(target)) return target;
    }
    return null;
}

module.exports = { entryExists, findWindowsProgram };
