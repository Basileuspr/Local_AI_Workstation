import {prepareSTL,prepare3MF,packModel} from './parse';
import {modelType,validateFile,inspectZip,WARN_TRIANGLES,WARN_FILE_BYTES} from './limits';
let prepared=null,metadata=null,pending=null;
self.onmessage=async({data})=>{
  try {
    if(data.action==='open') {
      validateFile(data.file);const buffer=await data.file.arrayBuffer();pending={file:data.file,buffer};
      if(modelType(data.file.name)==='3mf') {
        const {expandedBytes}=inspectZip(buffer);
        if(expandedBytes>WARN_FILE_BYTES){self.postMessage({type:'warning',message:`This archive expands to approximately ${Math.round(expandedBytes/1024/1024)} MB before geometry is built. Continue?`});return;}
      }
    }
    if(pending) {
      const {file,buffer}=pending;pending=null;
      prepared=({'stl':prepareSTL,'3mf':prepare3MF}[modelType(file.name)])(buffer);
      metadata={name:file.name,type:modelType(file.name).toUpperCase(),size:file.size,units:prepared.units,warnings:prepared.warnings};
      if(prepared.triangles>WARN_TRIANGLES){self.postMessage({type:'warning',triangles:prepared.triangles});return;}
    }
    if(!prepared)throw Error('Open a model first.');
    self.postMessage({type:'progress',message:'Building model geometry…'});
    const {payload,transfers}=packModel(prepared.parse(),metadata);prepared=null;metadata=null;
    self.postMessage({type:'ready',payload},transfers);self.close();
  } catch(failure){self.postMessage({type:'error',message:failure.message || 'The model could not be loaded.'});self.close();}
};
