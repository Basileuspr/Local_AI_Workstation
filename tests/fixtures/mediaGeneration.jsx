import React from 'react';
import {createRoot} from 'react-dom/client';
import LocalMediaGeneration from '../../src/components/LocalMediaGeneration';
import '../../src/styles.css';

const models = [
  {id:'qwen',name:'Qwen Image 2.1 Turbo Q4',kind:'image',family:'qwen-image-2.1',reference_mode:'edit',steps:8,fixed_steps:8,guidance:1,ready:true},
  {id:'wan',name:'Wan 2.2 I2V 14B Uncensored',kind:'video',family:'wan2.2-14b',reference_mode:'required',steps:20,guidance:3.5,ready:true},
  {id:'wan5',name:'Wan 2.2 TI2V 5B Q4',kind:'video',family:'wan2.2-5b',reference_mode:'optional',steps:50,guidance:5,width:832,height:480,ready:true},
];
const state = {jobs:[],requests:[],uploads:0,errors:[]}; window.mediaQA = state;
window.addEventListener('error',event=>state.errors.push(event.message));
window.fetch = async (url, options={}) => {
  const path = new URL(url, location.href).pathname;
  let data;
  if (path.endsWith('/models')) data = {models,runtime_ready:true};
  else if (path === '/image-generation/references') {state.uploads++; data={reference:'blob:synthetic',name:'cup.png'};}
  else if (path.endsWith('/cancel')) {state.jobs[0].status='cancelled'; state.jobs[0].phase='Stopped'; data={ok:true};}
  else if (path.endsWith('/jobs') && options.method==='POST') {
    const request=JSON.parse(options.body); state.requests.push(request);
    state.jobs.unshift({id:state.requests.length.toString(16).padStart(32,'0'),name:models.find(model=>model.id===request.model_id).name,kind:models.find(model=>model.id===request.model_id).kind,
      request:{...request,seed:42},status:'running',phase:'Loading model',created_at:Date.now()}); data={id:state.jobs[0].id};
  } else if (path.endsWith('/jobs')) data={jobs:state.jobs};
  else throw Error('Unexpected request: '+path);
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
createRoot(document.getElementById('root')).render(<LocalMediaGeneration/>);
