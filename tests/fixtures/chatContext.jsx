import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider, useDispatch } from '../../src/useStore';
import Header from '../../src/components/Header';
import SettingsPanel from '../../src/components/SettingsPanel';
import '../../src/styles.css';

window.fetch = async () => new Response(JSON.stringify({ items: [], models: [], requests: [] }), { headers: { 'Content-Type': 'application/json' } });
function Preview() {
  const dispatch = useDispatch();
  useEffect(() => {
    dispatch({type:'SET_MODELS',payload:[{name:'fixture-vision',contextLength:8192,capabilities:['completion','vision']}]});
    dispatch({type:'SET_SELECTED_MODEL',payload:'fixture-vision'});
    dispatch({type:'SET_CONNECTED',payload:true});
    dispatch({type:'SET_SESSION',payload:{id:'context-preview',title:'Image context check',messages:[
      {role:'user',content:'Compare the pictures.'}, {role:'assistant',content:'The first is red; the second is blue.',context_usage:{model:'fixture-vision',prompt_tokens:1200,count_kind:'provider_reported',generated_tokens:200,
        adjustments:['2 images analyzed separately. This reply uses condensed observations; original images remain saved for closer inspection.']}},
      {role:'user',content:'Summarize the difference.'}, {role:'assistant',content:'Their colors differ.'},
    ],memorySummary:'Goals: compare reference pictures.\nConstraints: preserve the original images.\nOpen questions: inspect small text in a closer crop.',summarizedMessageCount:2}});
  }, [dispatch]);
  return <div id="app"><main id="main"><Header onCompactMemory={()=>{}} /><SettingsPanel /><p style={{padding:24}}>Isolated preview with synthetic conversation data. Open Chat options to inspect working memory and context notices.</p><label style={{padding:24}}>Message draft <input aria-label="Message draft" /></label></main></div>;
}
createRoot(document.getElementById('root')).render(<StoreProvider><Preview /></StoreProvider>);
