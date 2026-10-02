import {makeRepairPackage,repairedSTL,MAX_REPAIR_BYTES} from './repair';
self.onmessage=async({data})=>{
  try {
    if(data.action==='prepare'&&data.file.size>MAX_REPAIR_BYTES)throw Error('Windows repair supports input files up to 128 MB.');
    const bytes=data.action==='prepare'
      ?makeRepairPackage(await data.file.arrayBuffer(),data.file.name.split('.').pop().toLowerCase())
      :repairedSTL(data.buffer);
    self.postMessage({bytes},[bytes.buffer]);
  } catch(error){self.postMessage({error:error.message||'The model could not be prepared for repair.'});}
  self.close();
};
