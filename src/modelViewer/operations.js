import Module from 'manifold-3d';
import {BufferAttribute,BufferGeometry,ExtrudeGeometry,Matrix4,Vector3} from 'three';
import {FontLoader} from 'three/addons/loaders/FontLoader.js';
import fontData from './fonts/helvetiker_regular.typeface.json';
import {bounds,IDENTITY,newId,packGeometry,triangleCount} from './editor';

export const MAX_OPERATION_TRIANGLES=200_000,MAX_HOLLOW_TRIANGLES=5_000;
export async function geometryOperation(action,objects,options={},wasmURL){
  const count=objects.reduce((sum,o)=>sum+triangleCount(o),0);
  if(!objects.length)throw Error('Select an object first.');
  if(count>MAX_OPERATION_TRIANGLES)throw Error('Geometry tools support up to 200,000 selected triangles. Open a reduced-detail model.');
  if(action==='hollow'&&count>MAX_HOLLOW_TRIANGLES)throw Error('Hollow supports up to 5,000 selected triangles. Simplify this model first.');
  if(['merge','intersect','subtract'].includes(action)&&objects.length<2)throw Error('Select at least two objects.');
  const module=await Module(wasmURL?{locateFile:()=>wasmURL}:{});module.setup();
  const {Manifold,Mesh}=module,allocated=[],materialMap=new Map();
  const own=value=>(allocated.push(value),value);
  const valid=value=>{const status=value.status();if(status!=='NoError')throw Error(`This operation requires a closed, consistently oriented mesh (${status}). Repair the source mesh first.`);return value;};
  function input(o){
    const p=o.geometry.attributes.position.array,uv=o.geometry.attributes.uv?.array,color=o.geometry.attributes.color?.array;
    const m=new Matrix4().fromArray(o.matrix),v=new Vector3(),props=new Float32Array(p.length/3*8);
    for(let i=0;i<p.length/3;i++){v.fromArray(p,3*i).applyMatrix4(m);props.set([v.x,v.y,v.z,uv?.[2*i]??0,uv?.[2*i+1]??0,color?.[3*i]??1,color?.[3*i+1]??1,color?.[3*i+2]??1],8*i);}
    const indices=Uint32Array.from(o.geometry.index||Array.from({length:p.length/3},(_,i)=>i));
    // A reflection reverses winding. Correct it before constructing a solid.
    if(m.determinant()<0)for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
    const groups=o.geometry.groups?.length?o.geometry.groups:[{start:0,count:indices.length,materialIndex:0}],runIndex=[],runOriginalID=[];
    let cursor=0;
    for(const group of groups){
      if(group.start!==cursor)throw Error('The model has incomplete material groups. Re-export or repaint it before solid editing.');
      const id=Manifold.reserveIDs(1);materialMap.set(id,o.materials[group.materialIndex]||o.materials[0]);runIndex.push(group.start);runOriginalID.push(id);cursor+=group.count;
    }
    runIndex.push(indices.length);
    const mesh=new Mesh({numProp:8,vertProperties:props,triVerts:indices,runIndex:Uint32Array.from(runIndex),runOriginalID:Uint32Array.from(runOriginalID)});mesh.merge();
    return valid(own(new Manifold(mesh)));
  }
  function output(value,name){
    valid(value);if(value.isEmpty())throw Error('The operation produced no geometry. Adjust the objects or settings.');
    if(value.numTri()>1_000_000)throw Error('The result is too large. Reduce the operation detail.');
    const mesh=value.getMesh(),g=new BufferGeometry(),positions=new Float32Array(mesh.numVert*3),uv=new Float32Array(mesh.numVert*2),color=new Float32Array(mesh.numVert*3);
    for(let i=0;i<mesh.numVert;i++){positions.set(mesh.vertProperties.subarray(i*mesh.numProp,i*mesh.numProp+3),3*i);uv.set([mesh.vertProperties[i*mesh.numProp+3]||0,mesh.vertProperties[i*mesh.numProp+4]||0],2*i);color.set([mesh.vertProperties[i*mesh.numProp+5]??1,mesh.vertProperties[i*mesh.numProp+6]??1,mesh.vertProperties[i*mesh.numProp+7]??1],3*i);}
    g.setAttribute('position',new BufferAttribute(positions,3));g.setAttribute('uv',new BufferAttribute(uv,2));g.setAttribute('color',new BufferAttribute(color,3));g.setIndex(new BufferAttribute(mesh.triVerts.slice(),1));g.computeVertexNormals();
    const materials=[],ids=new Map();
    for(let i=0;i<mesh.runOriginalID.length;i++){
      const id=mesh.runOriginalID[i];if(!ids.has(id)){ids.set(id,materials.length);materials.push({...materialMap.get(id)||objects[0].materials[0]});}
      g.addGroup(mesh.runIndex[i],mesh.runIndex[i+1]-mesh.runIndex[i],ids.get(id));
    }
    if(!materials.length)materials.push({...objects[0].materials[0]});
    const result={id:newId(),name,geometry:packGeometry(g),materials,matrix:[...IDENTITY]};g.dispose();return result;
  }
  try{
    const inputs=objects.map(input),box=bounds(objects),span=box.getSize(new Vector3()).length();
    const positive=(value,label)=>{const n=Number(value);if(!Number.isFinite(n)||n<=0||n>1e6)throw Error(`${label} must be positive and at most 1,000,000.`);return n;};
    if(action==='split'){
      if(objects.length!==1)throw Error('Split one selected object at a time.');
      const axis=Number(options.axis??2),offset=Number(options.offset);if(![0,1,2].includes(axis)||!Number.isFinite(offset))throw Error('Enter a valid split plane.');
      const normal=[0,0,0];normal[axis]=1;const halves=inputs[0].splitByPlane(normal,offset).map(own);
      if(halves.some(m=>m.isEmpty()))throw Error('The split plane must pass through the object.');
      return halves.map((m,i)=>output(m,`${objects[0].name} ${i?'lower':'upper'} ${'XYZ'[axis]}`));
    }
    if(action==='merge')return [output(own(Manifold.union(inputs)),'Merged object')];
    if(action==='intersect')return [output(own(Manifold.intersection(inputs)),'Intersection')];
    if(action==='subtract')return [output(own(Manifold.difference(inputs)),`${objects[0].name} subtracted`)];
    if(objects.length!==1)throw Error('Select one object for this tool.');
    const source=inputs[0];let result;
    if(action==='simplify')result=own(source.simplify(positive(options.tolerance??span*.005,'Tolerance')));
    else if(action==='smooth')result=own(own(source.smoothOut(180,1)).refine(2));
    else if(action==='hollow'){
      const thickness=positive(options.thickness,'Wall thickness');
      if(thickness>=Math.min(...box.getSize(new Vector3()).toArray())/2)throw Error('Wall thickness must be less than half the smallest dimension.');
      const kernel=own(Manifold.sphere(thickness,12)),inner=valid(own(source.minkowskiDifference(kernel)));
      if(inner.isEmpty())throw Error('This thickness leaves no inner cavity. Use a smaller value.');
      result=own(source.subtract(inner));
    }else if(action==='extrude'){
      const depth=positive(options.depth,'Extension depth'),footprint=own(source.project()),height=depth+Math.max(span*1e-5,.0001);
      const extension=own(own(footprint.extrude(height)).translate([0,0,box.min.z-depth]));result=own(source.add(extension));
    }else if(action==='emboss'){
      const text=String(options.text||'').trim();if(!text||text.length>60)throw Error('Enter 1–60 characters to emboss.');
      if([...text].some(character=>!fontData.glyphs[character]))throw Error('This font does not support one of those characters. Use Latin or Greek text, numbers, or basic punctuation.');
      const depth=positive(options.depth,'Emboss depth'),size=positive(options.size,'Text size');
      const font=new FontLoader().parse(fontData),g=new ExtrudeGeometry(font.generateShapes(text,size),{depth,bevelEnabled:false,curveSegments:4,steps:1});
      g.computeBoundingBox();const center=g.boundingBox.getCenter(new Vector3()),top=box.getCenter(new Vector3());g.translate(top.x-center.x,top.y-center.y,box.max.z-depth*.2);
      const stamp={id:newId(),name:'Emboss',geometry:packGeometry(g),materials:[objects[0].materials[0]],matrix:IDENTITY};
      const solid=input(stamp);g.dispose();
      if(own(source.intersect(solid)).isEmpty())throw Error('The text does not touch this surface. Emboss works on a flat top; adjust the model orientation.');
      result=own(source.add(solid));
    }else throw Error('Unknown geometry operation.');
    return [output(result,`${objects[0].name} · ${action}`)];
  }finally{for(const value of allocated.reverse())value.delete();}
}
