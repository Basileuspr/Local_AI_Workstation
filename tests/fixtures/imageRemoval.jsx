import React,{useEffect,useReducer,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {StoreProvider,useDispatch,useStore} from '../../src/useStore';
import {ImageGenerationProvider} from '../../src/ImageGenerationContext';
import InputBar from '../../src/components/InputBar';
import ImageBatchOutput from '../../src/components/ImageBatchOutput';
import ImageViewer from '../../src/components/ImageViewer';
import FileConverter from '../../src/components/FileConverter';
import {emptyGenerationHistory,generationHistoryReducer as reduce,generationViewerImages} from '../../src/generationHistory';
import '../../src/styles.css';
import '../../src/components/ImageStudio.css';

// Isolated fixture: all API requests are intercepted; no real chats/models touched.
let savedMessages=[],failNext=false,notify=()=>{};
const realFetch=window.fetch.bind(window);
window.fetch=async(input,options={})=>{
 const path=new URL(input,location.href).pathname;
 const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
 if(path==='/image-generation/models')return json({models:[],loras:[],runtime:{ready:false}});
 if(path.endsWith('/messages/append')){
  if(failNext){failNext=false;return new Response(JSON.stringify({detail:'Fixture upload failure'}),{status:503});}
  savedMessages.push(...JSON.parse(options.body).messages);notify();
  return json({id:'fixture-chat',title:'Fixture',messages:savedMessages});
 }
 if(path==='/sessions/fixture-chat')return json({id:'fixture-chat',title:'Fixture',messages:savedMessages});
 if(path==='/chat')return new Response('data: {"token":"Fixture reply","done":true}\n\n',{headers:{'Content-Type':'text/event-stream'}});
 if(path.startsWith('/sessions/')||path.startsWith('/queue')||path.startsWith('/image-generation/'))return json({});
 if(path.startsWith('/tests/'))return realFetch(input,options);
 throw new Error(`Unexpected fixture request: ${path}`);
};
function initial(){
 let state=reduce(emptyGenerationHistory,{type:'start-batch',id:'fixture',requestIds:['a','b','c','d']});
 for(const [index,id] of ['a','b','c','d'].entries())state=reduce(state,{type:'complete',image:{url:`/tests/fixtures/generatePreview.svg?i=${index}`,filename:`image-${index+1}`,seed:index+1,request_id:id,batch_id:'fixture'}});
 return state;
}
function Fixture(){
 const dispatch=useDispatch(),store=useStore();
 const [history,update]=useReducer(reduce,undefined,initial),[selected,setSelected]=useState(null),[count,setCount]=useState(0);
 useEffect(()=>{notify=()=>setCount(savedMessages.length);},[]);
 const remove=images=>update({type:'remove',urls:images.map(image=>image.url)});
 return <main style={{padding:20,maxWidth:1200,margin:'auto'}}>
  <style>{'.image-batch-output-preview{height:130px;overflow:hidden}.image-batch-output-preview img{width:100%;height:100%;object-fit:contain}.image-batch-output-grid{grid-template-columns:repeat(4,minmax(0,1fr))}'}</style>
  <h1>Image removal checks</h1><p>Test images only. Original files stay unchanged.</p>
  <ImageBatchOutput batch={history.batch} onRemove={remove} onEdit={()=>{}} onCopy={()=>{}} onOpen={image=>setSelected(image.url)}/>
  <ImageViewer images={generationViewerImages(history.images,url=>url)} selectedId={selected} onSelect={setSelected} onClose={()=>setSelected(null)} onRemove={remove}/>
  <h2>Pending chat attachments</h2><p>Saved attachment messages: {count}</p>
  <p>Current chat: {store.currentSessionId || 'none'}</p>
  <button onClick={()=>{failNext=true;}}>Fail next attachment save</button>
  <InputBar onNewChat={async()=>{const session={id:'fixture-chat',messages:savedMessages,title:'Fixture'};dispatch({type:'SET_SESSION',payload:session});return session;}}/>
  {store.toast && <p role="alert">{store.toast.message}</p>}
  <FileConverter/>
 </main>;
}
createRoot(document.getElementById('root')).render(<StoreProvider><ImageGenerationProvider><Fixture/></ImageGenerationProvider></StoreProvider>);
