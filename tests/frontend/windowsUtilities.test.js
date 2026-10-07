import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { utilityActions, functionTargets, loadFunctionButtons, saveFunctionButtons } from '../../src/functionButtons';
const { createWindowsUtilities } = createRequire(import.meta.url)('../../electron/windowsUtilities');
const folders = [];
afterEach(() => { vi.unstubAllGlobals(); for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true }); });
function fixture(options = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'law-utility-test-')); folders.push(folder);
  const shell = { openPath: vi.fn(async () => ''), openExternal: vi.fn(async () => {}) };
  const dialog = { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:\\Portable\\SQLite.exe'] })) };
  const input = { file: path.join(folder, 'utilities.json'), shell, dialog, getWindow: () => null,
    platform: 'win32', environment: {}, exists: () => false, ...options };
  return { input, shell, dialog, utility: createWindowsUtilities(input) };
}
describe('Windows utility launchers', () => {
  it('has all screenshot destinations and GodMode available for saved buttons', () => {
    const values = new Map(); vi.stubGlobal('localStorage', { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) });
    expect(utilityActions).toHaveLength(8);
    for (const action of utilityActions) expect(functionTargets).toContainEqual(action);
    saveFunctionButtons(utilityActions.map(action => ({ id: action.id, name: action.name, target: action.id })));
    expect(loadFunctionButtons()).toHaveLength(8);
  });
  it('creating the launcher and choosing an application never opens anything', async () => {
    const { utility, shell, input } = fixture();
    expect(shell.openPath).not.toHaveBeenCalled(); expect(shell.openExternal).not.toHaveBeenCalled();
    await utility.choose('db-browser-sqlite');
    expect(JSON.parse(fs.readFileSync(input.file, 'utf8'))).toEqual({ 'db-browser-sqlite': 'C:\\Portable\\SQLite.exe' });
    expect(shell.openPath).not.toHaveBeenCalled(); expect(shell.openExternal).not.toHaveBeenCalled();
    const reopened = createWindowsUtilities({ ...input, exists: () => true });
    await reopened.open('db-browser-sqlite');
    expect(shell.openPath).toHaveBeenCalledWith('C:\\Portable\\SQLite.exe');
  });
  it('opens fixed Windows locations with no cleanup, registry import or other arguments', async () => {
    const { utility, shell } = fixture();
    for (const id of ['computer-management', 'disk-cleanup', 'registry-editor', 'system-information', 'system-properties']) await utility.open(id);
    expect(shell.openPath.mock.calls).toEqual([
      ['C:\\Windows\\System32\\compmgmt.msc'], ['C:\\Windows\\System32\\cleanmgr.exe'],
      ['C:\\Windows\\regedit.exe'], ['C:\\Windows\\System32\\msinfo32.exe'], ['C:\\Windows\\System32\\sysdm.cpl'],
    ]);
    expect(shell.openExternal).not.toHaveBeenCalled();
  });
  it('opens only the Power Automate console URI without flow or sign-in parameters', async () => {
    const { utility, shell } = fixture(); await utility.open('power-automate');
    expect(shell.openExternal.mock.calls).toEqual([['ms-powerautomate:/console']]);
  });
  it('opens the existing GodMode folder without running an item inside it', async () => {
    const desktopDirectory = 'C:\\User\\Desktop';
    const actualFolder = `${desktopDirectory}\\GodMode.{ED7BA470-8E54-465E-825C-99712043E01C}`;
    const { utility, shell, input } = fixture({ desktopDirectory, exists: file => file === actualFolder });
    await utility.open('godmode');
    expect(shell.openPath.mock.calls).toEqual([[actualFolder]]);
    expect(shell.openExternal).not.toHaveBeenCalled();
    const missing = createWindowsUtilities({ ...input, exists: () => false });
    await expect(missing.open('godmode')).rejects.toThrow('could not be found');
    expect(shell.openPath).toHaveBeenCalledTimes(1);
    const plain = createWindowsUtilities({ ...input, exists: file => file === `${desktopDirectory}\\GodMode` });
    await plain.open('godmode');
    expect(shell.openPath).toHaveBeenLastCalledWith(`${desktopDirectory}\\GodMode`);
  });
  it('finds normal installations and reports missing or moved programs', async () => {
    const { utility, shell, input } = fixture({ exists: file => file.endsWith('DB Browser for SQLite.exe') || file.endsWith('PAD.Console.Host.exe') });
    await utility.open('db-browser-sqlite'); await utility.open('power-automate');
    expect(shell.openPath.mock.calls).toEqual([['C:\\Program Files\\DB Browser for SQLite\\DB Browser for SQLite.exe'], ['C:\\Program Files\\Power Automate Desktop\\dotnet\\PAD.Console.Host.exe']]);
    const missing = createWindowsUtilities({ ...input, exists: () => false });
    await expect(missing.open('db-browser-sqlite')).rejects.toThrow('Choose program');
    await missing.choose('db-browser-sqlite');
    await expect(missing.open('db-browser-sqlite')).rejects.toThrow('has moved');
  });
  it('rejects unknown destinations, unsupported hosts and invalid selected files without launching', async () => {
    const { utility, shell, dialog, input } = fixture();
    for (const value of ['disk-cleanup /sagerun:1', 'registry-editor /s data.reg', '../cmd.exe', {}, null]) await expect(utility.open(value)).rejects.toThrow('Unknown');
    await expect(utility.choose('registry-editor')).rejects.toThrow('fixed');
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\Data\\flow.bat'] });
    await expect(utility.choose('power-automate')).rejects.toThrow('.exe');
    await expect(createWindowsUtilities({ ...input, platform: 'linux' }).open('disk-cleanup')).rejects.toThrow('Windows');
    expect(shell.openPath).not.toHaveBeenCalled(); expect(shell.openExternal).not.toHaveBeenCalled();
  });
  it('propagates launch failures and leaves saved mappings intact on cancel', async () => {
    const { utility, shell, dialog, input } = fixture();
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await utility.choose('db-browser-sqlite')).toBeNull(); expect(fs.existsSync(input.file)).toBe(false);
    shell.openPath.mockResolvedValueOnce('Access denied');
    await expect(utility.open('registry-editor')).rejects.toThrow('Access denied');
    shell.openExternal.mockRejectedValueOnce(new Error('Not installed'));
    await expect(utility.open('power-automate')).rejects.toThrow('Not installed');
  });
});
