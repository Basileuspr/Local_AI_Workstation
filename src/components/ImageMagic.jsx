import { useEffect, useRef, useState } from 'react';
import FreshFileInput from './FreshFileInput';
import {useImageRemoval} from './ImageRemovalControls';
import ImageGenerationSizing from './ImageGenerationSizing';
import * as api from '../imageWorkflowApi';
import { openEditorImage } from '../imageEditorSession';
import { combineMagicResult, combineMagicUpscale, combineMagicOutpaint, magicOutpaintLayout, magicEditStage, magicProvider, preferredMagicModel, preferredMagicVisionModel, MAGIC_MODES, MAGIC_DEFAULTS, magicSize, magicStage, maskBlob, paintMask, prepareMagicInput, REFERENCE_ROLES, uploadMagicAsset } from '../imageMagic';

export default function ImageMagic({session,imageSize,preview,getSource,onAccept,onBusy,reference,disabled,requestedEdit}) {
  const [catalog,setCatalog]=useState(null),[model,setModel]=useState(''),[vision,setVision]=useState('');
  const [prompt,setPrompt]=useState(''),[guidance,setGuidance]=useState(''),[strength,setStrength]=useState(MAGIC_DEFAULTS.strength);
  const [mode,setMode]=useState('refine'),[amount,setAmount]=useState(MAGIC_DEFAULTS.amount);
  const [controlScale,setControlScale]=useState(MAGIC_DEFAULTS.control_scale),[referenceScale,setReferenceScale]=useState(MAGIC_DEFAULTS.reference_scale);
  const [borders,setBorders]=useState({left:32,right:32,top:32,bottom:32}),[factor,setFactor]=useState(2);
  const [cannyLow,setCannyLow]=useState(100),[cannyHigh,setCannyHigh]=useState(200),[controlFile,setControlFile]=useState(null),[controlInput,setControlInput]=useState('source');
  const [refs,setRefs]=useState([]),[scope,setScope]=useState('all'),[strokes,setStrokes]=useState([]),[radius,setRadius]=useState(5);
  const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState(''),[candidate,setCandidate]=useState(null);
  const [compare,setCompare]=useState(false),[progress,setProgress]=useState(null);
  const removal=useImageRemoval(refs, removed=>{
    const ids=new Set(removed.map(item=>item.id));
    removed.forEach(item=>URL.revokeObjectURL(item.url));
    setRefs(items=>items.filter(item=>!ids.has(item.id)));
  },{label:'Magic Edit references',disabled:busy||disabled});
  const [workingSize,setWorkingSize]=useState({width:1024,height:1024,allow_long_wait:false});
  useEffect(()=>{
    if(session)setWorkingSize({...magicSize(imageSize?.width || session.width,imageSize?.height || session.height),allow_long_wait:false});
    setStrokes([]);setCandidate(null);
  },[session,imageSize?.width,imageSize?.height]);
  const canvas=useRef(),drawing=useRef(false),strokeRef=useRef([]),job=useRef(),cancelled=useRef(false),mounted=useRef(true),busyRef=useRef(false),refsRef=useRef([]);
  useEffect(()=>{refsRef.current=refs;},[refs]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;cancelled.current=true;if(job.current)api.stop(...job.current).catch(()=>{});refsRef.current.forEach(r=>URL.revokeObjectURL(r.url));};},[]);
  useEffect(()=>()=>{if(candidate){URL.revokeObjectURL(candidate.url);URL.revokeObjectURL(candidate.sourceUrl);}},[candidate]);
  useEffect(()=>{strokeRef.current=strokes;if(canvas.current)paintMask(canvas.current,strokes,null,'rgba(65,210,255,.5)');},[strokes,scope,preview]);
  useEffect(()=>{
    if(!requestedEdit || busyRef.current)return;
    setPrompt(requestedEdit.prompt);setGuidance('');setMode('refine');setScope('paint');setCandidate(null);setError('');
    const existing=refsRef.current.find(r=>r.sourceReference===reference?.url);
    if(requestedEdit.useReference && reference?.file){
      if(!existing && refsRef.current.length>=8){setError('The request is ready, but all eight reference slots are in use. Remove one reference, then prepare this request again to include the source skin tone.');setStatus('');return;}
      setRefs(items=>existing?items.map(r=>r.id===existing.id?{...r,role:'Character skin tone'}:r):[...items,{id:crypto.randomUUID(),file:reference.file,url:URL.createObjectURL(reference.file),sourceReference:reference.url,role:'Character skin tone'}]);
    }
    setStatus('Request prepared. Read the reference guidance, mark the area to correct, then generate a candidate.');
  },[requestedEdit]);
  const imageProvider=catalog?.providers?.find(p=>p.id===magicProvider(mode));
  const visionProvider=catalog?.providers?.find(p=>p.id==='ollama-vision');
  const changesSize=['outpaint','upscale'].includes(mode);
  useEffect(()=>{if(mode!=='upscale')setModel(current=>preferredMagicModel(imageProvider?.models,current));},[catalog,mode]);
  async function discover(){
    if(busyRef.current)return;
    setError('');try{const data=await api.catalog();if(!mounted.current)return;setCatalog(data);setVision(current=>preferredMagicVisionModel(data.providers.find(p=>p.id==='ollama-vision')?.models,current));}catch(e){setError(e.message);}
  }
  async function addReference(file){
    if(!file || busyRef.current || disabled)return;
    setError('');try{
      const loaded=await openEditorImage(file);loaded.close();
      if(!mounted.current)return;
      const normalized=new File([loaded.blob],file.name.replace(/\.[^.]+$/,'.png'),{type:'image/png'});
      setRefs(items=>items.length>=8?items:[...items,{id:crypto.randomUUID(),file:normalized,url:URL.createObjectURL(loaded.blob),role:REFERENCE_ROLES[items.length===1?1:0]}]);
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
      if((kind==='guidance'||mode!=='upscale')&&!prompt.trim())throw new Error('Describe the image and the change you want.');
      if(kind==='edit'&&!imageProvider?.available)throw new Error(imageProvider?.unavailable_reason||'This Magic Edit provider is not installed.');
      if(kind==='edit' && !changesSize && scope==='paint' && !strokes.length)throw new Error('Paint the area to edit, or select Whole image.');
      if(kind==='edit'&&mode==='references'&&!refs.length)throw new Error('Add at least one reference image.');
      if(kind==='edit'&&mode==='structure'&&controlInput==='map'&&!controlFile)throw new Error('Choose a Canny edge map or extract edges from the source.');
      const source=await getSource();ensureActive();setStatus('Preparing a copy of the current edited image…');
      const geometry=kind==='edit'&&mode==='outpaint'?magicOutpaintLayout(source.width,source.height,workingSize,borders):null;
      const working = kind === 'edit'&&mode!=='upscale' ? await prepareMagicInput(source.blob,geometry?.layout || workingSize) : null;
      ensureActive();
      let workflow=await api.create();ensureActive();
      const uploaded=await uploadMagicAsset(workflow,new File([working?.blob || source.blob],working?'editor-working-copy.png':'editor-source.png',{type:'image/png'}));workflow=uploaded.workflow;
      const sourceId=uploaded.id;
      if(kind==='guidance'){
        const ids=[],roles=[];
        for(const ref of refs){ensureActive();const added=await uploadMagicAsset(workflow,ref.file);workflow=added.workflow;const index=ids.indexOf(added.id);if(index<0){ids.push(added.id);roles.push(ref.role);}else if(!roles[index].includes(ref.role)){roles[index]+='; '+ref.role;}}
        workflow={...workflow,name:'Image Editor · reference guidance',prompt_settings:{...workflow.prompt_settings,prompt},stages:[{...magicStage(sourceId,vision,magicSize(source.width,source.height)),operation:'describe',provider_slot:'ollama-vision',analysis_kind:'edit_guidance',reference_asset_ids:ids,reference_roles:roles}]};
      }else{
        let mask=null;
        if(mode==='refine'&&scope==='paint'){const blob=await maskBlob(source.width,source.height,strokes,working.layout);ensureActive();const added=await uploadMagicAsset(workflow,new File([blob],'edit-mask.png',{type:'image/png'}));workflow=added.workflow;mask=added.id;}
        const ids=[];
        if(mode==='references')for(const ref of refs){ensureActive();const added=await uploadMagicAsset(workflow,ref.file);workflow=added.workflow;ids.push(added.id);}
        let controlId=null;
        if(mode==='structure'&&controlInput==='map'){const prepared=await prepareMagicInput(controlFile,workingSize);ensureActive();const added=await uploadMagicAsset(workflow,new File([prepared.blob],'canny-map.png',{type:'image/png'}));workflow=added.workflow;controlId=added.id;}
        const stage=magicEditStage(sourceId,model,geometry?.stageSize||workingSize,{mode,mask,references:ids,borders,strength,
          control_scale:controlScale,reference_scale:referenceScale,upscale_factor:factor});
        if(mode==='structure')Object.assign(stage,{control_input:controlInput,control_asset_id:controlId,canny_low:cannyLow,canny_high:cannyHigh});
        workflow={...workflow,name:`Image Editor · Magic Edit · ${mode}`,scene_notes:JSON.stringify({magic_edit:{mode,result_amount:mode==='outpaint'?null:amount,scope:changesSize?'all':scope,source_size:[source.width,source.height],borders:geometry?borders:null}}),prompt_settings:{...workflow.prompt_settings,prompt:[prompt,guidance].filter(Boolean).join('\n'),steps:MAGIC_DEFAULTS.steps,guidance:MAGIC_DEFAULTS.guidance},stages:[stage]};
      }
      ensureActive();workflow=await api.save(workflow);const run=await waitRun(workflow);ensureActive();
      if(kind==='guidance'){
        setGuidance(run.stage_results?.[0]?.text||'');setStatus('Reference guidance ready. Review or revise it before generating.');
      }else{
        const output=run.outputs?.[0];if(!output)throw new Error('The model returned no image.');
        const response=await fetch(api.outputUrl(workflow.id,run.id,output.id));if(!response.ok)throw new Error('Could not load the edited candidate.');
        const raw=await response.blob();ensureActive();
        const extended=mode==='outpaint'?await combineMagicOutpaint(source.blob,raw,geometry):null;
        const combined=extended?.blob || (mode==='upscale'?await combineMagicUpscale(source.blob,raw,factor,amount):await combineMagicResult(source.blob,raw,scope==='paint'?strokes:null,working.layout,amount));ensureActive();
        const dimensions=await createImageBitmap(combined);const size=`${dimensions.width} × ${dimensions.height}`;dimensions.close();ensureActive();
        setCandidate({blob:combined,url:URL.createObjectURL(combined),sourceUrl:URL.createObjectURL(source.blob),size,mode});setCompare(false);setStatus('Candidate ready. Compare it with the current source, then accept or discard.');
      }
    }catch(e){if(mounted.current)setError(e.message);}
    finally{busyRef.current=false;job.current=null;if(mounted.current){setBusy(false);setProgress(null);onBusy(false);}}
  }
  function gentleDefaults(){setStrength(MAGIC_DEFAULTS.strength);setAmount(MAGIC_DEFAULTS.amount);setControlScale(MAGIC_DEFAULTS.control_scale);setReferenceScale(MAGIC_DEFAULTS.reference_scale);setFactor(2);setBorders({left:32,right:32,top:32,bottom:32});setCannyLow(100);setCannyHigh(200);}
  async function stop(){cancelled.current=true;setStatus('Stopping…');if(job.current)try{await api.stop(...job.current);}catch(e){setError(e.message);}}
  function point(e){const box=e.currentTarget.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-box.left)/box.width)),y:Math.max(0,Math.min(1,(e.clientY-box.top)/box.height))};}
  function draw(e,start=false){
    if(busy || disabled)return;
    if(start){drawing.current=true;e.currentTarget.setPointerCapture(e.pointerId);strokeRef.current=[...strokeRef.current,{radius:radius/100,points:[point(e)]}];}
    else if(drawing.current){const last=strokeRef.current.at(-1);last.points.push(point(e));}else return;
    setStrokes(strokeRef.current.map(s=>({...s,points:[...s.points]})));
  }
  return <details className="ie-magic" onToggle={e=>{if(e.currentTarget.open&&!catalog)discover();}}><summary>Magic Edit &amp; AI refinement</summary>

    {error&&<p role="alert" className="ie-error">{error}</p>}
    <fieldset disabled={busy||disabled||!session}>
      <label>Magic Edit mode<select aria-label="Magic Edit mode" value={mode} onChange={e=>{setMode(e.target.value);setCandidate(null);setError('');setStatus('');}}>{MAGIC_MODES.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <p>{MAGIC_MODES.find(item=>item.id===mode).help}</p>
      <button onClick={gentleDefaults}>Use gentle defaults</button>
      <label>Edit request<textarea aria-label="Magic edit request" rows="3" maxLength="6000" value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Keep the current pose and lines. Use the reference background style and the character reference's skin tone."/></label>
      {mode!=='upscale'&&<button onClick={()=>{setPrompt(mode==='outpaint'?'Extend only the surrounding background naturally, matching the existing lighting and room. Keep the same subject and composition. No new people.':'Refine this photograph subtly. Preserve the same face, expression, pose, clothing, colors and composition. Natural realistic texture.');setStrength(.2);}}>Use detail refinement prompt</button>}
      {!changesSize&&<label>Change area<select aria-label="Magic Edit change area" value={scope} onChange={e=>setScope(e.target.value)}><option value="all">Whole image</option><option value="paint">Paint an area</option></select></label>}
      {!changesSize&&scope==='paint'&&<><div className="ie-mask-stage"><img src={preview} alt="Current image for marking the edit area" onLoad={e=>{if(canvas.current){canvas.current.width=e.currentTarget.naturalWidth;canvas.current.height=e.currentTarget.naturalHeight;paintMask(canvas.current,strokes,null,'rgba(65,210,255,.5)');}}}/><canvas ref={canvas} aria-label="Paint the image area to edit" onPointerDown={e=>draw(e,true)} onPointerMove={e=>draw(e)} onPointerUp={()=>{drawing.current=false;}} onPointerCancel={()=>{drawing.current=false;}}/></div><label>Brush radius: {radius}%<input type="range" min="1" max="25" value={radius} onChange={e=>setRadius(Number(e.target.value))}/></label><button onClick={()=>setStrokes(items=>items.slice(0,-1))}>Undo mask stroke</button><button onClick={()=>setStrokes([])}>Clear edit area</button>{mode!=='refine'&&<p>The model guides the whole working image; only the painted region is composited into your candidate.</p>}</>}
      <details><summary>Reference roles · {refs.length} images</summary>
        <p>Up to eight images. Visual conditioning uses all attached references only in the IP-Adapter mode. Roles guide the optional vision description; they do not assign separate visual effects.</p>
        <label className="ie-import">Add reference image<FreshFileInput aria-label="Add Magic Edit reference" accept="image/png,image/jpeg,image/webp" disabled={busy||disabled||refs.length>=8} onChange={e=>{const f=e.target.files?.[0];e.target.value='';addReference(f);}}/></label>
        {reference?.file&&<button disabled={refs.length>=8} onClick={()=>addReference(reference.file)}>Add current reference source</button>}
        {removal.toolbar}
        {refs.map(ref=><div key={ref.id} className="ie-magic-reference"><img src={ref.url} alt={ref.file.name}/><label>Use this reference for<select value={ref.role} onChange={e=>setRefs(items=>items.map(r=>r.id===ref.id?{...r,role:e.target.value}:r))}>{REFERENCE_ROLES.map(role=><option key={role}>{role}</option>)}</select></label>{removal.controls(ref, `reference ${ref.file.name}`)}</div>)}
        <label>Vision model<select aria-label="Reference vision model" value={vision} onChange={e=>setVision(e.target.value)}><option value="">Choose installed model</option>{visionProvider?.models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <button disabled={!vision||!refs.length||!prompt.trim()} onClick={()=>run('guidance')}>Read references into guidance</button>{!vision&&<p>An installed vision model is required to read references. You can also write the guidance yourself below.</p>}
      </details>
      <label>Reference guidance to apply<textarea aria-label="Reference guidance to apply" rows="4" maxLength="5000" value={guidance} onChange={e=>setGuidance(e.target.value)} placeholder="Review reference observations here, or describe the background style and skin tone yourself."/></label>
      {['structure','references'].includes(mode)&&<p>Use a short prompt and condense reviewed guidance: these adapters accept one CLIP text chunk. Longer text is rejected instead of silently cut off.</p>}
      {mode!=='upscale'&&<label>Image model<select aria-label="Magic Edit image model" value={model} onChange={e=>setModel(e.target.value)}><option value="">Choose installed model</option>{imageProvider?.models?.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
      {!changesSize&&<label>Change strength: {Math.round(strength*100)}%<input aria-label="Magic Edit strength" type="range" min=".05" max=".5" step=".05" value={strength} onChange={e=>setStrength(Number(e.target.value))}/></label>}
      {mode!=='outpaint'&&<label>Result amount: {Math.round(amount*100)}%<input aria-label="Magic Edit result amount" type="range" min=".1" max="1" step=".05" value={amount} onChange={e=>setAmount(Number(e.target.value))}/><span>50% mixes equal parts source and generated result for a gentler change.</span></label>}
      {mode==='structure'&&<><label>Control influence<input aria-label="Magic Edit control influence" type="number" min="0" max="1" step=".05" value={controlScale} onChange={e=>setControlScale(Number(e.target.value))}/></label><label>Edge input<select aria-label="Magic Edit edge input" value={controlInput} onChange={e=>setControlInput(e.target.value)}><option value="source">Extract Canny edges from source</option><option value="map">Uploaded Canny edge map</option></select></label>{controlInput==='source'?<><label>Canny low<input aria-label="Magic Edit Canny low" type="number" min="0" max="254" value={cannyLow} onChange={e=>setCannyLow(Number(e.target.value))}/></label><label>Canny high<input aria-label="Magic Edit Canny high" type="number" min="1" max="255" value={cannyHigh} onChange={e=>setCannyHigh(Number(e.target.value))}/></label></>:<label>Prepared edge map<FreshFileInput aria-label="Magic Edit edge map" type="file" accept="image/png,image/jpeg,image/webp" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{const loaded=await openEditorImage(file);loaded.close();setControlFile(new File([loaded.blob],'canny-map.png',{type:'image/png'}));}catch(error){setControlFile(null);setError(error.message);}}}/>{controlFile&&<span>Edge map ready</span>}</label>}</>}
      {mode==='references'&&<label>Reference influence<input aria-label="Magic Edit reference influence" type="number" min="0" max="1" step=".05" value={referenceScale} onChange={e=>setReferenceScale(Number(e.target.value))}/></label>}
      {mode==='outpaint'&&<><p>New borders in working pixels (32 by default). The final candidate expands around the full-size original; it is not shrunk back.</p>{['left','right','top','bottom'].map(side=><label key={side}>New {side} border<input aria-label={`Magic Edit ${side} border`} type="number" min="0" max="256" step="8" value={borders[side]} onChange={e=>setBorders(value=>({...value,[side]:Number(e.target.value)}))}/></label>)}</>}
      {mode==='upscale'?<label>Size multiplier<select aria-label="Magic Edit upscale factor" value={factor} onChange={e=>setFactor(Number(e.target.value))}><option value="2">2× · gentle default</option><option value="3">3×</option><option value="4">4×</option></select></label>:<><p>AI working canvas{mode==='outpaint'?' · maximum including borders':''}</p><ImageGenerationSizing width={workingSize.width} height={workingSize.height} allowLongWait={workingSize.allow_long_wait} waitKey="allow_long_wait" limits={imageProvider?.resolution_limits} prefix="Magic Edit " sourceSize={imageSize||session} onChange={patch=>setWorkingSize(size=>({...size,...patch}))}/></>}

      <button disabled={!imageProvider?.available||(mode!=='upscale'&&(!model||!prompt.trim()))} onClick={()=>run('edit')}>Generate edited candidate</button>
      {catalog&&(!imageProvider?.available||(mode!=='upscale'&&!model))&&<p role="status">{imageProvider?.unavailable_reason || 'This mode needs its installed compatible provider and model.'} No models or dependencies are downloaded here.</p>}
    </fieldset>
    <button disabled={busy} onClick={discover}>Refresh installed models</button>
    {busy&&<button onClick={stop}>Stop Magic Edit</button>}
    {status&&<p role="status">{status}</p>}{busy&&<progress aria-label="Magic Edit progress" {...(progress||{})}/>}
    {candidate&&<div className="ie-magic-candidate"><p>{candidate.size} · {MAGIC_MODES.find(item=>item.id===candidate.mode).label}</p><img src={compare?candidate.sourceUrl:candidate.url} alt={compare?'Source before Magic Edit':'Magic Edit candidate'}/><button onClick={()=>setCompare(v=>!v)}>{compare?'Show candidate':'Compare source'}</button><button disabled={disabled} onClick={async()=>{try{await onAccept(new File([candidate.blob],'magic-edited.png',{type:'image/png'}));setCandidate(null);}catch(e){setError(e.message);}}}>Use this edited image</button><button onClick={()=>setCandidate(null)}>Discard candidate</button></div>}
  </details>;
}
