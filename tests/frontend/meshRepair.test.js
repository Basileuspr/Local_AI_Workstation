import {describe,it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {BoxGeometry,Mesh} from 'three';
import {STLExporter} from 'three/addons/exporters/STLExporter.js';
import {zipSync,strToU8} from 'three/addons/libs/fflate.module.js';
import {makeRepairPackage,repairedSTL} from '../../src/modelViewer/repair';
import {prepareSTL,prepare3MF,packModel} from '../../src/modelViewer/parse';
import native from '../../electron/meshRepair';

const bufferOf=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const tetra='<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/>CLOSE</triangles></mesh>';
const model=(broken=false,unit='millimeter',build='<item objectid="1"/>')=>`<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="${unit}"><resources><object id="1" type="model">${tetra.replace('CLOSE',broken?'':'<triangle v1="1" v2="2" v3="3"/>')}</object></resources><build>${build}</build></model>`;
const archive=xml=>zipSync({
  '[Content_Types].xml':strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),
  '_rels/.rels':strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="model" Target="/3D/model.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
  '3D/model.model':strToU8(xml),
});
const summary={type:'complete',before:{triangles:3,invalidMeshes:1},after:{triangles:4,invalidMeshes:0}};
function worker(run){return (_exe,args,options)=>{
  expect(options.windowsHide).toBe(true);expect(options.shell).toBe(false);
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=vi.fn(()=>queueMicrotask(()=>child.emit('close',null)));
  queueMicrotask(()=>run(child,args));return child;
};}
async function scratch(task){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'law-repair-test-'));try{return await task(directory);}finally{
  if(path.dirname(path.resolve(directory))!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('law-repair-test-'))throw Error('Unsafe test cleanup');
  await fs.rm(directory,{recursive:true,force:true,maxRetries:3});
}}
const completion=worker(async(child,args)=>{
  await fs.copyFile(args[args.indexOf('-InputPath')+1],args[args.indexOf('-OutputPath')+1]);
  child.stdout.write(JSON.stringify(summary)+'\n');child.emit('close',0);
});

describe('Model repair formats and desktop boundaries',()=>{
  for(const binary of [true,false])it(`converts ${binary?'binary':'ASCII'} STL without changing dimensions or input`,()=>{
    const mesh=new Mesh(new BoxGeometry(10,20,30));mesh.updateMatrixWorld();
    const stl=new STLExporter().parse(mesh,{binary});
    const buffer=binary?stl.buffer:new TextEncoder().encode(stl).buffer,original=hash(new Uint8Array(buffer));
    const bytes=makeRepairPackage(buffer,'stl');
    const payload=packModel(prepare3MF(bufferOf(bytes)).parse(),{}).payload;
    expect(payload.info.dimensions).toEqual([10,20,30]);expect(payload.info.triangles).toBe(12);
    expect(hash(new Uint8Array(buffer))).toBe(original);
  });
  it('preserves original 3MF bytes instead of repairing the simplified preview',()=>{
    const source=archive(model());expect(makeRepairPackage(bufferOf(source),'3mf')).toEqual(source);
    expect(()=>makeRepairPackage(new ArrayBuffer(4),'exe')).toThrow('STL or 3MF');
  });
  it('exports transformed 3MF instances in millimeters for STL',()=>{
    const bytes=archive(model(false,'centimeter','<item objectid="1"/><item objectid="1" transform="1 0 0 0 1 0 0 0 1 20 0 0"/>'));
    const stl=repairedSTL(bufferOf(bytes)),info=packModel(prepareSTL(bufferOf(stl)).parse(),{}).payload.info;
    expect(info.dimensions).toEqual([300,100,100]);expect(info.triangles).toBe(8);
  });
  it('rejects untrusted IPC before dispatching native work',async()=>{
    const handlers=new Map(),service={run:vi.fn()};
    native.registerMeshRepairIpc({ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},service,trustedDesktop:event=>event.trusted});
    expect(await handlers.get('mesh-repair:run')({trusted:false},{})).toHaveProperty('error');expect(service.run).not.toHaveBeenCalled();
    await handlers.get('mesh-repair:run')({trusted:true},{id:'test'});expect(service.run).toHaveBeenCalledOnce();
  });
  it('requires actual bytes and a valid ID, never an arbitrary filesystem path',()=>{
    const host=native.createMeshRepair({platform:'win32'});
    expect(()=>host.run({id:randomUUID(),path:'C:\\private.stl'})).toThrow('bytes');
    expect(()=>host.run({id:'../../outside',bytes:archive(model())})).toThrow('request');
    expect(()=>host.run({id:randomUUID(),bytes:new Uint8Array([1,2,3,4])})).toThrow('3MF');
  });
  it('cancels before native launch and cleans only its own temporary folder',()=>scratch(async directory=>{
    const start=vi.fn(),host=native.createMeshRepair({tempRoot:directory,platform:'win32',startProcess:start});
    await fs.writeFile(path.join(directory,'keep.txt'),'preserve');
    const id=randomUUID(),pending=host.run({id,bytes:archive(model())});host.cancel(id);
    expect(await pending).toEqual({cancelled:true});expect(start).not.toHaveBeenCalled();
    expect(await fs.readdir(directory)).toEqual(['keep.txt']);await host.dispose();
  }));
  it('stops a running native process and rejects simultaneous repairs',()=>scratch(async directory=>{
    let child;const host=native.createMeshRepair({tempRoot:directory,platform:'win32',startProcess:worker(value=>{child=value;})});
    const id=randomUUID(),pending=host.run({id,bytes:archive(model())});
    await vi.waitFor(()=>expect(child).toBeTruthy());
    expect(()=>host.run({id:randomUUID(),bytes:archive(model())})).toThrow('Another');
    host.cancel(randomUUID());expect(child.kill).not.toHaveBeenCalled();
    host.cancel(id);expect(await pending).toEqual({cancelled:true});expect(child.kill).toHaveBeenCalledOnce();
    expect(await fs.readdir(directory)).toEqual([]);await host.dispose();
  }));
  it('retains results after a cancelled save and never overwrites an existing file',()=>scratch(async directory=>{
    const existing=path.join(directory,'original.3mf'),target=path.join(directory,'fixed.3mf');await fs.writeFile(existing,'original');
    const dialog={showSaveDialog:vi.fn().mockResolvedValueOnce({canceled:true}).mockResolvedValueOnce({filePath:existing}).mockResolvedValueOnce({filePath:target})};
    const host=native.createMeshRepair({tempRoot:directory,dialog,platform:'win32',startProcess:completion});
    const id=randomUUID(),bytes=archive(model());expect((await host.run({id,bytes})).bytes).toEqual(Buffer.from(bytes));
    expect(await host.save({id,format:'3mf'})).toEqual({cancelled:true});
    await expect(host.save({id,format:'3mf'})).rejects.toThrow('never overwrites');expect(await fs.readFile(existing,'utf8')).toBe('original');
    expect(await host.save({id,format:'3mf'})).toHaveProperty('saved',true);expect(await fs.readFile(target)).toEqual(Buffer.from(bytes));
    host.release(id);await expect(host.save({id,format:'3mf'})).rejects.toThrow('again');await host.dispose();
  }));
  it('times out a stuck native worker without producing a result',()=>scratch(async directory=>{
    const host=native.createMeshRepair({tempRoot:directory,platform:'win32',startProcess:worker(()=>{}),timeoutMs:25});
    await expect(host.run({id:randomUUID(),bytes:archive(model())})).rejects.toThrow('exceeded');
    expect(await fs.readdir(directory)).toEqual([]);await host.dispose();
  }));
});

describe.runIf(process.platform==='win32'&&process.env.LAW_TEST_WINDOWS_REPAIR==='1')('Real Windows Printing3D engine',()=>{
  it('repairs an open mesh, verifies it, preserves its source, and exports printable geometry',()=>scratch(async directory=>{
    const host=native.createMeshRepair({tempRoot:directory}),bytes=archive(model(true)),original=hash(bytes);
    try {
      const result=await host.run({id:randomUUID(),bytes});
      expect(result.summary.before.invalidMeshes).toBeGreaterThan(0);expect(result.summary.after.invalidMeshes).toBe(0);
      expect(result.summary.engine).toContain('RepairAsync');expect(hash(bytes)).toBe(original);
      const stl=repairedSTL(bufferOf(result.bytes));const object=prepareSTL(bufferOf(stl)).parse();
      const p=object.geometry.getAttribute('position'),edges=new Map();
      for(let i=0;i<p.count;i+=3){const v=[0,1,2].map(j=>`${p.getX(i+j)},${p.getY(i+j)},${p.getZ(i+j)}`);
        for(let j=0;j<3;j++){const key=[v[j],v[(j+1)%3]].sort().join('|');edges.set(key,(edges.get(key)||0)+1);}}
      expect(edges.size).toBeGreaterThan(0);expect([...edges.values()].every(count=>count===2)).toBe(true);
      expect(packModel(object,{}).payload.info.dimensions.every(value=>value>0&&value<11)).toBe(true);
      expect(await fs.readdir(directory)).toEqual([]);
    } finally {await host.dispose();}
  }),30000);
  it('preserves declared units and transforms on a healthy assembly',()=>scratch(async directory=>{
    const host=native.createMeshRepair({tempRoot:directory});
    try {
      const input=archive(model(false,'centimeter','<item objectid="1"/><item objectid="1" transform="1 0 0 0 1 0 0 0 1 20 0 0"/>'));
      const result=await host.run({id:randomUUID(),bytes:input});
      expect(result.summary.after.invalidMeshes).toBe(0);
      const prepared=prepare3MF(bufferOf(result.bytes));expect(prepared.units).toBe('centimeter');
      const dimensions=packModel(prepared.parse(),{}).payload.info.dimensions;
      [30,10,10].forEach((expected,index)=>expect(dimensions[index]).toBeCloseTo(expected,2));
    } finally {await host.dispose();}
  }),30000);
  it('rejects external resource references before invoking native repair',()=>scratch(async directory=>{
    const host=native.createMeshRepair({tempRoot:directory});
    try {
      const bytes=zipSync({'_rels/.rels':strToU8('<Relationships><Relationship Target="https://example.invalid/model" TargetMode="External"/></Relationships>')});
      await expect(host.run({id:randomUUID(),bytes})).rejects.toThrow('External');
      expect(await fs.readdir(directory)).toEqual([]);
    } finally {await host.dispose();}
  }),30000);
});
