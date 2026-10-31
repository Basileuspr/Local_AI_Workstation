import {zipSync,strToU8} from 'three/addons/libs/fflate.module.js';
import {STLExporter} from 'three/addons/exporters/STLExporter.js';
import {prepareSTL,prepare3MF} from './parse';
import {inspectZip,MAX_EXPANDED_BYTES} from './limits';

export const MAX_REPAIR_BYTES=Infinity;
const mm={micron:.001,millimeter:1,centimeter:10,inch:25.4,foot:304.8,meter:1000};
function dispose(model){model.traverse(node=>{node.geometry?.dispose();for(const material of [node.material].flat())material?.dispose();});}

export function makeRepairPackage(buffer,type) {
  if(!buffer.byteLength)throw Error('Choose a nonempty model file.');
  if(type==='3mf'){inspectZip(buffer);prepare3MF(buffer);return new Uint8Array(buffer);}
  if(type!=='stl')throw Error('Choose an STL or 3MF file.');
  const model=prepareSTL(buffer).parse();
  try {
    const position=model.geometry.getAttribute('position'),vertices=[],triangles=[],ids=new Map();let size=0;
    for(let i=0;i<position.count;i+=3){
      const face=[];
      for(let j=0;j<3;j++){
        const x=position.getX(i+j),y=position.getY(i+j),z=position.getZ(i+j);
        if(![x,y,z].every(Number.isFinite))throw Error('The STL contains invalid vertex coordinates.');
        const key=`${x},${y},${z}`;
        if(!ids.has(key)){
          ids.set(key,vertices.length);const vertex=`<vertex x="${x}" y="${y}" z="${z}"/>`;vertices.push(vertex);size+=vertex.length;
        }
        face.push(ids.get(key));
      }
      const triangle=`<triangle v1="${face[0]}" v2="${face[1]}" v3="${face[2]}"/>`;triangles.push(triangle);size+=triangle.length;
    }
    const xml=`<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`;
    const bytes=zipSync({
      '[Content_Types].xml':strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),
      '_rels/.rels':strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="model" Target="/3D/model.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
      '3D/model.model':strToU8(xml),
    },{level:1});
    return bytes;
  } finally {dispose(model);}
}

export function repairedSTL(buffer) {
  const prepared=prepare3MF(buffer);
  const model=prepared.parse();
  try {
    // STL has no unit field. Export physical dimensions in millimeters.
    model.scale.multiplyScalar(mm[prepared.units]);model.updateMatrixWorld(true);
    const result=new STLExporter().parse(model,{binary:true});
    return new Uint8Array(result.buffer,result.byteOffset,result.byteLength);
  } finally {dispose(model);}
}
