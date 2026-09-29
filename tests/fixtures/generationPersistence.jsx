import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {StoreProvider,useStore,useDispatch} from '../../src/useStore';
import {ImageGenerationProvider} from '../../src/ImageGenerationContext';
import {ImageDestinationsProvider} from '../../src/ImageDestinations';
import {PromptQueueProvider} from '../../src/components/PromptQueue';
import AppLayout from '../../src/components/AppLayout';
import SidebarNavigation from '../../src/components/SidebarNavigation';
import ImageStudio from '../../src/components/ImageStudio';
import {GifMakerWorkspace} from '../../src/components/GifMaker';
import {apiUrl} from '../../src/api';
import {saveNavigation} from '../../src/navigation';
import {savePreferences,pickPreferences} from '../../src/preferences';
import '../../src/styles.css';

function Fixture() {
  const state = useStore(), dispatch = useDispatch(), tab = state.activeSidebarTab;
  const [evidence,setEvidence] = useState({started:[],cancelled:[]});
  useEffect(() => { saveNavigation(tab,state.currentSessionId); savePreferences(pickPreferences(state)); },[tab,state.imageSettings,state.currentSessionId]);
  useEffect(() => {
    let disposed = false;
    const refresh = () => fetch(apiUrl('/qa/state')).then(response => response.json()).then(value => { if(!disposed)setEvidence(value); });
    const timer = setInterval(refresh,500); refresh();
    return () => {disposed=true;clearInterval(timer);};
  },[]);
  return <AppLayout activeTab={tab} onRefresh={() => location.reload()} sidebar={() => <>
    <SidebarNavigation activeTab={tab} onSelect={value => dispatch({type:'SET_SIDEBAR_TAB',payload:value})}/>
    <button onClick={() => fetch(apiUrl('/qa/complete'),{method:'POST'})}>Complete fixture image</button>
    <button onClick={() => fetch(apiUrl('/qa/step'),{method:'POST'})}>Advance fixture step</button>
    <p aria-label="Backend task evidence">Started: {evidence.started.length} · Cancelled: {evidence.cancelled.length}</p>
    <p aria-label="Backend request IDs">{evidence.started.join(', ')}</p>
  </>}>
    <div className="pane" data-capture-tab="generate" hidden={tab!=='generate'}><ImageStudio active={tab==='generate'}/></div>
    <div className="pane" data-capture-tab="gif-maker" hidden={tab!=='gif-maker'}><GifMakerWorkspace active={tab==='gif-maker'}/></div>
    <div className="pane" hidden={['generate','gif-maker'].includes(tab)}><h1>Other workspace</h1><p>Generation remains owned by the backend.</p></div>
  </AppLayout>;
}
createRoot(document.getElementById('root')).render(<StoreProvider><PromptQueueProvider><ImageDestinationsProvider><ImageGenerationProvider><Fixture/></ImageGenerationProvider></ImageDestinationsProvider></PromptQueueProvider></StoreProvider>);
