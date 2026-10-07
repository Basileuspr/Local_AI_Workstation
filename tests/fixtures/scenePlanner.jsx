import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import ScenePlanner from '../../src/components/ScenePlanner';
import * as api from '../../src/imageWorkflowApi';
import {previewSceneAction} from '../../src/scenePlanner';
import '../../src/styles.css';

let workflow={id:'a'.repeat(32),revision:2,scene:{state:{character:{clothing:'blue shirt'},body:{wrist_rotation:'neutral'},objects:[]}}};
let saved;
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
window.fetch=async (url,options={}) => {
  const path=new URL(url,window.location.href).pathname;
  if(path.endsWith('/scene-planner/models'))return response({models:[{id:'test-model',name:'Synthetic test model'}]});
  if(path.endsWith('/scene/plans') && !options.body)return response({plans:saved ? [saved] : []});
  if(path.endsWith('/stop'))return response({stopped:true});
  const input=JSON.parse(options.body || '{}');
  if(path.endsWith('/scene/plans')) {
    if(input.intention==='wait for cancellation') await new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true}));
    saved={id:input.request_id,workflow_id:workflow.id,revision:workflow.revision,base_state:structuredClone(workflow.scene.state),proposal:{summary:'Small visible wrist change',uncertainties:['Exact rotation angle was not specified'],actions:[
      {description:'Rotate wrist slightly',changes:{body:{wrist_rotation:'slightly clockwise'}}},
      {description:'Change clothing to red',changes:{character:{clothing:'red shirt'}}},
    ]}};
    return response(saved,201);
  }
  if(path.endsWith('/apply')) {
    let state=workflow.scene.state;
    for(const index of input.selected_actions.sort())state=previewSceneAction(state,saved.proposal.actions[index]);
    workflow={...workflow,revision:workflow.revision+1,scene:{state}};
    return response(workflow);
  }
  throw new Error('Unexpected fixture request');
};
function Fixture() {
  const [draft,setDraft]=useState(workflow);
  return <main className="image-workflows" style={{maxWidth:700,margin:'24px auto',fontFamily:'sans-serif',height:'100vh',overflow:'auto'}}>
    <h1>Scene planner review fixture</h1><p>Synthetic responses; no inference or user data.</p>
    <ScenePlanner workflow={draft} active={true} busy={false}
      onPropose={(input,signal)=>api.planScene(draft,input,signal)}
      onApply={async (id,selection)=>setDraft(await api.applyScenePlan(draft,id,selection))}/>
    <h2>Saved scene</h2><pre id="saved-state">{JSON.stringify(draft.scene.state,null,2)}</pre>
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
