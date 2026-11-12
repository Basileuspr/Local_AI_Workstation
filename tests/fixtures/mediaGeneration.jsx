import React, {useState, useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import LocalMediaGeneration from '../../src/components/LocalMediaGeneration';
import {PromptQueueProvider, usePromptQueue} from '../../src/components/PromptQueue';
import {runtimeIndicator} from '../../src/runtimeStatus';
import {runtimeObserver} from '../../src/appPolling';
import '../../src/styles.css';

const models = [
  {id:'qwen',name:'Qwen Image 2.1 Turbo Q4',kind:'image',family:'qwen-image-2.1',reference_mode:'edit',steps:8,fixed_steps:8,guidance:1,ready:true},
  {id:'wan',name:'Wan 2.2 I2V 14B Uncensored',kind:'video',family:'wan2.2-14b',reference_mode:'required',steps:20,guidance:3.5,ready:true},
  {id:'wan5',name:'Wan 2.2 TI2V 5B Q4',kind:'video',family:'wan2.2-5b',reference_mode:'optional',steps:50,guidance:5,width:832,height:480,ready:true},
];
const state = {jobs:[],requests:[],uploads:0,errors:[],failJobs:false,failModels:false}; window.mediaQA = state;
window.addEventListener('error',event=>state.errors.push(event.message));
window.fetch = async (url, options={}) => {
  const path = new URL(url, location.href).pathname;
  let data;
  if (path.endsWith('/models')) {
    if (state.failModels) return new Response('{}',{status:503});
    data = {models,runtime_ready:true};
  }
  else if (path === '/queue') data = {jobs:state.jobs.map(job=>({id:job.id,request_id:job.id,kind:'media-generation',label:job.name,status:job.status,stage:job.progress?.phase || job.phase,progress:job.progress,requires_gpu:true,created_at:new Date(job.created_at*1000).toISOString(),started_at:new Date(job.started_at*1000).toISOString()})),reported_at:new Date().toISOString()};
  else if (path === '/runtime/status') data = {gpu_owner:state.jobs.some(job=>['running','cancelling'].includes(job.status)) ? 'media-generation:synthetic' : null};
  else if (path === '/image-generation/references') {state.uploads++; data={reference:'blob:synthetic',name:'cup.png'};}
  else if (path.endsWith('/cancel')) {const job=state.jobs.find(job=>path.includes(job.id)); job.status='cancelled'; job.phase='Stopped'; data={ok:true};}
  else if (path.endsWith('/jobs') && options.method==='POST') {
    const request=JSON.parse(options.body); state.requests.push(request);
    state.jobs.unshift({id:state.requests.length.toString(16).padStart(32,'0'),name:models.find(model=>model.id===request.model_id).name,kind:models.find(model=>model.id===request.model_id).kind,
      request:{...request,seed:42},status:'running',phase:'Loading model',created_at:Date.now()/1000,started_at:Date.now()/1000,
      progress:{phase:'Loading model',step:0,total_steps:request.steps,elapsed_seconds:1,last_activity_seconds:0}}); data={id:state.jobs[0].id};
  } else if (path.endsWith('/jobs')) {
    if (state.failJobs) return new Response('{}',{status:503});
    data={jobs:state.jobs};
  }
  else throw Error('Unexpected request: '+path);
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
function Fixture() {
  const [active,setActive]=useState(true),[runtime,setRuntime]=useState(null);
  const queue=usePromptQueue();
  useEffect(()=>runtimeObserver().subscribe({data:setRuntime}),[]);
  const status=runtimeIndicator(runtime,queue);
  return <><p data-runtime-status={status.busy ? 'busy' : 'idle'}>{status.label}</p>
    <button onClick={()=>setActive(value=>!value)}>{active ? 'Hide generation' : 'Show generation'}</button>
    <div hidden={!active}><LocalMediaGeneration active={active}/></div></>;
}
createRoot(document.getElementById('root')).render(<PromptQueueProvider><Fixture/></PromptQueueProvider>);
