import {afterEach, describe, expect, it, vi} from 'vitest';
import {createRequire} from 'node:module';
import {downloadConvertedImage} from '../../src/convertedImages';
import {downloadBlob} from '../../src/downloadBlob';
vi.mock('../../src/downloadBlob',()=>({downloadBlob:vi.fn()}));
const require=createRequire(import.meta.url),{createConvertedImageSaver,convertedFilename}=require('../../electron/convertedImages');
const artifact={id:'a'.repeat(32),name:'test.ico',format:'ico'};
const ico=Buffer.from([0,0,1,0,1,0,16,16,0,0]);
const iconResponse=()=>new Response(ico,{headers:{'content-type':'image/vnd.microsoft.icon','content-disposition':'attachment; filename="test.ico"'}});
afterEach(()=>vi.clearAllMocks());

describe('converted image download',()=>{
  it('confirms desktop saves and distinguishes cancellation and failures',async()=>{
    const saveConvertedImage=vi.fn().mockResolvedValueOnce({saved:true,name:'test.ico'}).mockResolvedValueOnce({canceled:true}).mockResolvedValueOnce({error:'Could not save image.'});
    const env={workstationDesktop:{saveConvertedImage},fetch:vi.fn()};
    expect(await downloadConvertedImage(artifact,env)).toMatchObject({saved:true});expect(saveConvertedImage).toHaveBeenCalledWith(artifact.id);expect(env.fetch).not.toHaveBeenCalled();
    expect(await downloadConvertedImage(artifact,env)).toEqual({canceled:true});await expect(downloadConvertedImage(artifact,env)).rejects.toThrow('Could not save');
  });
  it('fetches an authenticated local artifact for browser download instead of navigating to it',async()=>{
    const env={fetch:vi.fn(async()=>iconResponse())};
    expect(await downloadConvertedImage(artifact,env)).toEqual({started:true});
    expect(env.fetch.mock.calls[0][0]).toContain('/workspaces/converted/'+artifact.id);
    expect(downloadBlob.mock.calls[0][0].type).toBe('application/octet-stream');expect(downloadBlob.mock.calls[0][1]).toBe('test.ico');
    expect(Buffer.from(await downloadBlob.mock.calls[0][0].arrayBuffer())).toEqual(ico);
  });
  it('reports missing and locked artifacts without producing an invalid file',async()=>{
    await expect(downloadConvertedImage(artifact,{fetch:async()=>new Response(JSON.stringify({detail:'Converted file not found.'}),{status:404})})).rejects.toThrow('not found');
    await expect(downloadConvertedImage({...artifact,id:'../private'},{})).rejects.toThrow('unavailable');expect(downloadBlob).not.toHaveBeenCalled();
  });
});

describe('native converted image Save As',()=>{
  it('writes exactly the backend icon bytes only after a chosen save path',async()=>{
    const writeFile=vi.fn(),showDialog=vi.fn(async()=>({filePath:'C:\\scratch\\chosen.ico'})),getResponse=vi.fn(async()=>iconResponse());
    const save=createConvertedImageSaver({getResponse,showDialog,downloads:()=> 'C:\\Downloads',writeFile});
    expect(await save(artifact.id)).toEqual({saved:true,name:'chosen.ico',size:ico.length});
    expect(getResponse).toHaveBeenCalledWith(artifact.id);expect(writeFile).toHaveBeenCalledWith('C:\\scratch\\chosen.ico',ico);
    expect(showDialog.mock.calls[0][0].filters).toEqual([{name:'ICO image',extensions:['ico']}]);
  });
  it('does not write a cancelled save or start arbitrary requests',async()=>{
    const writeFile=vi.fn(),getResponse=vi.fn(async()=>iconResponse());
    const save=createConvertedImageSaver({getResponse,showDialog:async()=>({canceled:true}),downloads:()=> 'C:\\Downloads',writeFile});
    expect(await save(artifact.id)).toEqual({canceled:true});expect(writeFile).not.toHaveBeenCalled();
    await expect(save('https://external.test/private')).rejects.toThrow('valid converted');expect(getResponse).toHaveBeenCalledTimes(1);
  });
  it('blocks missing, locked, non-image and malformed ICO bodies before a save dialog',async()=>{
    const showDialog=vi.fn();
    for(const response of [new Response('{"detail":"Image is locked."}',{status:403}),new Response('html',{headers:{'content-type':'text/html'}}),new Response('bad ico',{headers:{'content-type':'image/vnd.microsoft.icon'}})]){
      const save=createConvertedImageSaver({getResponse:async()=>response,showDialog,downloads:()=> 'C:\\Downloads'});await expect(save(artifact.id)).rejects.toThrow();
    }
    expect(showDialog).not.toHaveBeenCalled();
    expect(convertedFilename("attachment; filename*=UTF-8''%C3%A9xample.ico",'ico')).toBe('éxample.ico');
    expect(convertedFilename('attachment; filename="C:\\private\\CON"','ico')).toBe('converted.ico');
  });
});
