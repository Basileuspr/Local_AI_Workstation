import { useEffect, useRef, useState } from 'react';
import FreshFileInput from './FreshFileInput';
import * as api from '../imageWorkflowApi';
import { openEditorImage } from '../imageEditorSession';
import { combineMagicResult, magicSize, magicStage, maskBlob, paintMask, prepareMagicInput, REFERENCE_ROLES, uploadMagicAsset } from '../imageMagic';

export default function ImageMagic({session,preview,getSource,onAccept,onBusy,reference,disabled,requestedEdit}) {
  const [catalog,setCatalog]=useState(null),[model,setModel]=useState(''),[vision,setVision]=useState('');
  const [prompt,setPrompt]=useState(''),[guidance,setGuidance]=useState(''),[strength,setStrength]=useState(.25);
  const [refs,setRefs]=useState([]),[scope,setScope]=useState('all'),[strokes,setStrokes]=useState([]),[radius,setRadius]=useState(5);
  const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState(''),[candidate,setCandidate]=useState(null);
  const [compare,setCompare]=useState(false),[progress,setProgress]=useState(null);
  const canvas=useRef(),drawing=useRef(false),strokeRef=useRef([]),job=useRef(),cancelled=useRef(false),mounted=useRef(true),busyRef=useRef(false),refsRef=useRef([]);
  useEffect(()=>{refsRef.current=refs;},[refs]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;cancelled.current=true;if(job.current)api.stop(...job.current).catch(()=>{});refsRef.current.forEach(r=>URL.revokeObjectURL(r.url));};},[]);
  useEffect(()=>()=>{if(candidate){URL.revokeObjectURL(candidate.url);URL.revokeObjectURL(candidate.sourceUrl);}},[candidate]);
  useEffect(()=>{strokeRef.current=strokes;if(canvas.current)paintMask(canvas.current,strokes,null,'rgba(65,210,255,.5)');},[strokes,scope,preview]);
  useEffect(()=>{
    if(!requestedEdit || busyRef.current)return;
    setPrompt(requestedEdit.prompt);setGuidance('');setScope('paint');setCandidate(null);setError('');
    const existing=refsRef.current.find(r=>r.sourceReference===reference?.url);
    if(requestedEdit.useReference && reference?.file){
      if(!existing && refsRef.current.length>=4){setError('The request is ready, but all four reference slots are in use. Remove one reference, then prepare this request again to include the source skin tone.');setStatus('');return;}
      setRefs(items=>existing?items.map(r=>r.id===existing.id?{...r,role:'Character skin tone'}:r):[...items,{id:crypto.randomUUID(),file:reference.file,url:URL.createObjectURL(reference.file),sourceReference:reference.url,role:'Character skin tone'}]);
    }
    setStatus('Request prepared. Read the reference guidance, mark the area to correct, then generate a candidate.');
  },[requestedEdit]);
  const imageProvider=catalog?.providers?.find(p=>p.id==='local-sdxl');
  const visionProvider=catalog?.providers?.find(p=>p.id==='ollama-vision');
  async function discover(){
    if(busyRef.current)return;
    setError('');try{const data=await api.catalog();if(!mounted.current)return;setCatalog(data);setModel(data.providers.find(p=>p.id==='local-sdxl')?.models[0]?.id||'');setVision(data.providers.find(p=>p.id==='ollama-vision')?.models[0]?.id||'');}catch(e){setError(e.message);}
  }
  async function addReference(file){
    if(!file || busyRef.current || disabled)return;
    setError('');try{
      const loaded=await openEditorImage(file);loaded.close();
      if(!mounted.current)return;
      const normalized=new File([loaded.blob],file.name.replace(/\.[^.]+$/,'.png'),{type:'image/png'});
      setRefs(items=>items.length>=4?items:[...items,{id:crypto.randomUUID(),file:normalized,url:URL.createObjectURL(loaded.blob),role:REFERENCE_ROLES[items.length===1?1:0]}]);
    }catch(e){setError(e.message);}
  }
  const ensureActive=()=>{if(cancelled.current || !mounted.current)throw new Error('Edit stopped. Your current image is unchanged.');};
  async function waitRun(workflow){
    ensureActive();const started=await api.execute(workflow);job.current=[workflow.id,started.id];
    if(cancelled.current || !mounted.current){await api.stop(...job.current);ensureActive();}
    let run=started;
    while(['queued','running','cancelling'].includes(run.status)){
      setStatus(run.phase||run.status);setProgress(run.total_steps?{value:run.step,max:run.total_steps}:null);
      await new Promise(resolve=>setTimeout(resolve,750));run=await api.runState(...job.current);
    }
    job.current=null;ensureActive();if(run.status!=='completed')throw new Error(run.error||`Edit ${run.status}.`);
    return run;
  }
  async function run(kind){
    if(!session || busyRef.current || disabled)return;
    busyRef.current=true;cancelled.current=false;setBusy(true);onBusy(true);setError('');setCandidate(null);setProgress(null);
    try{
      if(!prompt.trim())throw new Error('Describe the image and the change you want.');
      if(kind==='edit' && scope==='paint' && !strokes.length)throw new Error('Paint the area to edit, or select Whole image.');
      const source=await getSource();ensureActive();setStatus('Preparing a copy of the current edited image…');
      const working = kind === 'edit' ? await prepareMagicInput(source.blob) : null;
      ensureActive();
      let workflow=await api.create();ensureActive();
      const uploaded=await uploadMagicAsset(workflow,new File([working?.blob || source.blob],working?'editor-working-copy.png':'editor-source.png',{type:'image/png'}));workflow=uploaded.workflow;
      const sourceId=uploaded.id;
      if(kind==='guidance'){
        const ids=[],roles=[];
        for(const ref of refs){ensureActive();const added=await uploadMagicAsset(workflow,ref.file);workflow=added.workflow;ids.push(added.id);roles.push(ref.role);}
        workflow={...workflow,name:'Image Editor · reference guidance',prompt_settings:{...workflow.prompt_settings,prompt},stages:[{...magicStage(sourceId,vision,magicSize(source.width,source.height)),operation:'describe',provider_slot:'ollama-vision',analysis_kind:'edit_guidance',reference_asset_ids:ids,reference_roles:roles}]};
      }else{
        let mask=null;
        if(scope==='paint'){const blob=await maskBlob(source.width,source.height,strokes,working.layout);ensureActive();const added=await uploadMagicAsset(workflow,new File([blob],'edit-mask.png',{type:'image/png'}));workflow=added.workflow;mask=added.id;}
        workflow={...workflow,name:'Image Editor · Magic Edit',prompt_settings:{...workflow.prompt_settings,prompt:[prompt,guidance].filter(Boolean).join('\n'),steps:30,guidance:6},stages:[{...magicStage(sourceId,model,magicSize(source.width,source.height),mask),strength}]};
      }
      ensureActive();workflow=await api.save(workflow);const run=await waitRun(workflow);ensureActive();
      if(kind==='guidance'){
        setGuidance(run.stage_results?.[0]?.text||'');setStatus('Reference guidance ready. Review or revise it before generating.');
      }else{
        const output=run.outputs?.[0];if(!output)throw new Error('The model returned no image.');
        const response=await fetch(api.outputUrl(workflow.id,run.id,output.id));if(!response.ok)throw new Error('Could not load the edited candidate.');
        const combined=await combineMagicResult(source.blob,await response.blob(),scope==='paint'?strokes:null,working.layout);ensureActive();
        setCandidate({blob:combined,url:URL.createObjectURL(combined),sourceUrl:URL.createObjectURL(source.blob)});setCompare(false);setStatus('Candidate ready. Compare it with the current source, then accept or discard.');
      }
    }catch(e){if(mounted.current)setError(e.message);}
    finally{busyRef.current=false;job.current=null;if(mounted.current){setBusy(false);setProgress(null);onBusy(false);}}
  }
  async function stop(){cancelled.current=true;setStatus('Stopping…');if(job.current)try{await api.stop(...job.current);}catch(e){setError(e.message);}}
  function point(e){const box=e.currentTarget.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-box.left)/box.width)),y:Math.max(0,Math.min(1,(e.clientY-box.top)/box.height))};}
  function draw(e,start=false){
    if(busy || disabled)return;
    if(start){drawing.current=true;e.currentTarget.setPointerCapture(e.pointerId);strokeRef.current=[...strokeRef.current,{radius:radius/100,points:[point(e)]}];}
    else if(drawing.current){const last=strokeRef.current.at(-1);last.points.push(point(e));}else return;
    setStrokes(strokeRef.current.map(s=>({...s,points:[...s.points]})));
  }
  return <details className="ie-magic" onToggle={e=>{if(e.currentTarget.open&&!catalog)discover();}}><summary>Magic Edit &amp; AI refinement</summary>
    <p>Describe the desired result. For a specific correction, paint the area to change. Installed local models create a candidate for review.</p>
    {error&&<p role="alert" className="ie-error">{error}</p>}
    <fieldset disabled={busy||disabled||!session}>
      <label>Edit request<textarea aria-label="Magic edit request" rows="3" maxLength="6000" value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Keep the current pose and lines. Use the reference background style and the character reference's skin tone."/></label>
      <button onClick={()=>{setPrompt('Refine this image: clean compression artifacts, improve fine edges and natural texture, preserve the same subject, pose, colors and composition.');setStrength(.2);}}>Use detail refinement prompt</button>
      <label>Change area<select value={scope} onChange={e=>setScope(e.target.value)}><option value="all">Whole image</option><option value="paint">Paint an area</option></select></label>
      {scope==='paint'&&<><p>Drag over the area to edit. Blue is selected; everything outside it is preserved in the accepted image.</p><div className="ie-mask-stage"><img src={preview} alt="Current image for marking the edit area" onLoad={e=>{if(canvas.current){canvas.current.width=e.currentTarget.naturalWidth;canvas.current.height=e.currentTarget.naturalHeight;paintMask(canvas.current,strokes,null,'rgba(65,210,255,.5)');}}}/><canvas ref={canvas} aria-label="Paint the image area to edit" onPointerDown={e=>draw(e,true)} onPointerMove={e=>draw(e)} onPointerUp={()=>{drawing.current=false;}} onPointerCancel={()=>{drawing.current=false;}}/></div><label>Brush radius: {radius}%<input type="range" min="1" max="25" value={radius} onChange={e=>setRadius(Number(e.target.value))}/></label><button onClick={()=>setStrokes(items=>items.slice(0,-1))}>Undo mask stroke</button><button onClick={()=>setStrokes([])}>Clear edit area</button></>}
      <details><summary>Reference roles · {refs.length} images</summary><p>References are read by the selected vision model into editable text guidance. Generation uses that text and the current image; it does not directly condition on reference pixels.</p>
        <label className="ie-import">Add reference image<FreshFileInput aria-label="Add Magic Edit reference" accept="image/png,image/jpeg,image/webp" disabled={busy||disabled||refs.length>=4} onChange={e=>{const f=e.target.files?.[0];e.target.value='';addReference(f);}}/></label>
        {reference?.file&&<button disabled={refs.length>=4} onClick={()=>addReference(reference.file)}>Add current reference source</button>}
        {refs.map(ref=><div key={ref.id} className="ie-magic-reference"><img src={ref.url} alt={ref.file.name}/><label>Use this reference for<select value={ref.role} onChange={e=>setRefs(items=>items.map(r=>r.id===ref.id?{...r,role:e.target.value}:r))}>{REFERENCE_ROLES.map(role=><option key={role}>{role}</option>)}</select></label><button onClick={()=>{URL.revokeObjectURL(ref.url);setRefs(items=>items.filter(r=>r.id!==ref.id));}}>Remove reference</button></div>)}
        <label>Vision model<select aria-label="Reference vision model" value={vision} onChange={e=>setVision(e.target.value)}><option value="">Choose installed model</option>{visionProvider?.models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <button disabled={!vision||!refs.length||!prompt.trim()} onClick={()=>run('guidance')}>Read references into guidance</button>{!vision&&<p>An installed vision model is required to read references. You can also write the guidance yourself below.</p>}
      </details>
      <label>Reference guidance to apply<textarea aria-label="Reference guidance to apply" rows="4" maxLength="5000" value={guidance} onChange={e=>setGuidance(e.target.value)} placeholder="Review reference observations here, or describe the background style and skin tone yourself."/></label>
      <label>Image model<select aria-label="Magic Edit image model" value={model} onChange={e=>setModel(e.target.value)}><option value="">Choose installed model</option>{imageProvider?.models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <label>Change strength: {Math.round(strength*100)}%<input aria-label="Magic Edit strength" type="range" min=".05" max=".8" step=".05" value={strength} onChange={e=>setStrength(Number(e.target.value))}/></label>
      <p>Lower strength stays closer to the image. AI may change or invent details. Small images use a larger working copy for stable editing. Proportions are preserved, and the accepted image keeps its original dimensions.</p>
      <button disabled={!model||!imageProvider?.available||!prompt.trim()} onClick={()=>run('edit')}>Generate edited candidate</button>
      {catalog&&(!imageProvider?.available||!model)&&<p>Magic Edit needs an installed compatible SDXL model and a working CUDA runtime. No models or dependencies are downloaded here.</p>}
    </fieldset>
    <button disabled={busy} onClick={discover}>Refresh installed models</button>
    {busy&&<button onClick={stop}>Stop Magic Edit</button>}
    {status&&<p role="status">{status}</p>}{busy&&<progress aria-label="Magic Edit progress" {...(progress||{})}/>}
    {candidate&&<div className="ie-magic-candidate"><img src={compare?candidate.sourceUrl:candidate.url} alt={compare?'Source before Magic Edit':'Magic Edit candidate'}/><button onClick={()=>setCompare(v=>!v)}>{compare?'Show candidate':'Compare source'}</button><button disabled={disabled} onClick={async()=>{try{await onAccept(new File([candidate.blob],'magic-edited.png',{type:'image/png'}));setCandidate(null);}catch(e){setError(e.message);}}}>Use this edited image</button><button onClick={()=>setCandidate(null)}>Discard candidate</button></div>}
  </details>;
}
