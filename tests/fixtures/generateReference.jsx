import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider, useDispatch } from '../../src/useStore';
import { ImageGenerationProvider } from '../../src/ImageGenerationContext';
import { ImageDestinationsProvider } from '../../src/ImageDestinations';
import ImageStudio from '../../src/components/ImageStudio';
import MediaCardActions from '../../src/components/MediaCardActions';
import '../../src/styles.css';

window.referenceQA = { uploads: [], submissions: [], tasks: [], analyses: [], stops: [], pendingAnalysis: false, stopped: false };
const qa = window.referenceQA;
const nativeFetch = window.fetch.bind(window);
const details = {appearance:'Blue ceramic teapot, curved handle, short spout',style:'Watercolor, cool palette',composition:'Centered tabletop close-up',lighting:'Soft window light',uncertainties:['Rear detail is hidden.']};
let workflow;
window.fetch = async (input, options = {}) => {
  if (String(input).startsWith('blob:')) return nativeFetch(input, options);
  const path = new URL(input, location.href).pathname;
  const json = value => new Response(JSON.stringify(value), {headers:{'Content-Type':'application/json'}});
  if (path === '/image-generation/models') return json({models:[{id:'fixture',name:'Fixture SDXL'}],loras:[{id:'fixture-lora',name:'Teapot identity',base_model_id:'fixture',trigger_word:'teapot_token',training_goal:'character_identity'}],runtime:{ready:true,device:'UI test fixture'}});
  if (path === '/image-workflows/capabilities') return json({providers:[{id:'ollama-vision',available:true,models:[{id:'vision-fixture',name:'Fixture vision model'}]}]});
  if (path === '/image-workflows' && options.method === 'POST') { workflow={id:'b'.repeat(32),revision:1,name:'Fixture',assets:[],stages:[],prompt_settings:{}}; return json(workflow); }
  if (path.endsWith('/assets')) {
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await options.body.get('file').arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
    workflow={...workflow,revision:2,assets:[{id:hash,name:'Reference'}]}; return json(workflow);
  }
  if (path === '/image-workflows/'+'b'.repeat(32) && options.method === 'PUT') {workflow={...workflow,...JSON.parse(options.body),revision:3};qa.analyses.push(workflow);return json(workflow);}
  if (path.endsWith('/execute')) {qa.stopped=false;return json({id:'c'.repeat(32),status:'queued'});}
  if (path.endsWith('/run')) return json({id:'c'.repeat(32),status:qa.stopped?'cancelled':qa.pendingAnalysis?'running':'completed',stage_results:[{metadata:{reference_analysis:details}}]});
  if (path.endsWith('/stop')) {qa.stopped=true;qa.stops.push(path);window.dispatchEvent(new Event('qa-request'));return json({});}
  if (path === '/image-generation/references') {
    qa.uploads.push({name:options.body.get('file').name, size:options.body.get('file').size});
    return json({reference:'blob:' + 'a'.repeat(64)});
  }
  if (path === '/image-generation/tasks') {
    if (options.method === 'POST') {
      const submission = JSON.parse(options.body); qa.submissions.push(submission);
      window.dispatchEvent(new Event('qa-request'));
      qa.tasks.push(...submission.requests.map((request, index) => ({request_id:request.request_id, session_id:request.session_id,
        batch_id:submission.batch_id, batch_index:index, batch_count:submission.requests.length, status:'queued', prompt:request.prompt})));
    }
    return json({tasks:qa.tasks});
  }
  if (path === '/sessions/new') return json({id:'fixture-chat'});
  if (path === '/sessions/fixture-chat') return json({id:'fixture-chat',messages:[],title:'Fixture chat'});
  if (path === '/sessions/images') return json({images:[]});
  if (path === '/image-generation/prompt-tokens') return json({prompt:{token_count:12,native_content_limit:75,chunks_required:1},negative_prompt:{token_count:0,native_content_limit:75,chunks_required:1},long_prompt_max_chunks:4});
  // Every fetch is intercepted: this fixture never calls the real backend.
  return json({});
};
function Setup() {
  const dispatch = useDispatch();
  const [submitted,setSubmitted] = useState([]),[sample,setSample]=useState(null),[stops,setStops]=useState(0);
  useEffect(()=>{const update=()=>{setSubmitted([...qa.submissions]);setStops(qa.stops.length);};window.addEventListener('qa-request',update);return()=>window.removeEventListener('qa-request',update);},[]);
  useEffect(()=>{const canvas=document.createElement('canvas');canvas.width=600;canvas.height=400;const context=canvas.getContext('2d');context.fillStyle='#bfdae6';context.fillRect(0,0,600,400);context.fillStyle='#247dab';context.beginPath();context.ellipse(300,200,120,85,0,0,Math.PI*2);context.fill();let url;canvas.toBlob(blob=>{url=URL.createObjectURL(blob);setSample({id:'sample',name:'Synthetic teapot reference.png',url});});return()=>{if(url)URL.revokeObjectURL(url);};},[]);
  useEffect(() => { dispatch({type:'SET_IMAGE_SETTINGS',payload:{modelId:'fixture',prompt:'A blue ceramic teapot',negativePrompt:'',width:1024,height:1024,steps:24,guidanceScale:5.5,seed:'42',loraId:''}}); }, [dispatch]);
  return <><aside style={{padding:12}}><strong>Isolated likeness UI fixture · simulated models</strong>{sample&&<MediaCardActions image={sample}/>}
    <label><input type="checkbox" onChange={event=>{qa.pendingAnalysis=event.target.checked;}}/>Simulate pending analysis</label><span>Stopped analyses: {stops}</span>
    <details><summary>Submitted test requests · {submitted.length}</summary><pre aria-label="Submitted test recipes">{JSON.stringify(submitted.map(batch=>batch.requests.map(({seed,strength,steps,source_fit,prompt,lora_id})=>({seed,strength,steps,source_fit,prompt,lora_id}))),null,2)}</pre></details></aside>
    <main id="main" style={{height:'calc(100vh - 120px)'}}><ImageStudio /></main></>;
}
createRoot(document.getElementById('root')).render(<StoreProvider><ImageGenerationProvider><ImageDestinationsProvider><Setup /></ImageDestinationsProvider></ImageGenerationProvider></StoreProvider>);
