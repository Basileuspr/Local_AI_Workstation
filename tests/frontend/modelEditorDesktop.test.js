import {describe,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const require=createRequire(import.meta.url),{editorExport,registerModelEditorIpc}=require('../../electron/modelEditor'),permissions=require('../../electron/audioPermissions');

describe('3D editor desktop file and camera boundaries',()=>{
  it('bounds export types, bytes and names',()=>{
    expect(editorExport({format:'stl',name:'../../mesh.stl',bytes:new Uint8Array([1])}).name).toBe('mesh.stl');
    expect(()=>editorExport({format:'exe',bytes:new Uint8Array([1])})).toThrow(/project or STL/);
    expect(()=>editorExport({format:'stl',bytes:[]})).toThrow(/exports/);
  });
  it('saves only after a native choice and refuses overwrite or untrusted callers',async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'law-3d-save-')),target=path.join(dir,'test.law3d'),handlers={},dialog={showSaveDialog:vi.fn().mockResolvedValue({filePath:target})};
    registerModelEditorIpc({ipcMain:{handle:(key,fn)=>handlers[key]=fn},dialog,getWindow:()=>null,trustedDesktop:event=>event.trusted});
    const data={name:'test',format:'law3d',bytes:new TextEncoder().encode('test project')};
    try{
      expect((await handlers['model-editor:save']({},data)).error).toMatch(/Desktop/);expect(dialog.showSaveDialog).not.toHaveBeenCalled();
      expect((await handlers['model-editor:save']({trusted:true},data)).saved).toBe(true);
      expect((await handlers['model-editor:save']({trusted:true},data)).error).toMatch(/never overwrite/);expect(await fs.readFile(target,'utf8')).toBe('test project');
      dialog.showSaveDialog.mockResolvedValue({canceled:true});expect((await handlers['model-editor:save']({trusted:true},data)).canceled).toBe(true);
    }finally{await fs.rm(dir,{recursive:true,force:true});}
  });
  it('grants only video capture to the trusted requesting main window for 30 seconds',()=>{
    vi.useFakeTimers();const main={getURL:()=> 'app://local/index.html'},request={requestingUrl:'app://local/index.html',mediaTypes:['video'],isMainFrame:true};
    try{
      expect(permissions.allowAudioPermission(main,'media',request,main)).toBe(false);permissions.grantTextureCamera(main);
      expect(permissions.allowAudioPermission(main,'media',request,main)).toBe(true);
      for(const change of [{requestingUrl:'https://example.com'},{mediaTypes:['video','audio']},{isMainFrame:false}])expect(permissions.allowAudioPermission(main,'media',{...request,...change},main)).toBe(false);
      vi.advanceTimersByTime(30001);expect(permissions.allowAudioPermission(main,'media',request,main)).toBe(false);
      permissions.grantTextureCamera(main);permissions.revokeTextureCamera(main);expect(permissions.allowAudioPermission(main,'media',request,main)).toBe(false);
    }finally{vi.useRealTimers();}
  });
  it('does not grant a camera after leaving Paint while a permission dialog was open',async()=>{
    const handlers={},main={getURL:()=> 'app://local/index.html'},event={sender:main};let reply;
    registerModelEditorIpc({ipcMain:{handle:(k,v)=>handlers[k]=v},dialog:{showMessageBox:()=>new Promise(resolve=>reply=resolve)},getWindow:()=>null,trustedDesktop:()=>true});
    const pending=handlers['model-editor:camera-start'](event);await handlers['model-editor:camera-stop'](event);reply({response:1});expect((await pending).allowed).toBe(false);
  });
});
