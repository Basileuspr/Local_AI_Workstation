import {makeRepairPackage,repairedSTL,MAX_REPAIR_BYTES} from './repair';
self.onmessage=async({data})=>{
  try {
    const bytes=data.action==='prepare'
      ?makeRepairPackage(await data.file.arrayBuffer(),data.file.name.split('.').pop().toLowerCase())
      :repairedSTL(data.buffer);
    self.postMessage({bytes},[bytes.buffer]);
  } catch(error){self.postMessage({error:error.message||'The model could not be prepared for repair.'});}
  self.close();
};
