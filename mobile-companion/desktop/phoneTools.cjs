// Passive desktop discovery. Never execute tools, contact a device or start ADB.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const TOOL_FILES = Object.freeze({
  kdeconnect: ['kdeconnect-app.exe', 'kdeconnect-cli.exe', 'kdeconnectd.exe'],
  scrcpy: ['scrcpy.exe', 'adb.exe', 'scrcpy-server'],
});
const localDirectory = value => typeof value === 'string' && value.length < 4096 && path.isAbsolute(value)
  && !value.startsWith('\\\\') && !value.startsWith('//') && !value.includes('\0');
const toolId = id => { if (!Object.hasOwn(TOOL_FILES, id)) throw Error('Choose KDE Connect or scrcpy.'); return id; };
const absent = error => ['ENOENT', 'ENOTDIR'].includes(error.code);

async function inspectDirectory(id, directory, source, selectedDirectory = null) {
  const files = await Promise.all(TOOL_FILES[id].map(async name => {
    try { const stat = await fs.stat(path.join(directory, name)); return stat.isFile() && stat.size > 0; }
    catch (error) { if (absent(error)) return false; throw error; }
  }));
  return { id, directory, source, selectedDirectory, status: files.every(Boolean) ? 'found' : files.some(Boolean) ? 'incomplete' : 'missing',
    missing: TOOL_FILES[id].filter((_, index) => !files[index]) };
}

// Only named release folders, at most two levels deep; never recursively scan a drive.
async function releaseDirectories(root) {
  if (!localDirectory(root)) return [];
  const result = [];
  async function children(directory) {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      return entries.filter(item => item.isDirectory() && /^scrcpy(?:-win(?:32|64))?(?:-v?\d[\w.-]*)?$/i.test(item.name))
        .map(item => item.name).sort((a, b) => b.localeCompare(a, 'en', { numeric: true })).slice(0, 32);
    } catch (error) { if (absent(error) || error.code === 'EACCES' || error.code === 'EPERM') return []; throw error; }
  }
  for (const name of await children(root)) {
    const directory = path.join(root, name);
    result.push(directory);
    for (const nested of await children(directory)) result.push(path.join(directory, nested));
  }
  return result;
}

function createPhoneTools({ directory, downloads, env = process.env, platform = process.platform }) {
  const configPath = path.join(directory, 'phone-tools.json');
  let editing = false;
  async function settings() {
    try {
      if ((await fs.stat(configPath)).size > 16384) throw Error('oversized');
      const value = JSON.parse(await fs.readFile(configPath, 'utf8'));
      if (!value || value.version !== 1 || !value.paths || typeof value.paths !== 'object' || Array.isArray(value.paths)
        || Object.entries(value.paths).some(([id, folder]) => !Object.hasOwn(TOOL_FILES, id) || !localDirectory(folder))) throw Error('invalid');
      return { paths: value.paths, warning: null };
    } catch (error) {
      if (error.code === 'ENOENT') return { paths: {}, warning: null };
      return { paths: {}, warning: 'Saved phone-tool locations could not be read. Automatic results are shown; existing settings have been kept.' };
    }
  }
  async function candidates(id, selected) {
    if (selected) return [selected, ...(id === 'kdeconnect' ? [path.join(selected, 'bin')] : await releaseDirectories(selected))];
    const roots = id === 'kdeconnect'
      ? [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'KDE Connect'),
        env.ProgramFiles && path.join(env.ProgramFiles, 'KDE Connect'), env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'KDE Connect')]
        .filter(localDirectory).flatMap(folder => [path.join(folder, 'bin'), folder])
      : [...await releaseDirectories(downloads), ...(localDirectory(downloads) ? [downloads] : [])];
    const searchPath = (env.PATH || env.Path || '').split(path.delimiter).map(item => item.replace(/^"|"$/g, '')).filter(localDirectory).slice(0, 128);
    return [...new Set([...roots, ...searchPath])];
  }
  async function detect(id, selected) {
    if (platform !== 'win32') return { id, status: 'unsupported', directory: null, selectedDirectory: selected || null, missing: [] };
    let partial, unreadable = false;
    for (const folder of await candidates(id, selected)) {
      let result;
      try { result = await inspectDirectory(id, folder, selected ? 'selected' : 'automatic', selected || null); }
      catch { unreadable = true; continue; }
      if (result.status === 'found') return result;
      if (result.status === 'incomplete' && (!partial || result.missing.length < partial.missing.length)) partial = result;
    }
    return { ...(partial || { id, status: 'missing', directory: selected || null, source: selected ? 'selected' : 'automatic',
      selectedDirectory: selected || null, missing: TOOL_FILES[id] }),
      ...(unreadable ? { warning: 'Some locations could not be read. Choose an accessible installation folder.' } : {}) };
  }
  async function status() {
    const saved = await settings();
    return { supported: platform === 'win32', checkedAt: new Date().toISOString(), warning: saved.warning,
      tools: Object.fromEntries(await Promise.all(Object.keys(TOOL_FILES).map(async id => [id, await detect(id, saved.paths[id])]))) };
  }
  async function edit(id, picker) {
    toolId(id);
    if (platform !== 'win32') throw Error('Phone-tool detection requires Windows.');
    if (editing) throw Error('Finish the current phone-tool folder selection first.');
    editing = true;
    let temporary;
    try {
      const saved = await settings();
      if (saved.warning) throw Error('Saved phone-tool locations could not be read. Repair phone-tools.json in the app profile before changing locations.');
      const selected = picker ? await picker() : null;
      if (picker && !selected) return { canceled: true };
      if (selected && !localDirectory(selected)) throw Error('Choose a local installation folder.');
      const paths = { ...saved.paths };
      if (selected) paths[id] = path.resolve(selected); else delete paths[id];
      await fs.mkdir(directory, { recursive: true });
      temporary = configPath + '.' + randomUUID() + '.tmp';
      await fs.writeFile(temporary, JSON.stringify({ version: 1, paths }, null, 2) + '\n', { flag: 'wx' });
      await fs.rename(temporary, configPath);
      return await status();
    } finally { if (temporary) await fs.rm(temporary, { force: true }).catch(() => {}); editing = false; }
  }
  return { status, choose: (id, picker) => edit(id, picker), reset: id => edit(id, null) };
}

function registerPhoneToolsIpc({ ipcMain, trustedDesktop, service, dialog, getWindow }) {
  const handle = (name, fn) => ipcMain.handle(name, async (event, id) => {
    if (!trustedDesktop(event)) return { error: 'Phone-tool detection requires the trusted desktop window.' };
    try { return await fn(id); } catch (error) { return { error: error.message || 'Phone-tool detection failed.' }; }
  });
  handle('phone-tools:status', () => service.status());
  handle('phone-tools:choose', id => service.choose(toolId(id), async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: id === 'kdeconnect' ? 'Choose the KDE Connect installation folder' : 'Choose the extracted scrcpy release folder',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths?.[0];
  }));
  handle('phone-tools:reset', id => service.reset(toolId(id)));
}
module.exports = { createPhoneTools, registerPhoneToolsIpc };
