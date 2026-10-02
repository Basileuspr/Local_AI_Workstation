import {Box3,BoxGeometry,BufferAttribute,BufferGeometry,Color,ConeGeometry,CylinderGeometry,Euler,Matrix4,Quaternion,SphereGeometry,TetrahedronGeometry,TorusGeometry,Vector3} from 'three';

export const PRIMITIVES=['Cube','Cylinder','Pyramid','Cone','Sphere','Hexagon','Wedge','Torus','Tetrahedron'];
export const UNIT_MM={micron:.001,millimeter:1,centimeter:10,inch:25.4,foot:304.8,meter:1000};
export const IDENTITY=new Matrix4().toArray();
export const DEFAULT_MATERIAL={color:'#8cbed8',roughness:.65,metalness:0,opacity:1};
export const MAX_EDITOR_TRIANGLES=2_000_000,MAX_PROJECT_BYTES=128*1024*1024;
export const newId=()=>crypto.randomUUID();
export const emptyDocument=()=>({objects:[],units:'millimeter',name:'Untitled',warnings:[]});
export function packGeometry(g){
  const attributes={};
  for(const [key,a] of Object.entries(g.attributes))attributes[key]={array:a.array,itemSize:a.itemSize,normalized:a.normalized};
  return {attributes,index:g.index?.array||null,groups:g.groups.map(g=>({...g}))};
}
export function unpackGeometry(data){
  const g=new BufferGeometry();
  for(const [key,a] of Object.entries(data.attributes))g.setAttribute(key,new BufferAttribute(a.array,a.itemSize,!!a.normalized));
  if(data.index)g.setIndex(new BufferAttribute(data.index,1));
  for(const group of data.groups||[])g.addGroup(group.start,group.count,group.materialIndex);
  if(!g.attributes.normal)g.computeVertexNormals();
  return g;
}
export function primitive(name,dimensions=[20,20,20]){
  if(!PRIMITIVES.includes(name))throw Error('Choose a supported shape.');
  if(dimensions.length!==3||dimensions.some(n=>!Number.isFinite(n)||n<=0||n>1e6))throw Error('Shape dimensions must be positive and at most 1,000,000.');
  let g;
  switch(name){
    case 'Cube':g=new BoxGeometry(1,1,1);break;
    case 'Cylinder':case 'Hexagon':g=new CylinderGeometry(.5,.5,1,name==='Hexagon'?6:48);g.rotateX(Math.PI/2);break;
    case 'Cone':case 'Pyramid':g=new ConeGeometry(.5,1,name==='Pyramid'?4:48);g.rotateX(Math.PI/2);if(name==='Pyramid')g.rotateZ(Math.PI/4);break;
    case 'Sphere':g=new SphereGeometry(.5,40,24);g.rotateX(Math.PI/2);break;
    case 'Torus':g=new TorusGeometry(.35,.15,16,48);break;
    case 'Tetrahedron':g=new TetrahedronGeometry(.7);break;
    case 'Wedge':{
      g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(new Float32Array([-1,-1,-1,1,-1,-1,1,1,-1,-1,1,-1,-1,1,1,1,1,1]),3));
      g.setIndex([0,2,1,0,3,2,0,4,3,1,2,5,3,4,5,3,5,2,0,1,5,0,5,4]);g.computeVertexNormals();break;
    }
  }
  g.computeBoundingBox();const size=g.boundingBox.getSize(new Vector3()),center=g.boundingBox.getCenter(new Vector3());
  g.translate(-center.x,-center.y,-center.z);g.scale(...dimensions.map((n,i)=>n/size.getComponent(i)));
  g.clearGroups();const geometry=packGeometry(g);g.dispose();
  return {id:newId(),name,geometry,materials:[{...DEFAULT_MATERIAL}],matrix:new Matrix4().makeTranslation(0,0,dimensions[2]/2).toArray()};
}
function material(data){
  return {color:'#'+new Color(data.color??0x8cbed8).getHexString(),opacity:data.opacity??1,roughness:data.roughness??.65,metalness:data.metalness??0,vertexColors:!!data.vertexColors};
}
export function importPayload(payload,targetUnits=payload.info.units||'millimeter'){
  const objects=[],factor=UNIT_MM[payload.info.units||'millimeter']/UNIT_MM[targetUnits];
  if(!Number.isFinite(factor))throw Error('Unsupported model units.');
  function visit(node,parent){
    const matrix=new Matrix4().multiplyMatrices(parent,new Matrix4().fromArray(node.matrix));
    if(node.geometry)objects.push({id:newId(),name:node.name||`${payload.info.name||'Model'} · ${objects.length+1}`,geometry:payload.geometries[node.geometry],materials:node.material.map(id=>material(payload.materials[id])),matrix:matrix.toArray()});
    node.children.forEach(child=>visit(child,matrix));
  }
  visit(payload.tree,new Matrix4().makeScale(factor,factor,factor));return objects;
}
export const triangleCount=object=>(object.geometry.index?.length||object.geometry.attributes.position.array.length/3)/3;
export function bounds(objects){
  const box=new Box3(),p=new Vector3();
  for(const object of objects){const a=object.geometry.attributes.position.array,m=new Matrix4().fromArray(object.matrix);for(let i=0;i<a.length;i+=3)box.expandByPoint(p.fromArray(a,i).applyMatrix4(m));}
  return box;
}
export function statistics(objects){
  const box=bounds(objects),a=new Vector3(),b=new Vector3(),c=new Vector3(),ab=new Vector3(),ac=new Vector3();let area=0,triangles=0;
  for(const o of objects){const p=o.geometry.attributes.position.array,idx=o.geometry.index,m=new Matrix4().fromArray(o.matrix),count=idx?.length||p.length/3;triangles+=count/3;
    for(let i=0;i<count;i+=3){a.fromArray(p,3*(idx?idx[i]:i)).applyMatrix4(m);b.fromArray(p,3*(idx?idx[i+1]:i+1)).applyMatrix4(m);c.fromArray(p,3*(idx?idx[i+2]:i+2)).applyMatrix4(m);area+=ab.subVectors(b,a).cross(ac.subVectors(c,a)).length()/2;}}
  return {triangles,meshes:objects.length,area,dimensions:box.isEmpty()?[0,0,0]:box.getSize(new Vector3()).toArray(),bounds:{min:box.isEmpty()?[0,0,0]:box.min.toArray(),max:box.isEmpty()?[0,0,0]:box.max.toArray()}};
}
export function transformValues(object){
  const position=new Vector3(),rotation=new Quaternion(),scale=new Vector3();new Matrix4().fromArray(object.matrix).decompose(position,rotation,scale);
  return {position:position.toArray(),rotation:new Euler().setFromQuaternion(rotation).toArray().slice(0,3).map(v=>v*180/Math.PI),scale:scale.toArray()};
}
export function transformObject(object,values){
  const numbers=[...values.position,...values.rotation,...values.scale];
  if(numbers.some(n=>!Number.isFinite(n)||Math.abs(n)>1e6)||values.scale.some(n=>Math.abs(n)<.0001))throw Error('Enter finite transforms and a nonzero scale.');
  return {...object,matrix:new Matrix4().compose(new Vector3(...values.position),new Quaternion().setFromEuler(new Euler(...values.rotation.map(v=>v*Math.PI/180))),new Vector3(...values.scale)).toArray()};
}
export function translateObject(o,offset){return {...o,matrix:new Matrix4().makeTranslation(...offset).multiply(new Matrix4().fromArray(o.matrix)).toArray()};}
export function duplicateObjects(objects,offset=[5,5,0]){return objects.map(o=>({...translateObject(o,offset),id:newId(),name:`${o.name} copy`}));}
export function settleObjects(objects){return objects.map(o=>translateObject(o,[0,0,-bounds([o]).min.z]));}
export function mirrorObjects(objects,axis){
  const center=bounds(objects).getCenter(new Vector3()),scale=[1,1,1];scale[axis]=-1;
  const m=new Matrix4().makeTranslation(...center).multiply(new Matrix4().makeScale(...scale)).multiply(new Matrix4().makeTranslation(-center.x,-center.y,-center.z));
  return objects.map(o=>({...o,matrix:m.clone().multiply(new Matrix4().fromArray(o.matrix)).toArray()}));
}
export function validateDocument(doc){
  if(!doc||!UNIT_MM[doc.units]||!Array.isArray(doc.objects)||doc.objects.length>1000)throw Error('Invalid project or too many objects (maximum 1,000).');
  let triangles=0;const ids=new Set();
  for(const o of doc.objects){
    if(!o.id||ids.has(o.id)||typeof o.name!=='string'||o.name.length>300)throw Error('Invalid object name or ID.');ids.add(o.id);
    if(!Array.isArray(o.matrix)||o.matrix.length!==16||o.matrix.some(n=>!Number.isFinite(n)||Math.abs(n)>1e12)||Math.abs(new Matrix4().fromArray(o.matrix).determinant())<1e-15||o.matrix[3]!==0||o.matrix[7]!==0||o.matrix[11]!==0||o.matrix[15]!==1)throw Error('Invalid object transform.');
    const p=o.geometry?.attributes?.position;if(!p||p.itemSize!==3||!p.array.length||p.array.length%3)throw Error('Invalid model vertices.');
    for(const [key,a] of Object.entries(o.geometry.attributes)){
      if(!['position','normal','uv','color'].includes(key)||a.itemSize!==({position:3,normal:3,uv:2,color:3}[key])||a.array.length/a.itemSize!==p.array.length/3||a.array.some(n=>!Number.isFinite(n)||Math.abs(n)>1e12))throw Error('Invalid model attributes.');
    }
    const index=o.geometry.index,count=index?.length||p.array.length/3;
    if(count%3||index?.some(n=>!Number.isInteger(n)||n<0||n>=p.array.length/3))throw Error('Invalid triangle indices.');
    triangles+=count/3;
    if(!Array.isArray(o.materials)||!o.materials.length||o.materials.length>256)throw Error('Invalid materials.');
    for(const m of o.materials){
      if(!/^#[\da-f]{6}$/i.test(m.color)||['opacity','roughness','metalness'].some(k=>!Number.isFinite(m[k])||m[k]<0||m[k]>1))throw Error('Invalid material settings.');
      if(m.mapData&&(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(m.mapData)||m.mapData.length>12*1024*1024))throw Error('Projects only accept embedded local PNG, JPEG, or WebP textures up to 12 MB.');
    }
    for(const g of o.geometry.groups||[])if(!Number.isInteger(g.start)||g.start<0||g.start%3||!Number.isInteger(g.count)||g.count<0||g.count%3||g.start+g.count>count||!Number.isInteger(g.materialIndex)||g.materialIndex<0||g.materialIndex>=o.materials.length)throw Error('Invalid material groups.');
  }
  if(triangles>8_000_000)throw Error('The scene exceeds the 8 million triangle limit.');
  return doc;
}
export function serializeProject(doc){
  validateDocument(doc);const text=JSON.stringify({format:'law-3d-project',version:1,document:doc},(key,value)=>ArrayBuffer.isView(value)?Array.from(value):value);
  if(new Blob([text]).size>MAX_PROJECT_BYTES)throw Error('This project exceeds the 128 MB save limit. Export STL or reduce geometry.');return text;
}
export function parseProject(text){
  if(text.length>MAX_PROJECT_BYTES)throw Error('Project exceeds 128 MB.');
  const data=JSON.parse(text);if(data.format!=='law-3d-project'||data.version!==1)throw Error('Choose a 3D editor project (.law3d).');
  const doc=validateDocument(data.document);
  return {...doc,objects:doc.objects.map(o=>({...o,geometry:{...o.geometry,attributes:Object.fromEntries(Object.entries(o.geometry.attributes).map(([k,a])=>[k,{...a,array:Float32Array.from(a.array)}])),index:o.geometry.index?Uint32Array.from(o.geometry.index):null}}))};
}
// Snapshots share immutable geometry buffers. Bound retained history by bytes as well as count.
export function historyBytes(documents){
  const seen=new Set();let total=0;
  for(const doc of documents)for(const o of doc.objects){for(const a of [...Object.values(o.geometry.attributes).map(a=>a.array),o.geometry.index].filter(Boolean))if(!seen.has(a)){seen.add(a);total+=a.byteLength;}
    for(const m of o.materials)if(m.mapData&&!seen.has(m.mapData)){seen.add(m.mapData);total+=m.mapData.length*2;}}
  return total;
}
export function appendHistory(history,document){
  const next=[...history,document].slice(-30);while(next.length&&historyBytes(next)>128*1024*1024)next.shift();return next;
}
export function ensureUV(geometry){
  if(geometry.attributes.uv)return geometry;
  // Planar XY mapping makes stamps and QR codes readable from above on imports.
  const p=geometry.attributes.position.array,uv=new Float32Array(p.length/3*2);let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(let i=0;i<p.length;i+=3){minX=Math.min(minX,p[i]);maxX=Math.max(maxX,p[i]);minY=Math.min(minY,p[i+1]);maxY=Math.max(maxY,p[i+1]);}
  for(let i=0;i<p.length/3;i++){uv[2*i]=(p[3*i]-minX)/(maxX-minX||1);uv[2*i+1]=(p[3*i+1]-minY)/(maxY-minY||1);}
  return {...geometry,attributes:{...geometry.attributes,uv:{array:uv,itemSize:2}}};
}
