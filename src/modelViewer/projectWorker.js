import {parseProject,serializeProject} from './editor';
import {exportSTL} from './export';
self.onmessage=async({data})=>{
  try{
    if(data.action==='open')self.postMessage({document:parseProject(await data.file.text())});
    else if(data.action==='project')self.postMessage({text:serializeProject(data.document)});
    else{const bytes=exportSTL(data.document);self.postMessage({bytes},[bytes.buffer]);}
  }catch(error){self.postMessage({error:error.message||'The project could not be processed.'});}
  self.close();
};
