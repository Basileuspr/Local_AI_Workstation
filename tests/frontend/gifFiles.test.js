import {afterEach, describe, expect, it, vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const {createGifFiles} = createRequire(import.meta.url)('../../electron/gifFiles');
const data = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const directories = [];
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, {recursive:true, force:true}); });
async function setup(result = null) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'law-gif-test-'));
  directories.push(directory);
  const target = path.join(directory, 'animation.gif');
  const showSaveDialog = vi.fn().mockResolvedValue(result || {filePath:target,canceled:false});
  const showItemInFolder = vi.fn();
  const showOpenDialog = vi.fn().mockResolvedValue({canceled:false,filePaths:[directory]});
  return {directory, target, showSaveDialog, showOpenDialog, showItemInFolder, service:createGifFiles({showSaveDialog, showOpenDialog, showItemInFolder, downloads:()=>directory})};
}
describe('desktop GIF file location', () => {
  it('uses a registered library folder and preserves earlier exports', async () => {
    const {service,directory,target,showSaveDialog,showOpenDialog} = await setup();
    await fs.writeFile(target, 'existing export');
    const choice = await service.useLibrary(directory);
    const saved = await service.save({bytes:data,name:'animation.gif',folderId:choice.id});
    expect(path.dirname(saved.path)).toBe(directory);
    expect(await fs.readFile(saved.path)).toEqual(data);
    expect(await fs.readFile(target,'utf8')).toBe('existing export');
    expect(showSaveDialog).not.toHaveBeenCalled();
    expect(showOpenDialog).not.toHaveBeenCalled();
    await expect(service.useLibrary(path.join(directory,'missing'))).rejects.toThrow();
  });
  it('saves exact bytes and reveals only the confirmed saved file', async () => {
    const {service,target,directory,showItemInFolder} = await setup();
    await fs.writeFile(target, 'old file');
    const result = await service.save({bytes:new Uint8Array(data),name:'animation.gif'});
    expect(result.path).toBe(target);
    expect(await fs.readFile(target)).toEqual(data);
    expect(await fs.readdir(directory)).toEqual(['animation.gif']);
    expect(await service.reveal(result.id)).toEqual({ok:true});
    expect(showItemInFolder).toHaveBeenCalledWith(target);
    expect(await service.reveal(target)).toHaveProperty('error');
    expect(showItemInFolder).toHaveBeenCalledTimes(1);
    await fs.unlink(target);
    expect((await service.reveal(result.id)).error).toContain('moved or deleted');
  });
  it('leaves files alone when saving is canceled', async () => {
    const {service,directory,showItemInFolder} = await setup({canceled:true});
    expect(await service.save({bytes:data,name:'animation.gif'})).toEqual({canceled:true});
    expect(await fs.readdir(directory)).toEqual([]);
    expect(showItemInFolder).not.toHaveBeenCalled();
  });
  it('rejects invalid data before opening a dialog and never writes another file type', async () => {
    const {service,directory,showSaveDialog} = await setup();
    expect(await service.save({bytes:Buffer.from('not GIF')})).toHaveProperty('error');
    expect(showSaveDialog).not.toHaveBeenCalled();
    showSaveDialog.mockResolvedValue({filePath:path.join(directory,'other.exe')});
    expect((await service.save({bytes:data})).error).toContain('.gif extension');
    expect(await fs.readdir(directory)).toEqual([]);
  });
  it('points output to a selected folder, saves without another dialog and preserves existing GIFs', async()=>{
    const {service,directory,target,showSaveDialog,showOpenDialog,showItemInFolder}=await setup();
    await fs.writeFile(target,'existing export');
    const choice=await service.chooseOutput();
    expect(choice.folder).toBe(directory);
    expect(showOpenDialog.mock.calls[0][0].properties).toEqual(['openDirectory','createDirectory','dontAddToRecent']);
    const first=await service.save({bytes:data,name:'animation.gif',folderId:choice.id});
    const second=await service.save({bytes:data,name:'animation.gif',folderId:choice.id});
    expect(await fs.readFile(target,'utf8')).toBe('existing export');
    expect(path.basename(first.path)).toBe('animation (2).gif');
    expect(path.basename(second.path)).toBe('animation (3).gif');
    expect(await fs.readFile(first.path)).toEqual(data);
    expect(showSaveDialog).not.toHaveBeenCalled();
    expect(await service.reveal(first.id)).toEqual({ok:true});
    expect(showItemInFolder).toHaveBeenCalledWith(first.path);
  });
  it('rejects arbitrary or unavailable folders and preserves picker cancellation', async()=>{
    const {service,directory,showOpenDialog,showSaveDialog}=await setup();
    expect(await service.save({bytes:data,folderId:directory})).toHaveProperty('error');
    showOpenDialog.mockResolvedValueOnce({canceled:true,filePaths:[]});
    expect(await service.chooseOutput()).toEqual({canceled:true});
    const choice=await service.chooseOutput();
    await fs.rmdir(directory);
    expect(await service.save({bytes:data,folderId:choice.id})).toHaveProperty('error');
    expect(showSaveDialog).not.toHaveBeenCalled();
  });
  it('keeps selected-folder filenames safe and supports returning to manual Save GIF', async()=>{
    const {service,directory,target,showSaveDialog}=await setup();
    const choice=await service.chooseOutput();
    const result=await service.save({bytes:data,name:'../CON.gif',folderId:choice.id});
    expect(path.dirname(result.path)).toBe(directory);
    expect(path.basename(result.path)).toBe('_CON.gif');
    expect((await service.save({bytes:data,name:'animation.gif'})).path).toBe(target);
    expect(showSaveDialog).toHaveBeenCalledTimes(1);
  });
});
