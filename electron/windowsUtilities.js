const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const utilities = require('../src/windowsUtilities.json');
const { findWindowsProgram, entryExists } = require('./windowsPrograms');

// Only these named windows can be opened. No command strings or action arguments.
function createWindowsUtilities({ file, shell, dialog, getWindow, platform = process.platform,
    environment = process.env, exists = entryExists, desktopDirectory = path.win32.join(environment.USERPROFILE || os.homedir(), 'Desktop') }) {
    function utility(id) {
        const value = utilities.find(item => item.id === id);
        if (!value) throw new Error('Unknown Windows utility.');
        if (platform !== 'win32') throw new Error('These utilities require the Windows desktop app.');
        return value;
    }
    function read() {
        if (!fs.existsSync(file)) return {};
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Could not read saved utility programs.');
        return value;
    }
    function target(id) {
        const item = utility(id);
        if (id === 'godmode') {
            const candidates = ['GodMode', 'GodMode.{ED7BA470-8E54-465E-825C-99712043E01C}']
                .map(name => path.win32.join(desktopDirectory, name));
            const found = candidates.find(exists);
            if (!found) throw new Error('The GodMode folder could not be found on your Desktop.');
            return { path: found };
        }
        if (item.configurable) {
            const saved = read()[id];
            if (saved) {
                if (typeof saved !== 'string' || !path.win32.isAbsolute(saved) || !/\.(exe|lnk)$/i.test(saved)) throw new Error('Choose this utility program again.');
                if (!exists(saved)) throw new Error(`${item.name} has moved. Use Choose program to select it again.`);
                return { path: saved };
            }
        }
        const systemRoot = environment.SystemRoot || 'C:\\Windows';
        const system32 = path.win32.join(systemRoot, 'System32');
        const builtins = {
            'computer-management': path.win32.join(system32, 'compmgmt.msc'),
            'disk-cleanup': path.win32.join(system32, 'cleanmgr.exe'),
            'registry-editor': path.win32.join(systemRoot, 'regedit.exe'),
            'system-information': path.win32.join(system32, 'msinfo32.exe'),
            'system-properties': path.win32.join(system32, 'sysdm.cpl'),
        };
        if (builtins[id]) return { path: builtins[id] };
        const programFolders = [environment.ProgramFiles || 'C:\\Program Files', environment['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'];
        if (id === 'db-browser-sqlite') {
            const candidates = programFolders.map(folder => path.win32.join(folder, 'DB Browser for SQLite', 'DB Browser for SQLite.exe'));
            const found = candidates.find(exists) || findWindowsProgram('sqlitebrowser.exe', environment, exists);
            if (found) return { path: found };
            throw new Error('Use Choose program to locate DB Browser for SQLite (.exe or application shortcut).');
        }
        const candidates = programFolders.map(folder => path.win32.join(folder, 'Power Automate Desktop', 'dotnet', 'PAD.Console.Host.exe'));
        const found = candidates.find(exists);
        // Store installations register this console URI. No flow ID, run URL or sign-in parameter.
        return found ? { path: found } : { uri: 'ms-powerautomate:/console' };
    }
    return {
        async open(id) {
            const destination = target(id);
            if (destination.uri) await shell.openExternal(destination.uri);
            else {
                const error = await shell.openPath(destination.path);
                if (error) throw new Error(`Could not open ${utility(id).name}: ${error}`);
            }
            return { ok: true };
        },
        async choose(id) {
            const item = utility(id);
            if (!item.configurable) throw new Error('This utility uses its fixed Windows location.');
            const result = await dialog.showOpenDialog(getWindow(), { title: `Choose ${item.name} application`,
                properties: ['openFile', 'dontAddToRecent'], filters: [{ name: 'Application or application shortcut', extensions: ['exe', 'lnk'] }] });
            if (result.canceled || !result.filePaths.length) return null;
            const selected = result.filePaths[0];
            if (!path.win32.isAbsolute(selected) || !/\.(exe|lnk)$/i.test(selected)) throw new Error('Choose an .exe program or application .lnk shortcut.');
            const records = read();
            records[id] = selected;
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file + '.tmp', JSON.stringify(records), 'utf8');
            fs.renameSync(file + '.tmp', file);
            return { ok: true };
        },
    };
}
module.exports = { createWindowsUtilities };
