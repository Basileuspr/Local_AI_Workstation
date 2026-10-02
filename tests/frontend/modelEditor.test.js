import {describe,it,expect} from 'vitest';
import {Matrix4,Vector3} from 'three';
import {appendHistory,bounds,duplicateObjects,emptyDocument,ensureUV,importPayload,mirrorObjects,parseProject,PRIMITIVES,primitive,serializeProject,settleObjects,statistics,transformObject,transformValues,translateObject} from '../../src/modelViewer/editor';
import {geometryOperation} from '../../src/modelViewer/operations';
import {exportSTL} from '../../src/modelViewer/export';
import {packModel,prepareSTL} from '../../src/modelViewer/parse';

const doc=objects=>({...emptyDocument(),objects});
function volume(objects){let result=0;const a=new Vector3(),b=new Vector3(),c=new Vector3();for(const o of objects){const p=o.geometry.attributes.position.array,idx=o.geometry.index,m=new Matrix4().fromArray(o.matrix),n=idx?.length||p.length/3;for(let i=0;i<n;i+=3){a.fromArray(p,3*(idx?idx[i]:i)).applyMatrix4(m);b.fromArray(p,3*(idx?idx[i+1]:i+1)).applyMatrix4(m);c.fromArray(p,3*(idx?idx[i+2]:i+2)).applyMatrix4(m);result+=a.dot(b.cross(c))/6;}}return Math.abs(result);}
describe('3D editor geometry and project integrity',()=>{
  for(const name of PRIMITIVES)it(`${name} has requested dimensions and forms a closed editable solid`,async()=>{
    const object=primitive(name,[20,30,40]),info=statistics([object]);info.dimensions.forEach((n,i)=>expect(n).toBeCloseTo([20,30,40][i],4));
    expect(info.bounds.min[2]).toBeCloseTo(0,4);expect(info.area).toBeGreaterThan(0);
    const result=await geometryOperation('simplify',[object],{tolerance:.0001});expect(volume(result)).toBeGreaterThan(0);
  });
  it('duplicates, mirrors and settles without mutating shared geometry',()=>{
    const cube=primitive('Cube'),before=serializeProject(doc([cube])),duplicate=duplicateObjects([cube])[0];
    expect(duplicate.id).not.toBe(cube.id);expect(duplicate.geometry).toBe(cube.geometry);
    const shifted=translateObject(cube,[0,0,12]),settled=settleObjects([shifted])[0];expect(bounds([settled]).min.z).toBeCloseTo(0);
    expect(volume(mirrorObjects([cube],0))).toBeCloseTo(8000);expect(serializeProject(doc([cube]))).toBe(before);
    expect(transformValues(transformObject(cube,{position:[4,5,6],rotation:[0,0,90],scale:[2,1,1]})).position).toEqual([4,5,6]);
  });
  for(const [action,expected] of [['merge',12000],['intersect',4000],['subtract',4000]])it(`${action} computes the expected solid volume and preserves materials`,async()=>{
    const a=primitive('Cube'),b={...translateObject(primitive('Cube'),[10,0,0]),materials:[{color:'#ff0000',opacity:1,metalness:0,roughness:1}]};
    const result=await geometryOperation(action,[a,b]);expect(volume(result)).toBeCloseTo(expected,2);expect(result[0].materials.some(m=>m.color==='#ff0000')).toBe(true);
  });
  it('corrects reflected winding before solid operations',async()=>{const reflected=mirrorObjects([primitive('Cube')],0);const halves=await geometryOperation('split',reflected,{axis:2,offset:10});expect(halves).toHaveLength(2);expect(volume(halves)).toBeCloseTo(8000);});
  it('splits into closed halves and rejects a plane outside the object',async()=>{
    const cube=primitive('Cube'),halves=await geometryOperation('split',[cube],{axis:2,offset:10});
    for(const h of halves)expect(statistics([h]).dimensions[2]).toBeCloseTo(10);expect(volume(halves)).toBeCloseTo(8000);
    await expect(geometryOperation('split',[cube],{axis:2,offset:99})).rejects.toThrow(/pass through/);
  });
  it('hollows a cube with the requested wall thickness',async()=>{const result=await geometryOperation('hollow',[primitive('Cube')],{thickness:2});expect(volume(result)).toBeCloseTo(8000-16**3,1);expect(statistics(result).dimensions).toEqual([20,20,20]);});
  it('extends a footprint below the base and adds real embossed text',async()=>{
    const cube=primitive('Cube'),extended=await geometryOperation('extrude',[cube],{depth:3});expect(bounds(extended).min.z).toBeCloseTo(-3);expect(volume(extended)).toBeCloseTo(9200,1);
    const embossed=await geometryOperation('emboss',[cube],{text:'A',size:5,depth:2});expect(bounds(embossed).max.z).toBeCloseTo(21.6,3);expect(volume(embossed)).toBeGreaterThan(8000);
  });
  it('simplifies detail and smooths geometry, not just shading',async()=>{
    const sphere=primitive('Sphere'),simplified=await geometryOperation('simplify',[sphere],{tolerance:.3});expect(statistics(simplified).triangles).toBeLessThan(statistics([sphere]).triangles);
    const smooth=await geometryOperation('smooth',[primitive('Cube')]);expect(statistics(smooth).triangles).toBeGreaterThan(12);expect(volume(smooth)).not.toBeCloseTo(8000);
  });
  it('rejects open meshes and empty intersections without changing the originals',async()=>{
    const cube=primitive('Cube'),open={...cube,geometry:{...cube.geometry,index:cube.geometry.index.slice(3)}};
    await expect(geometryOperation('simplify',[open],{tolerance:.1})).rejects.toThrow(/closed|manifold/i);
    await expect(geometryOperation('intersect',[cube,translateObject(primitive('Cube'),[50,0,0])])).rejects.toThrow(/no geometry/);
  });
  it('round-trips editable projects including UVs and embedded textures, with no external fetches',()=>{
    const cube=primitive('Cube');cube.materials[0].mapData='data:image/png;base64,AAAA';const restored=parseProject(serializeProject(doc([cube])));
    expect(restored.objects[0].geometry.attributes.position.array).toBeInstanceOf(Float32Array);expect(restored.objects[0].materials[0].mapData).toContain('data:image');expect(statistics(restored.objects)).toEqual(statistics([cube]));
    cube.materials[0].mapData='https://example.com/private.png';expect(()=>serializeProject(doc([cube]))).toThrow(/embedded local/);
    const malformed=JSON.parse(serializeProject(doc([primitive('Cube')])));malformed.document.objects[0].geometry.index[0]=999999;expect(()=>parseProject(JSON.stringify(malformed))).toThrow(/indices/);
  });
  it('exports transformed and reflected STL in physical millimeters',()=>{
    const model={...doc(mirrorObjects([primitive('Cube',[2,3,4])],0)),units:'centimeter'},bytes=exportSTL(model),loaded=packModel(prepareSTL(bytes.buffer).parse(),{units:'millimeter'}).payload;
    expect(loaded.info.dimensions).toEqual([20,30,40]);const objects=importPayload(loaded,'centimeter');expect(statistics(objects).dimensions).toEqual([2,3,4]);expect(volume(importPayload(loaded))).toBeCloseTo(24000);
  });
  it('retains independent history snapshots and gives imports without UVs a mapping',()=>{
    const a=doc([primitive('Cube')]),b=doc(duplicateObjects(a.objects));let history=[];for(let i=0;i<40;i++)history=appendHistory(history,i%2?a:b);expect(history).toHaveLength(30);
    const g={...a.objects[0].geometry,attributes:{position:a.objects[0].geometry.attributes.position}};const mapped=ensureUV(g);expect(mapped.attributes.uv.array.length).toBe(g.attributes.position.array.length/3*2);expect(g.attributes.uv).toBeUndefined();
  });
});
