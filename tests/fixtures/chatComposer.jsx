import React, {useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {StoreProvider, useDispatch} from '../../src/useStore';
import {ImageGenerationProvider} from '../../src/ImageGenerationContext';
import {ImageDestinationsProvider} from '../../src/ImageDestinations';
import InputBar from '../../src/components/InputBar';
import '../../src/styles.css';

// Isolated UI preview: no live backend, microphone, or inference is required.
window.fetch = async input => {
  const path = new URL(input, location.href).pathname;
  const json = value => new Response(JSON.stringify(value), {headers:{'Content-Type':'application/json'}});
  if (path === '/image-generation/models') return json({models:[{id:'fixture',name:'Preview image model'}],loras:[],runtime:{ready:true}});
  if (path === '/image-generation/tasks') return json({tasks:[]});
  if (path === '/audio/status') return json({installed:true,models:{turbo:{model:'Whisper Turbo',ready:true,model_ready:true}},speakers:{ready:true}});
  if (path === '/request-queue') return json({requests:[]});
  return json({detail:`Preview does not handle ${path}`});
};
function Preview() {
  const dispatch = useDispatch();
  useEffect(() => {dispatch({type:'SET_IMAGE_SETTINGS',payload:{modelId:'fixture',loraId:''}});}, [dispatch]);
  return <div id="app"><main id="main" style={{width:'100%'}}>
    <header style={{padding:'18px 24px',borderBottom:'1px solid var(--border)'}}>Chat · Layout preview</header>
    <div className="pane chat-pane">
      <div id="messages"><div id="welcome"><h2>What would you like to work on?</h2><p>Write a message, attach a file, or choose a tool below.</p></div></div>
      <InputBar/>
    </div>
  </main></div>;
}
createRoot(document.getElementById('root')).render(<StoreProvider><ImageDestinationsProvider><ImageGenerationProvider><Preview/></ImageGenerationProvider></ImageDestinationsProvider></StoreProvider>);
