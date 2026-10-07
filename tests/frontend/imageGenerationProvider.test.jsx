import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {parseHTML} from 'linkedom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ImageGenerationProvider,useImageGeneration} from '../../src/ImageGenerationContext';
import * as api from '../../src/api';

let state,refs,dispatch,subscriber,context,root;
vi.mock('../../src/useStore',()=>({useStore:()=>state,useRefs:()=>refs,useDispatch:()=>dispatch}));
vi.mock('../../src/appPolling',()=>({imageTasksObserver:()=>({subscribe:listener=>{subscriber=listener;return ()=>{};}})}));
vi.mock('../../src/api',()=>({loadImageGenerationModels:vi.fn(),listSessionImageInventory:vi.fn(),loadSession:vi.fn(),imageGenerationTasks:vi.fn(),stopImageGeneration:vi.fn()}));
const catalog={models:[{id:'fixture',name:'Fixture'}],loras:[],runtime:{ready:true}};
function Harness(){context=useImageGeneration();return <p>{context.batch?.slots.map(slot=>slot.status).join(',')}</p>;}
beforeEach(()=>{
  const {window,document}=parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window',window);vi.stubGlobal('document',document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.stubGlobal('sessionStorage',{getItem:()=> 'fixture-client',setItem:()=>{}});
  state={currentSessionId:'chat',selectedModel:'model',isGenerating:false,conversationHistory:[],sessionRevision:'rev',imageSettings:{modelId:'fixture',loraId:''},sessions:[]};
  refs={};dispatch=vi.fn();vi.clearAllMocks();
  api.loadImageGenerationModels.mockResolvedValue(catalog);
  api.listSessionImageInventory.mockResolvedValue({images:[],hiddenImages:[]});
  api.loadSession.mockResolvedValue({id:'chat',revision:'saved',messages:[],title:'Fixture'});
  root=createRoot(document.getElementById('root'));
});
afterEach(async()=>{await act(async()=>root.unmount());vi.unstubAllGlobals();});
async function mount(){await act(async()=>root.render(<ImageGenerationProvider><Harness/></ImageGenerationProvider>));}
it('keeps a saved adapter selection while the first catalog is still loading',async()=>{
  let resolve;state.imageSettings.loraId='saved-adapter';
  api.loadImageGenerationModels.mockImplementation(()=>new Promise(done=>{resolve=done;}));
  await mount();
  expect(dispatch.mock.calls.some(([action])=>action.type==='CLEAR_UNAVAILABLE_IMAGE_LORA')).toBe(false);
  await act(async()=>resolve(catalog));
  expect(dispatch.mock.calls.filter(([action])=>action.type==='CLEAR_UNAVAILABLE_IMAGE_LORA')).toHaveLength(1);
});
it('keeps completed output when an older POST acknowledgement arrives after a poll',async()=>{
  let resolve;api.imageGenerationTasks.mockImplementation(()=>new Promise(done=>{resolve=done;}));
  await mount();await act(async()=>subscriber.data({backend_id:'run',snapshot_sequence:1,tasks:[]}));
  const settings={modelId:'fixture',prompt:'Neutral fixture',negativePrompt:'',width:512,height:512,steps:4,guidanceScale:5.5,seed:0,loraId:'',longPrompt:true};
  let submitted;
  await act(async()=>{submitted=context.generateBatch([{settings},{settings}]);await Promise.resolve();});
  const body=api.imageGenerationTasks.mock.calls[0][1];
  const tasks=body.requests.map((request,index)=>({...request,batch_id:body.batch_id,batch_index:index,batch_count:2,status:'completed',result:{url:`/output-${index}.png`,request_id:request.request_id,batch_id:body.batch_id,session_id:'chat'}}));
  await act(async()=>subscriber.data({backend_id:'run',snapshot_sequence:3,tasks}));
  await act(async()=>{resolve({backend_id:'run',snapshot_sequence:2,tasks:tasks.map(task=>({...task,status:'queued',result:null}))});await submitted;});
  expect(context.requests).toHaveLength(0);
  expect(context.generatedImages).toHaveLength(2);
  expect(context.batch.slots.map(slot=>slot.status)).toEqual(['complete','complete']);
});
