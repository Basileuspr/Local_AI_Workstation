import {describe,it,expect} from 'vitest';
import {BoxGeometry,Mesh} from 'three';
import {STLExporter} from 'three/addons/exporters/STLExporter.js';
import {zipSync,strToU8} from 'three/addons/libs/fflate.module.js';
import {prepareSTL,prepare3MF,packModel} from '../../src/modelViewer/parse';
import {inspectZip,validateFile} from '../../src/modelViewer/limits';
import {asZip64} from '../fixtures/zip64.mjs';

const tetra='<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/><vertex x="0" y="0" z="1"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/></triangles></mesh>';
const model=(resources,build='1',unit='millimeter')=>`<model unit="${unit}" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${resources}</resources><build><item objectid="${build}"/></build></model>`;
const archive=(xml,extra={})=>zipSync({'_rels/.rels':strToU8('<Relationships><Relationship Target="/3D/main.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),'3D/main.model':strToU8(xml),...extra}).buffer;

describe('3D file parsing and safeguards',()=>{
  for(const options of [
    {},{sentinels:false},{fields:['unpacked'],footer:false},{fields:['packed'],footer:false},{fields:['offset'],footer:false},
  ])it(`loads small ZIP64 3MF archives ${JSON.stringify(options)}`,()=>{
    const buffer=asZip64(archive(model(`<object id="1">${tetra}</object>`)),options);
    expect(inspectZip(buffer).entries).toBe(2);
    expect(packModel(prepare3MF(buffer).parse(),{}).payload.info.dimensions).toEqual([1,1,1]);
  });
  it('bounds ZIP64 sizes and rejects broken locators and split disks',()=>{
    const source=archive(model(`<object id="1">${tetra}</object>`));
    const missing=asZip64(source),m=new DataView(missing);m.setUint32(missing.byteLength-42,0,true);
    expect(()=>inspectZip(missing)).toThrow(/missing/);
    const split=asZip64(source);new DataView(split).setUint32(split.byteLength-26,2,true);
    expect(()=>inspectZip(split)).toThrow(/Split ZIP64/);
    const huge=asZip64(source),h=new DataView(huge),start=new DataView(source).getUint32(source.byteLength-6,true);
    h.setBigUint64(start+46+h.getUint16(start+28,true)+4,300n*1024n*1024n,true);
    expect(()=>inspectZip(huge)).toThrow(/256 MB/);
    const unsafe=asZip64(source);new DataView(unsafe).setBigUint64(unsafe.byteLength-34,2n**60n,true);
    expect(()=>inspectZip(unsafe)).toThrow(/supported archive size/);
  });
  it('accepts single-disk ZIP64 with all legacy footer fields set to sentinels',()=>{
    const buffer=asZip64(archive(model(`<object id="1">${tetra}</object>`))),v=new DataView(buffer);
    v.setUint16(buffer.byteLength-18,65535,true);v.setUint16(buffer.byteLength-16,65535,true);
    expect(packModel(prepare3MF(buffer).parse(),{}).payload.info.triangles).toBe(4);
  });
  it('reports ordinary directory corruption separately from format support',()=>{
    const buffer=archive(model(`<object id="1">${tetra}</object>`)),v=new DataView(buffer);
    v.setUint32(buffer.byteLength-10,v.getUint32(buffer.byteLength-10,true)-1,true);
    expect(()=>inspectZip(buffer)).toThrow(/archive|ZIP/);
  });
  it('checks the checksum of model parts before parsing XML',()=>{
    const buffer=archive(model(`<object id="1">${tetra}</object>`)),v=new DataView(buffer),start=v.getUint32(buffer.byteLength-6,true);
    v.setUint32(start+16,0,true);
    expect(()=>prepare3MF(buffer)).toThrow(/checksum/);
  });
  for(const binary of [true,false])it(`reads ${binary?'binary':'ASCII'} STL dimensions and triangle count`,()=>{
    const mesh=new Mesh(new BoxGeometry(10,20,30));mesh.updateMatrixWorld();
    const data=new STLExporter().parse(mesh,{binary});
    const prepared=prepareSTL(binary?data.buffer:new TextEncoder().encode(data).buffer);
    const {payload}=packModel(prepared.parse(),{units:prepared.units});
    expect(payload.info.dimensions).toEqual([10,20,30]);expect(payload.info.triangles).toBe(12);
    expect(payload.info.area).toBeCloseTo(2200);expect(prepared.warnings.join()).toContain('no declared units');
  });
  it('retains 3MF units, materials, component hierarchy and transformed instances',()=>{
    const prepared=prepare3MF(archive(model(`<basematerials id="2"><base name="Red" displaycolor="#FF0000"/></basematerials><object id="1" pid="2" pindex="0">${tetra}</object><object id="3"><components><component objectid="1"/><component objectid="1" transform="1 0 0 0 1 0 0 0 1 2 0 0"/></components></object>`,'3','centimeter')));
    expect(prepared.units).toBe('centimeter');expect(prepared.triangles).toBe(8);
    const {payload,transfers}=packModel(prepared.parse(),{});
    expect(payload.info.dimensions).toEqual([3,1,1]);expect(payload.info.meshes).toBe(2);expect(payload.info.triangles).toBe(8);
    expect(Object.values(payload.materials).some(m=>m.color===0xff0000)).toBe(true);
    expect(payload.tree.children[0].children).toHaveLength(2);expect(new Set(transfers).size).toBe(transfers.length);
  });
  it('normalizes duplicate resource IDs and units across model parts',()=>{
    const child=model(`<object id="1">${tetra}</object>`,'1','centimeter');
    const root=model('<object id="1"><components><component objectid="1" p:path="/3D/Objects/child.model" xmlns:p="urn:production"/></components></object>');
    const prepared=prepare3MF(archive(root,{'3D/Objects/child.model':strToU8(child)}));
    expect(packModel(prepared.parse(),{}).payload.info.dimensions).toEqual([10,10,10]);
  });
  it('keeps physical geometry with unsupported materials and extension-only objects',()=>{
    const prepared=prepare3MF(archive(model(`<multiproperties id="2"/><object id="1" pid="2">${tetra}</object><object id="9"><implicitfunction/></object>`)));
    expect(packModel(prepared.parse(),{}).payload.info.triangles).toBe(4);
    expect(prepared.warnings.join()).toContain('neutral shading');
  });
  it('rejects cyclic component references before building geometry',()=>{
    expect(()=>prepare3MF(archive(model('<object id="1"><components><component objectid="1"/></components></object>')))).toThrow(/Cyclic/);
  });
  it('rejects invalid indices and nonfinite coordinates',()=>{
    expect(()=>prepare3MF(archive(model(`<object id="1">${tetra.replace('v1="0"','v1="999"')}</object>`)))).toThrow(/invalid vertex/);
    expect(()=>prepare3MF(archive(model(`<object id="1">${tetra.replace('x="0"','x="Infinity"')}</object>`)))).toThrow(/coordinate/);
  });
  it('rejects archive traversal, excessive expansion and malformed STL',()=>{
    expect(()=>inspectZip(archive(model(`<object id="1">${tetra}</object>`),{'../bad':strToU8('bad')}))).toThrow(/unsafe/);
    const buffer=archive(model(`<object id="1">${tetra}</object>`)),v=new DataView(buffer);
    const start=v.getUint32(buffer.byteLength-6,true);v.setUint32(start+24,300*1024*1024,true);
    expect(()=>inspectZip(buffer)).toThrow(/256 MB/);
    expect(()=>prepareSTL(new TextEncoder().encode('solid bad\nfacet normal 0 0 1\nvertex 1 2 3\nendsolid').buffer)).toThrow(/three vertices/);
  });
  it('requires a supported, nonempty file within the memory limit',()=>{
    expect(()=>validateFile({name:'a.obj',size:1})).toThrow(/STL or 3MF/);
    expect(()=>validateFile({name:'a.stl',size:0})).toThrow(/empty/);
    expect(()=>validateFile({name:'a.3mf',size:600*1024*1024})).toThrow(/512 MB/);
  });
});
