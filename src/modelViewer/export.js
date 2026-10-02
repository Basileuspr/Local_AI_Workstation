import {BufferAttribute,Group,Matrix4,Mesh} from 'three';
import {STLExporter} from 'three/addons/exporters/STLExporter.js';
import {UNIT_MM,unpackGeometry,validateDocument} from './editor';
export function exportSTL(doc){
  validateDocument(doc);if(!doc.objects.length)throw Error('Add or open a model first.');
  const triangles=doc.objects.reduce((n,o)=>n+(o.geometry.index?.length||o.geometry.attributes.position.array.length/3)/3,0);
  if(84+50*triangles>128*1024*1024)throw Error('STL export exceeds 128 MB. Export a smaller scene.');
  const root=new Group();
  try{
    for(const o of doc.objects){const original=unpackGeometry(o.geometry),g=original.clone(),matrix=new Matrix4().makeScale(UNIT_MM[doc.units],UNIT_MM[doc.units],UNIT_MM[doc.units]).multiply(new Matrix4().fromArray(o.matrix));original.dispose();
      g.applyMatrix4(matrix);
      if(matrix.determinant()<0){const index=g.index?Uint32Array.from(g.index.array):Uint32Array.from({length:g.attributes.position.count},(_,i)=>i);for(let i=0;i<index.length;i+=3)[index[i+1],index[i+2]]=[index[i+2],index[i+1]];g.setIndex(new BufferAttribute(index,1));}
      root.add(new Mesh(g));
    }
    root.updateMatrixWorld(true);const result=new STLExporter().parse(root,{binary:true});return new Uint8Array(result.buffer,result.byteOffset,result.byteLength);
  }finally{root.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}
}
