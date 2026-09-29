import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {StoreProvider} from '../../src/useStore';
import {ImageGenerationProvider, useImageGeneration} from '../../src/ImageGenerationContext';
import {ImageDestinationsProvider} from '../../src/ImageDestinations';
import AppLayout from '../../src/components/AppLayout';
import ImageStudio from '../../src/components/ImageStudio';
import PromptIndex from '../../src/components/PromptIndex';
import '../../src/styles.css';

// Deliberately hold later responses: a completed preview must work while the
// same provider still owns pending batch requests. No real backend/GPU is used.
const pending = [], messages = [], imageTasks = [];
const entries = [];
let indexDraft = {editor:'new',form:{title:'Unfinished entry',content:'Keep this draft',source:'',tags:''},search:''};
let failNextSave = false;
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, options = {}) => {
  const path = new URL(input, location.href).pathname;
  const json = value => Promise.resolve(new Response(JSON.stringify(value), {headers: {'Content-Type':'application/json'}}));
  if (path === '/prompt-index/state') return json({entries,draft:indexDraft});
  if (path === '/prompt-index/draft') {
    indexDraft = options.method === 'DELETE' ? {} : JSON.parse(options.body);
    return json(indexDraft);
  }
  if (path === '/prompt-index' && options.method === 'POST') {
    if (failNextSave) { failNextSave = false; return new Response(JSON.stringify({detail:'Fixture save failed; retry'}),{status:503}); }
    const entry = {...JSON.parse(options.body),id:String(entries.length + 1),created_at:new Date().toISOString()};
    entries.push(entry); return json(entry);
  }
  if (path === '/image-generation/models') return json({models:[{id:'fixture',name:'Fixture model'}],loras:[],runtime:{ready:true,device:'Test fixture'}});
  if (path === '/sessions/new') return json({id:'fixture-chat'});
  if (path === '/sessions/fixture-chat') return json({id:'fixture-chat',title:'Fixture chat',messages:[...messages]});
  if (path === '/image-generation/tasks') {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      body.requests.forEach((request,index) => {
        const task = {request_id:request.request_id,session_id:request.session_id,batch_id:body.batch_id,batch_index:index,
          batch_count:body.requests.length,status:'running',prompt:request.prompt,label:request.request_label};
        imageTasks.push(task);
        pending.push(() => {
          if (task.status === 'cancelled') return;
          const messageId = `message-${request.request_id}`, imageId = `image-${request.request_id}`;
          messages.push({id:messageId,role:'assistant',generatedImages:[{id:imageId}]});
          task.status = 'completed';
          task.result = {request_id:task.request_id,batch_id:task.batch_id,session_id:task.session_id,message_id:messageId,image_id:imageId,
            filename:`image-${request.seed}.svg`,url:`/sessions/fixture-chat/images/by-id/${messageId}/${imageId}`,seed:request.seed};
        });
      });
    }
    return json({tasks:imageTasks});
  }
  if (path.startsWith('/image-generation/stop/')) {
    const task = imageTasks.find(task => task.request_id === path.split('/').at(-1));
    if (task) task.status = 'cancelled';
    return json({stopped:!!task});
  }
  if (path.endsWith('/messages/append')) {
    messages.push(...JSON.parse(options.body).messages);
    return json({id:'fixture-chat',messages:[...messages]});
  }
  if (path === '/sessions/images') return json({images:messages.flatMap(message => (message.generatedImages || []).map(image => ({id:`fixture-chat:${message.id}:${image.id}`})))});
  if (path === '/image-generation/generate') return new Promise(resolve => pending.push(() => {
    const request = JSON.parse(options.body);
    resolve(new Response(JSON.stringify({filename:`image-${request.seed}.svg`,url:`/tests/fixtures/generatePreview.svg?seed=${request.seed}`,image_ref:'blob:fixture',seed:request.seed})));
  }));
  if (path.includes('/progress/')) return json({progress:{phase:'Waiting for fixture completion',step:1,total_steps:24}});
  if (path.startsWith('/image-generation/')) return json({});
  if (path.startsWith('/sessions/')) return json([]);
  return originalFetch(input, options);
};
// Image URLs target the same fixture server, while fetch above handles JSON.
const settings = {modelId:'fixture',prompt:'Preview fixture',negativePrompt:'',width:512,height:512,steps:24,guidanceScale:5.5,seed:'1',loraId:''};
function FixtureControls() {
  const generation = useImageGeneration();
  return <div>
    <button onClick={() => generation.generateBatch([1,2,3,4].map(seed => ({settings:{...settings,seed:String(seed)}})))}>Start fixture batch</button>
    <button onClick={() => generation.generate(settings)}>Start fixture single</button>
    <button onClick={() => pending.shift()?.()}>Complete next fixture image</button>
    <button onClick={() => setTimeout(() => pending.shift()?.(), 1500)}>Complete next image after delay</button>
    <button onClick={async () => { await originalFetch('/__fixture/fail-next-preview'); pending.shift()?.(); }}>Complete with preview load failure</button>
    <button onClick={() => { failNextSave = true; }}>Fail next prompt save</button>
    <p role="status">{generation.requests.length} fixture requests pending</p>
  </div>;
}
function FixtureApp() {
  const [tab,setTab] = useState('generate');
  return <AppLayout activeTab={tab} sidebar={() => <><button onClick={() => setTab('generate')}>Show Generate</button><button onClick={() => setTab('library')}>Show Prompt Index</button><FixtureControls/></>}>
    <div className="pane" hidden={tab !== 'generate'}><ImageStudio active={tab === 'generate'}/></div>
    <div className="pane" hidden={tab !== 'library'}><PromptIndex active={tab === 'library'}/></div>
  </AppLayout>
}
createRoot(document.getElementById('root')).render(<StoreProvider><ImageDestinationsProvider><ImageGenerationProvider><FixtureApp/>
</ImageGenerationProvider></ImageDestinationsProvider></StoreProvider>);
