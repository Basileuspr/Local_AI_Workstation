import {Box3,Group,Mesh,MeshPhongMaterial,Vector3} from 'three';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {ThreeMFLoader} from 'three/addons/loaders/3MFLoader.js';
import {zipSync,strFromU8,strToU8} from 'three/addons/libs/fflate.module.js';
import {DOMParser} from 'linkedom/worker';
import {checkTriangles,MAX_TRIANGLES} from './limits';
import {readModelParts} from './archive';

const UNITS={micron:.001,millimeter:1,centimeter:10,inch:25.4,foot:304.8,meter:1000};
const elements=(root,name)=>Array.from(root.getElementsByTagName(name));
const attr=(node,name)=>Array.from(node.attributes).find(a=>a.name===name || a.name.endsWith(`:${name}`))?.value;
const pathName=(base,value)=>new URL(value,`https://archive.invalid/${base}`).pathname.slice(1);
function xml(text) {
  if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('XML entities and document types are not supported.');
  // Canonicalize element prefixes; resource IDs and declared units are retained.
  return new DOMParser().parseFromString(text.replace(/(<\/?)[\w.-]+:([\w.-]+)/g,'$1$2'),'application/xml');
}
export function prepareSTL(buffer) {
  let count;
  if(buffer.byteLength>=84 && 84+50*new DataView(buffer).getUint32(80,true)===buffer.byteLength)count=new DataView(buffer).getUint32(80,true);
  else {
    const text=new TextDecoder().decode(buffer);
    if(!/^\s*solid\b/i.test(text))throw Error('Invalid binary STL length or ASCII STL header.');
    count=0;const facets=/\bfacet\s+normal\b/gi;while(facets.exec(text)){count++;if(count>MAX_TRIANGLES)break;}
    if((text.match(/\bvertex\s/gi)||[]).length!==count*3)throw Error('Each STL facet must contain three vertices.');
  }
  checkTriangles(count);
  return {triangles:count,units:'millimeter',warnings:['STL has no declared units; dimensions assume millimeters.'],parse(){
    const geometry=new STLLoader().parse(buffer);
    return new Mesh(geometry,new MeshPhongMaterial({color:geometry.hasColors?0xffffff:0x72b5d6,vertexColors:!!geometry.hasColors,side:2}));
  }};
}
export function prepare3MF(buffer) {
  const parts=readModelParts(buffer);
  const documents=new Map(),warnings=[];
  for(const [name,data] of Object.entries(parts))if(/\.model$/i.test(name))documents.set(name,xml(strFromU8(data)));
  const rel=parts['_rels/.rels'] && elements(xml(strFromU8(parts['_rels/.rels'])),'Relationship').find(n=>/3dmodel$/.test(n.getAttribute('Type')));
  const rootPath=rel && pathName('',rel.getAttribute('Target'));
  if(!rootPath || !documents.has(rootPath))throw Error('The 3MF has no valid root model relationship.');
  const root=documents.get(rootPath),rootModel=root.querySelector('model'),units=rootModel?.getAttribute('unit')||'millimeter';
  if(!UNITS[units])throw Error('Unsupported 3MF unit declaration.');
  const merged=root.querySelector('resources');if(!merged)throw Error('The 3MF has no resources.');
  const idMaps=new Map(),objects=new Map();let nextId=1;
  for(const [name,doc] of documents) {
    const ids=new Map();idMaps.set(name,ids);
    for(const node of Array.from(doc.querySelector('resources')?.children||[])) {
      const id=node.getAttribute('id');if(!id || ids.has(id))throw Error('Invalid or duplicate 3MF resource ID.');
      ids.set(id,String(nextId++));
    }
  }
  let triangleTotal=0,vertexTotal=0;
  for(const [name,doc] of [[rootPath,root],...Array.from(documents).filter(([name])=>name!==rootPath)]) {
    const model=doc.querySelector('model'),unit=model?.getAttribute('unit')||'millimeter';
    if(!UNITS[unit])throw Error('Unsupported 3MF part units.');
    const factor=UNITS[unit]/UNITS[units],ids=idMaps.get(name);
    const supportedProperties=new Set([...elements(doc,'basematerials'),...elements(doc,'colorgroup')].map(n=>n.getAttribute('id')));
    if(model.getAttribute('requiredextensions') || elements(doc,'metadata').length)warnings.push('Slicer settings and unsupported extensions are ignored; available mesh geometry is shown.');
    const textures=new Set();
    for(const node of [...elements(doc,'texture2dgroup'),...elements(doc,'texture2d')]){textures.add(node.getAttribute('id'));node.remove();warnings.push('Texture images are omitted; base colors and geometry are retained.');}
    for(const node of [...elements(doc,'beamlattice'),...elements(doc,'implicitfunction')]){node.remove();warnings.push('Beam lattice or implicit geometry is omitted; available triangle meshes are shown.');}
    for(const node of Array.from(doc.querySelectorAll('*'))) {
      if(node.hasAttribute('id') && ids.has(node.getAttribute('id')))node.setAttribute('id',ids.get(node.getAttribute('id')));
      if(node.hasAttribute('pid')) {
        const pid=node.getAttribute('pid');
        if(textures.has(pid)||!supportedProperties.has(pid)){for(const key of ['pid','p1','p2','p3','pindex'])node.removeAttribute(key);warnings.push('Unsupported material properties use neutral shading; mesh geometry is retained.');}
        else node.setAttribute('pid',ids.get(pid));
      }
      if(node.hasAttribute('displaypropertiesid') && ids.has(node.getAttribute('displaypropertiesid')))node.setAttribute('displaypropertiesid',ids.get(node.getAttribute('displaypropertiesid')));
      if(node.hasAttribute('objectid')) {
        const target=attr(node,'path')?pathName(name,attr(node,'path')):name;
        const id=idMaps.get(target)?.get(node.getAttribute('objectid'));
        if(!id)throw Error('A 3MF component references a missing object.');
        node.setAttribute('objectid',id);
      }
      if(node.hasAttribute('transform')) {
        const values=node.getAttribute('transform').trim().split(/\s+/).map(Number);
        if(values.length!==12 || values.some(v=>!Number.isFinite(v)))throw Error('Invalid component transform.');
        for(let i=9;i<12;i++)values[i]*=factor;node.setAttribute('transform',values.join(' '));
      }
      if(node.nodeName==='vertex') {
        vertexTotal++;if(vertexTotal>MAX_TRIANGLES*3)throw Error('Too many vertices for a safe preview.');
        for(const key of ['x','y','z']){const value=Number(node.getAttribute(key))*factor;if(!node.hasAttribute(key)||!Number.isFinite(value)||Math.abs(value)>1e12)throw Error('Invalid vertex coordinate.');node.setAttribute(key,String(value));}
      }
    }
    for(const node of elements(doc,'object')) {
      const vertices=elements(node,'vertex').length,triangles=elements(node,'triangle');triangleTotal+=triangles.length;
      if(triangleTotal>MAX_TRIANGLES)throw Error('Too many stored triangles for a safe preview.');
      for(const t of triangles)for(const key of ['v1','v2','v3']){const n=Number(t.getAttribute(key));if(!t.hasAttribute(key)||!Number.isInteger(n)||n<0||n>=vertices)throw Error('A triangle references an invalid vertex.');}
      objects.set(node.getAttribute('id'),{triangles:triangles.length,children:elements(node,'component').map(n=>n.getAttribute('objectid'))});
    }
    if(name!==rootPath)for(const node of Array.from(doc.querySelector('resources')?.children||[]))merged.appendChild(node);
  }
  // Non-mesh extension objects cannot be built by the core loader. Keep the
  // remaining physical meshes instead of failing the entire assembly.
  const omitted=new Set();
  for(const node of elements(merged,'object'))if(!node.querySelector('mesh')&&!node.querySelector('components')){omitted.add(node.getAttribute('id'));node.remove();}
  if(omitted.size){
    warnings.push('Objects without supported mesh or component geometry are omitted.');
    for(const id of omitted)objects.delete(id);
    for(const object of objects.values())object.children=object.children.filter(id=>!omitted.has(id));
    for(const node of root.querySelectorAll('[objectid]'))if(omitted.has(node.getAttribute('objectid')))node.remove();
  }
  const counts=new Map(),visiting=new Set();
  function count(id,depth=0) {
    if(depth>128||visiting.has(id))throw Error('Cyclic or excessively deep 3MF component hierarchy.');
    if(counts.has(id))return counts.get(id);
    const object=objects.get(id);if(!object)throw Error('Missing 3MF object.');
    visiting.add(id);let triangles=object.triangles,instances=1;
    for(const child of object.children){const c=count(child,depth+1);triangles+=c.triangles;instances+=c.instances;}
    visiting.delete(id);
    if(triangles>MAX_TRIANGLES||instances>10000)throw Error('Expanded component geometry exceeds the preview safety limit.');
    const result={triangles,instances};counts.set(id,result);return result;
  }
  // ThreeMFLoader builds every resource, including unused objects.
  let allocation=0;for(const id of objects.keys()){allocation+=count(id).instances;if(allocation>30000)throw Error('Too many expanded component instances.');}
  let triangles=0,instances=0;
  for(const node of Array.from(root.querySelector('build')?.children||[])){const c=count(node.getAttribute('objectid'));triangles+=c.triangles;instances+=c.instances;}
  checkTriangles(triangles);if(instances>10000)throw Error('Too many model instances.');
  const packed=zipSync({'3D/model.model':strToU8(root.toString()),'_rels/.rels':strToU8('<Relationships><Relationship Target="/3D/model.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Id="r1"/></Relationships>')},{level:0});
  return {triangles,units,warnings:[...new Set(warnings)],parse(){
    globalThis.DOMParser=DOMParser;
    return new ThreeMFLoader().parse(packed.buffer);
  }};
}
export function packModel(model,meta) {
  model.updateMatrixWorld(true);
  const box=new Box3().setFromObject(model),size=box.getSize(new Vector3());
  if(box.isEmpty() || [...box.min,...box.max].some(v=>!Number.isFinite(v)))throw Error('The model has invalid or empty bounds.');
  const geometries={},materials={},transfers=[];let triangles=0,meshes=0,area=0;
  const a=new Vector3(),b=new Vector3(),c=new Vector3(),ab=new Vector3(),ac=new Vector3();
  function visit(node) {
    const result={name:node.name,matrix:node.matrix.toArray(),children:node.children.map(visit)};
    if(node.isMesh) {
      meshes++;const g=node.geometry,p=g.getAttribute('position'),index=g.index,n=index?index.count:p.count;
      triangles+=n/3;
      for(let i=0;i<n;i+=3){a.fromBufferAttribute(p,index?index.getX(i):i).applyMatrix4(node.matrixWorld);b.fromBufferAttribute(p,index?index.getX(i+1):i+1).applyMatrix4(node.matrixWorld);c.fromBufferAttribute(p,index?index.getX(i+2):i+2).applyMatrix4(node.matrixWorld);area+=ab.subVectors(b,a).cross(ac.subVectors(c,a)).length()/2;}
      result.geometry=g.uuid;
      if(!geometries[g.uuid]) {
        const attributes={};
        for(const [name,attribute] of Object.entries(g.attributes)){attributes[name]={array:attribute.array,itemSize:attribute.itemSize,normalized:attribute.normalized};transfers.push(attribute.array.buffer);}
        geometries[g.uuid]={attributes,index:index?.array,groups:g.groups};if(index)transfers.push(index.array.buffer);
      }
      result.material=(Array.isArray(node.material)?node.material:[node.material]).map(m=>{materials[m.uuid]=m.toJSON();return m.uuid;});
    }
    return result;
  }
  const tree=visit(model);checkTriangles(triangles);
  if(!Number.isFinite(area))throw Error('The model contains invalid geometry.');
  return {payload:{tree,geometries,materials,info:{...meta,dimensions:size.toArray(),bounds:{min:box.min.toArray(),max:box.max.toArray()},triangles,meshes,area}},transfers:[...new Set(transfers)]};
}
