import wasmURL from 'manifold-3d/manifold.wasm?url';
import {geometryOperation} from './operations';
self.onmessage=async({data})=>{
  try{
    const objects=await geometryOperation(data.action,data.objects,data.options,wasmURL),transfers=[];
    for(const o of objects){for(const a of Object.values(o.geometry.attributes))transfers.push(a.array.buffer);if(o.geometry.index)transfers.push(o.geometry.index.buffer);}
    self.postMessage({objects},[...new Set(transfers)]);
  }catch(error){self.postMessage({error:error.message||'The mesh operation failed. Try simpler geometry.'});}
  self.close();
};
