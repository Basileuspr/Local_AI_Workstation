import {useEffect,useRef,useState} from 'react';

const stages={preparing:'Preparing model',loading:'Loading model in Windows',checking:'Checking mesh',repairing:'Repairing mesh',verifying:'Checking repaired mesh',saving:'Preparing repaired file',exporting:'Preparing STL export',choosing:'Choose a destination'};
const count=n=>Number(n).toLocaleString();
export default function ModelRepair({file,onPreview,loading=false}) {
  const desktop=globalThis.window?.workstationDesktop;
  const available=!!desktop?.repair3DModel;
  const active=useRef(null),conversion=useRef(null),resultRef=useRef(null);
  const [stage,setStage]=useState(''),[result,setResult]=useState(null),[error,setError]=useState(''),[saved,setSaved]=useState(''),[elapsed,setElapsed]=useState(0);
  function terminateConversion(){const pending=conversion.current;conversion.current=null;if(pending){pending.worker.terminate();pending.reject(Error('Cancelled'));}}
  function release(){const job=active.current;active.current=null;terminateConversion();if(job)void desktop?.cancel3DRepair(job.id);if(resultRef.current)void desktop?.release3DRepair(resultRef.current.id);resultRef.current=null;}
  useEffect(()=>{release();setStage('');setResult(null);setError('');setSaved('');return release;},[file]);
  useEffect(()=>desktop?.on3DRepairProgress?.(value=>{if(active.current?.id===value.id&&stages[value.stage])setStage(value.stage);}),[desktop]);
  useEffect(()=>{if(!stage){setElapsed(0);return;}const started=Date.now();const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-started)/1000)),1000);return()=>clearInterval(timer);},[!!stage]);
  function convert(request){
    return new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('../modelViewer/repairWorker.js',import.meta.url),{type:'module'});
      conversion.current={worker,reject};
      worker.onmessage=({data})=>{if(conversion.current?.worker===worker)conversion.current=null;worker.terminate();data.error?reject(Error(data.error)):resolve(data.bytes);};
      worker.onerror=()=>{if(conversion.current?.worker===worker)conversion.current=null;worker.terminate();reject(Error('Model preparation failed. Try a smaller model.'));};
      worker.postMessage(request);
    });
  }
  async function repair(){
    if(!file||active.current)return;
    release();setResult(null);setSaved('');setError('');setStage('preparing');
    const job={id:crypto.randomUUID()};active.current=job;
    try {
      const bytes=await convert({action:'prepare',file});
      if(active.current!==job)return;
      const reply=await desktop.repair3DModel({id:job.id,bytes});
      if(active.current!==job){void desktop.release3DRepair(job.id);return;}
      if(reply?.error)throw Error(reply.error);
      if(reply?.cancelled)return;
      const repaired={...reply,file:new File([reply.bytes],file.name.replace(/\.[^.]+$/,'')+'-repaired.3mf',{type:'model/3mf'})};
      resultRef.current=repaired;setResult(repaired);
      onPreview(repaired.file);
    } catch(failure){if(active.current===job)setError(failure.message);}
    finally{if(active.current===job){active.current=null;setStage('');}}
  }
  function cancel(){
    if(active.current?.saving){active.current=null;terminateConversion();}
    else {release();setResult(null);}
    setStage('');setError('');
  }
  async function save(format){
    const original=resultRef.current;if(!original||active.current)return;
    const job={id:original.id,saving:true};active.current=job;setStage(format==='stl'?'exporting':'saving');setError('');setSaved('');
    try {
      const bytes=format==='stl'?await convert({action:'stl',buffer:original.bytes.buffer.slice(original.bytes.byteOffset,original.bytes.byteOffset+original.bytes.byteLength)}):undefined;
      if(active.current!==job)return;
      setStage('choosing');
      const reply=await desktop.save3DRepair({id:original.id,format,bytes,name:file.name});
      if(active.current!==job)return;
      if(reply?.error)throw Error(reply.error);
      if(reply?.saved)setSaved(`Saved ${reply.name}`);
    } catch(failure){if(active.current===job)setError(failure.message);}
    finally{if(active.current===job){active.current=null;setStage('');}}
  }
  return <div className="model-repair" aria-label="Model repair">
    <div className="model-toolbar">
      <button disabled={!available||!file||!!stage||loading} onClick={repair}>Repair model</button>
      {stage&&stage!=='choosing'&&<button onClick={cancel}>{stage==='exporting'?'Cancel export':'Cancel repair'}</button>}
      {result&&<><button disabled={!!stage||loading} onClick={()=>onPreview(file)}>Show original</button><button disabled={!!stage||loading} onClick={()=>onPreview(result.file)}>Show repaired</button>
        <button disabled={!!stage} onClick={()=>save('3mf')}>Save repaired 3MF</button><button disabled={!!stage} onClick={()=>save('stl')}>Save repaired STL</button></>}
    </div>
    {!available?<p>Mesh repair is available in the Windows desktop app after a full restart.</p>:null}
    {stage&&<p role="status">{stages[stage]||'Repairing'}… {elapsed}s</p>}
    {error&&<p role="alert">{error}</p>}
    {result&&<div className="model-repair-result"><p role="status">{result.summary.after.invalidMeshes===0?'Repair complete — passes Windows mesh verification.':'Repair finished, but Windows still reports mesh problems. Review before printing.'}</p>
      <p>Triangles: {count(result.summary.before.triangles)} → {count(result.summary.after.triangles)} · Meshes with errors: {count(result.summary.before.invalidMeshes)} → {count(result.summary.after.invalidMeshes)}</p>
      </div>}
    {saved&&<p role="status">{saved}</p>}
  </div>;
}
