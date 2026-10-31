import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createPhoneTools, registerPhoneToolsIpc } = require('../../desktop/phoneTools.cjs');
let root, options;
const names = { kdeconnect: ['kdeconnect-app.exe', 'kdeconnect-cli.exe', 'kdeconnectd.exe'], scrcpy: ['scrcpy.exe', 'adb.exe', 'scrcpy-server'] };
async function install(id, folder, files = names[id]) {
  await fs.mkdir(folder, { recursive: true });
  for (const name of files) await fs.writeFile(path.join(folder, name), 'fixture, never executable');
  return folder;
}
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'phone-tools-test-'));
  options = { directory: path.join(root, 'profile'), downloads: path.join(root, 'Downloads'), platform: 'win32', env: { LOCALAPPDATA: path.join(root, 'Local') } };
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe('passive phone-tool discovery', () => {
  it('finds per-user KDE Connect and a nested versioned scrcpy release without running binaries or writing settings', async () => {
    const kde = await install('kdeconnect', path.join(options.env.LOCALAPPDATA, 'Programs', 'KDE Connect', 'bin'));
    const scrcpy = await install('scrcpy', path.join(options.downloads, 'scrcpy-win64-v3.3.4', 'scrcpy-win64-v3.3.4'));
    const spawn = vi.spyOn(require('node:child_process'), 'spawn');
    const execFile = vi.spyOn(require('node:child_process'), 'execFile');
    const report = await createPhoneTools(options).status();
    expect(report.tools.kdeconnect).toMatchObject({ status: 'found', directory: kde, missing: [] });
    expect(report.tools.scrcpy).toMatchObject({ status: 'found', directory: scrcpy, selectedDirectory: null });
    expect(spawn).not.toHaveBeenCalled(); expect(execFile).not.toHaveBeenCalled();
    await expect(fs.stat(options.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('prefers the newest complete release and ignores source folders and deeper unrelated files', async () => {
    await install('scrcpy', path.join(options.downloads, 'scrcpy-win64-v4.0'), ['scrcpy.exe']);
    const newest = await install('scrcpy', path.join(options.downloads, 'scrcpy-win64-v3.10'));
    await install('scrcpy', path.join(options.downloads, 'scrcpy-win64-v3.9'));
    await install('scrcpy', path.join(options.downloads, 'scrcpy-master'));
    await install('scrcpy', path.join(options.downloads, 'unrelated', 'private'));
    expect((await createPhoneTools(options).status()).tools.scrcpy.directory).toBe(newest);
  });
  it('detects standard system installs and PATH folders, but ignores relative and network PATH entries', async () => {
    const programFiles = path.join(root, 'Programs'), kde = await install('kdeconnect', path.join(programFiles, 'KDE Connect', 'bin'));
    const scrcpy = await install('scrcpy', path.join(root, 'tools'));
    options.env = { ProgramFiles: programFiles, PATH: ['.', '\\\\example.invalid\\tools', `"${scrcpy}"`].join(path.delimiter) };
    const result = await createPhoneTools(options).status();
    expect(result.tools.kdeconnect.directory).toBe(kde); expect(result.tools.scrcpy.directory).toBe(scrcpy);
  });
  it('reports partial packages and zero-byte executables instead of claiming readiness', async () => {
    const folder = await install('scrcpy', path.join(options.downloads, 'scrcpy-win64-v3.3'), ['scrcpy.exe', 'adb.exe']);
    await fs.writeFile(path.join(folder, 'adb.exe'), '');
    expect((await createPhoneTools(options).status()).tools.scrcpy).toMatchObject({ status: 'incomplete', missing: ['adb.exe', 'scrcpy-server'] });
  });
  it('persists a native folder choice, accepts KDE root/bin, and preserves missing selections until reset', async () => {
    const folder = path.join(root, 'chosen KDE'), kde = await install('kdeconnect', path.join(folder, 'bin'));
    const automatic = await install('kdeconnect', path.join(options.env.LOCALAPPDATA, 'Programs', 'KDE Connect', 'bin'));
    let service = createPhoneTools(options);
    expect((await service.choose('kdeconnect', async () => folder)).tools.kdeconnect.directory).toBe(kde);
    service = createPhoneTools(options);
    expect((await service.status()).tools.kdeconnect.selectedDirectory).toBe(folder);
    await fs.rename(kde, kde + '-moved');
    expect((await service.status()).tools.kdeconnect).toMatchObject({ status: 'missing', directory: folder });
    expect((await service.reset('kdeconnect')).tools.kdeconnect).toMatchObject({ status: 'found', directory: automatic, selectedDirectory: null });
  });
  it('leaves settings unchanged on cancel, serializes changes and rejects invalid tool IDs and network folders', async () => {
    const service = createPhoneTools(options); let resolve;
    const picker = vi.fn(() => new Promise(done => { resolve = done; }));
    const pending = service.choose('scrcpy', picker);
    await vi.waitFor(() => expect(picker).toHaveBeenCalledOnce());
    await expect(service.reset('kdeconnect')).rejects.toThrow(/current/);
    resolve(null); expect(await pending).toEqual({ canceled: true });
    await expect(fs.stat(options.directory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(service.choose('cmd.exe', picker)).rejects.toThrow(/Choose/);
    await expect(service.choose('scrcpy', async () => '\\\\server\\share')).rejects.toThrow(/local/);
    await expect(service.choose('scrcpy', async () => '.')).rejects.toThrow(/local/);
  });
  it('preserves corrupt settings and reports automatic fallback without overwriting them', async () => {
    await fs.mkdir(options.directory); const file = path.join(options.directory, 'phone-tools.json');
    for (const damaged of ['{bad', '{"version":1,"paths":{"arbitrary":"C:/private"}}', '{"version":2,"paths":{}}']) {
      await fs.writeFile(file, damaged);
      const service = createPhoneTools(options);
      expect((await service.status()).warning).toMatch(/kept/);
      await expect(service.reset('scrcpy')).rejects.toThrow(/Repair/);
      expect(await fs.readFile(file, 'utf8')).toBe(damaged);
    }
  });
  it('explains unsupported hosts without opening a picker', async () => {
    const service = createPhoneTools({ ...options, platform: 'linux' }), picker = vi.fn();
    expect(await service.status()).toMatchObject({ supported: false, tools: { scrcpy: { status: 'unsupported' } } });
    await expect(service.choose('scrcpy', picker)).rejects.toThrow(/Windows/); expect(picker).not.toHaveBeenCalled();
  });
  it('guards every IPC handler and sends only tool IDs to a native directory picker', async () => {
    const handlers = {}, dialog = { showOpenDialog: vi.fn().mockResolvedValue({ canceled: true }) };
    const service = createPhoneTools(options), status = vi.spyOn(service, 'status');
    registerPhoneToolsIpc({ ipcMain: { handle: (id, fn) => handlers[id] = fn }, trustedDesktop: event => event.trusted, service, dialog, getWindow: () => null });
    for (const fn of Object.values(handlers)) expect(await fn({}, 'scrcpy')).toHaveProperty('error');
    expect(status).not.toHaveBeenCalled(); expect(dialog.showOpenDialog).not.toHaveBeenCalled();
    expect(await handlers['phone-tools:choose']({ trusted: true }, { path: root })).toHaveProperty('error');
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();
    expect(await handlers['phone-tools:choose']({ trusted: true }, 'scrcpy')).toEqual({ canceled: true });
    expect(dialog.showOpenDialog.mock.calls[0][1].properties).toEqual(['openDirectory']);
  });
});
