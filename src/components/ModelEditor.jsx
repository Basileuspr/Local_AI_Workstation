import {useEffect,useMemo,useRef,useState} from 'react';
import {appendHistory,bounds,DEFAULT_MATERIAL,duplicateObjects,emptyDocument,ensureUV,importPayload,MAX_PROJECT_BYTES,mirrorObjects,PRIMITIVES,primitive,settleObjects,statistics,transformObject,transformValues,translateObject,validateDocument} from '../modelViewer/editor';
import {validateFile,WARN_FILE_BYTES} from '../modelViewer/limits';
import {pendingEditor,retainEditor} from '../modelViewer/session';
import ModelPaint from './ModelPaint';
import ModelRepair from './ModelRepair';
import './ModelViewer.css';

const number=value=>Number(value).toLocaleString(undefined,{maximumFractionDigits:3});
const defaultView={shading:true,shadows:false,colors:true,reflections:false,smoothing:true,wireframe:false,grid:true,axes:true,xray:false};
const TABS=['Insert','Object','Edit','Paint','View'];

function TransformFields({object,onApply,disabled}){
  const [values,setValues]=useState(()=>transformValues(object));
  useEffect(()=>setValues(transformValues(object)),[object]);
  return <form className="model-transform" onSubmit={event=>{event.preventDefault();onApply(values);}}>
    {Object.entries({position:'Position',rotation:'Rotation °',scale:'Scale'}).map(([key,title])=><fieldset key={key} disabled={disabled}><legend>{title}</legend><div>{['X','Y','Z'].map((axis,i)=><label key={axis}>{axis}<input aria-label={`${title} ${axis}`} type="number" step="any" required value={values[key][i]} onChange={e=>setValues(old=>({...old,[key]:old[key].map((v,j)=>i===j?e.target.value:v)}))}/></label>)}</div></fieldset>)}
    <button disabled={disabled} type="submit">Apply transform</button>
  </form>;
}

export default function ModelEditor({initialFile=null}){
  const restored=useRef(initialFile?null:pendingEditor()),[doc,setDoc]=useState(()=>restored.current?.document||emptyDocument()),[active,setActive]=useState(!!restored.current),[dirty,setDirty]=useState(!!restored.current);
  const [selected,setSelected]=useState([]),[tab,setTab]=useState('Insert'),[mode,setMode]=useState('select'),[view,setView]=useState(defaultView),[ortho,setOrtho]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[progress,setProgress]=useState(''),[warning,setWarning]=useState(null),[confirm,setConfirm]=useState(null),[measurement,setMeasurement]=useState(null),[brush,setBrush]=useState(DEFAULT_MATERIAL);
  const [clipboard,setClipboard]=useState([]),[custom,setCustom]=useState(false),[shape,setShape]=useState('Cube'),[dimensions,setDimensions]=useState([20,20,20]),[operation,setOperation]=useState(null),[params,setParams]=useState({}),[sourceFile,setSourceFile]=useState(null);
  const host=useRef(null),input=useRef(null),scene=useRef(null),worker=useRef(null),ticket=useRef(0),docRef=useRef(doc),selectedRef=useRef(selected),actions=useRef({}),inputMode=useRef('replace'),fitNext=useRef(false),history=useRef({past:restored.current?.past||[],future:[]}),[historyVersion,setHistoryVersion]=useState(0);
  docRef.current=doc;selectedRef.current=selected;
  const info=useMemo(()=>statistics(doc.objects),[doc.objects]),chosen=selected.map(id=>doc.objects.find(o=>o.id===id)).filter(Boolean),selectionInfo=useMemo(()=>statistics(chosen),[doc.objects,selected]);
  const busy=!!progress||!!warning,one=chosen.length===1,many=chosen.length>=2;
  function remember(document,past,changed){if(!initialFile)retainEditor(changed?{document,past}:null);}
  function updateDocument(next,changed=true){docRef.current=next;setDoc(next);setDirty(changed);remember(next,history.current.past,changed);}
  function commit(objects,label,ids=selectedRef.current,extra={}){
    const previous=docRef.current,next={...previous,...extra,objects};validateDocument(next);
    history.current={past:appendHistory(history.current.past,previous),future:[]};setHistoryVersion(v=>v+1);updateDocument(next);setSelected(ids.filter(id=>objects.some(o=>o.id===id)));setNotice(label);setError('');setActive(true);
  }
  function attempt(fn){try{fn();}catch(failure){setError(failure.message);}}
  function stop(){ticket.current++;worker.current?.terminate();worker.current=null;setProgress('');setWarning(null);}
  function reset(){stop();history.current={past:[],future:[]};setHistoryVersion(v=>v+1);updateDocument(emptyDocument(),false);setSelected([]);setActive(false);setError('');setNotice('');setClipboard([]);setMode('select');setOperation(null);setConfirm(null);setSourceFile(null);}
  function guarded(action){if(dirty)setConfirm({action});else action();}
  function undo(redo=false){
    if(busy)return;const h=history.current,source=redo?h.future:h.past;if(!source.length)return;
    const next=source.at(-1);history.current=redo?{past:appendHistory(h.past,docRef.current),future:h.future.slice(0,-1)}:{past:h.past.slice(0,-1),future:appendHistory(h.future,docRef.current)};
    updateDocument(next);setSelected(next.objects.length===1?[next.objects[0].id]:[]);setHistoryVersion(v=>v+1);setNotice(redo?'Edit restored.':'Edit undone.');setOperation(null);
  }
  function insert(name,size=dimensions){
    attempt(()=>{const object=primitive(name,size.map(Number)),previous=docRef.current.objects;
      const placed=previous.length?translateObject(object,[bounds(previous).max.x+Number(size[0])*.7,0,0]):object;
      fitNext.current=true;commit([...previous,placed],`${name} inserted.`,[placed.id]);setCustom(false);});
  }
  function replaceSelected(objects,label){const ids=new Set(selectedRef.current);commit([...docRef.current.objects.filter(o=>!ids.has(o.id)),...objects],label,objects.map(o=>o.id));}
  function copy(cut=false){if(!chosen.length)return;setClipboard(chosen);if(cut)replaceSelected([],'Objects cut to the editor clipboard.');else setNotice('Objects copied to the editor clipboard.');}
  function paste(){attempt(()=>{const objects=duplicateObjects(clipboard);fitNext.current=true;commit([...docRef.current.objects,...objects],'Objects pasted.',objects.map(o=>o.id));});}
  function duplicate(){attempt(()=>{const objects=duplicateObjects(chosen);fitNext.current=true;commit([...docRef.current.objects,...objects],'Objects duplicated.',objects.map(o=>o.id));});}
  function transform(id,matrix){try{commit(docRef.current.objects.map(o=>o.id===id?{...o,matrix}:o),'Transform applied.');}catch(failure){scene.current?.setDocument(docRef.current);scene.current?.selection(selectedRef.current);setError(failure.message);}}
  function paint(patch,ids=selected){attempt(()=>{const targets=new Set(ids);if(!docRef.current.objects.some(o=>targets.has(o.id)))return;
    commit(docRef.current.objects.map(o=>targets.has(o.id)?{...o,geometry:patch.mapData?ensureUV(o.geometry):o.geometry,materials:o.materials.map(m=>({...m,...patch}))}:o),'Paint applied.',ids);});}
  actions.current={select:ids=>{if(!busy)setSelected(ids);},transform:(id,matrix)=>{if(!busy)transform(id,matrix);},pick:material=>{setBrush(material);setMode('select');setNotice('Material picked. Apply brush to paint the selected objects.');}};
  useEffect(()=>{
    if(!active)return;let cancelled=false,viewer;
    import('../modelViewer/editorScene').then(({createEditorScene})=>{
      if(cancelled)return;viewer=createEditorScene(host.current,docRef.current,setError,{onSelect:ids=>actions.current.select(ids),onTransform:(id,matrix)=>actions.current.transform(id,matrix),onPick:m=>actions.current.pick(m),onMeasure:setMeasurement});scene.current=viewer;viewer.selection(selectedRef.current);viewer.mode(mode);for(const [key,value] of Object.entries(view))viewer.setting(key,value);viewer.projection(ortho);
    }).catch(failure=>{if(!cancelled)setError(`Could not initialize the 3D editor: ${failure.message}`);});
    return()=>{cancelled=true;if(scene.current===viewer)scene.current=null;viewer?.dispose();};
  },[active]);
  useEffect(()=>{scene.current?.setDocument(doc);if(fitNext.current){scene.current?.fit();fitNext.current=false;}},[doc]);
  useEffect(()=>{scene.current?.selection(selected);},[selected]);
  useEffect(()=>{scene.current?.mode(busy?'disabled':mode);},[mode,busy]);
  useEffect(()=>()=>{ticket.current++;worker.current?.terminate();},[]);
  useEffect(()=>{if(initialFile)open(initialFile,'replace');},[initialFile]);
  useEffect(()=>{if(!initialFile||!dirty)return;const handler=e=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[initialFile,dirty]);
  function acceptDocument(next,append){
    if(append){fitNext.current=true;commit([...docRef.current.objects,...next.objects],`Added ${next.name}.`,next.objects.map(o=>o.id));}
    else{history.current={past:[],future:[]};setHistoryVersion(v=>v+1);updateDocument(next,false);setSelected([]);setActive(true);fitNext.current=true;setNotice(`Opened ${next.name}.`);setOperation(null);}
  }
  async function open(file,how='replace',approved=false,discardApproved=false,repairPreview=false){
    if(!file)return;
    if(how==='replace'&&dirty&&!discardApproved){setConfirm({action:()=>open(file,how,approved,true,repairPreview)});return;}
    stop();setError('');const current=ticket.current;
    try{
      const isProject=file.name.toLowerCase().endsWith('.law3d');
      if(isProject){if(file.size>MAX_PROJECT_BYTES)throw Error('Project exceeds 128 MB.');if(how==='append')throw Error('Open projects with Open file. Use Add for STL or 3MF models.');}
      else validateFile(file);
      if(file.size>WARN_FILE_BYTES&&!approved){setWarning({message:`This file is ${number(file.size/1024/1024)} MB and may require substantial memory. Continue?`,continue:()=>open(file,how,true,discardApproved,repairPreview)});return;}
      const parser=isProject?new Worker(new URL('../modelViewer/projectWorker.js',import.meta.url),{type:'module'}):new Worker(new URL('../modelViewer/worker.js',import.meta.url),{type:'module'});worker.current=parser;setProgress('Reading and checking model…');
      parser.onmessage=({data})=>{
        if(ticket.current!==current)return;
        if(data.type==='warning'){setProgress('');setWarning({message:data.message||`This model contains approximately ${number(data.triangles)} triangles and may use significant memory. Continue?`,continue:()=>{setWarning(null);setProgress('Building model geometry…');parser.postMessage({action:'continue'});}});}
        else if(data.type==='progress')setProgress(data.message);
        else if(data.error||data.type==='error'){stop();setError(data.error||data.message);}
        else if(data.document||data.type==='ready'){
          parser.terminate();worker.current=null;setProgress('');
          attempt(()=>{if(data.document){acceptDocument(data.document,false);setSourceFile(null);}else{const payload=data.payload,units=how==='append'?docRef.current.units:payload.info.units||'millimeter';acceptDocument({objects:importPayload(payload,units),units,name:payload.info.name,warnings:payload.info.warnings||[],source:{type:payload.info.type,size:payload.info.size}},how==='append');if(how==='replace'&&!repairPreview)setSourceFile(file);}});
        }
      };
      parser.onerror=()=>{if(ticket.current===current){stop();setError('Model loading failed. Try a smaller or re-exported file.');}};parser.postMessage({action:'open',file});
    }catch(failure){stop();setError(failure.message);}
  }
  function chooseFile(how){inputMode.current=how;input.current.accept=how==='append'?'.stl,.3mf':'.stl,.3mf,.law3d';input.current.click();}
  function tool(action){
    const b=bounds(chosen),size=selectionInfo.dimensions;
    setOperation(action);setParams({axis:2,offset:(b.min.z+b.max.z)/2,tolerance:Math.max(...size)*.005,thickness:1,depth:2,text:'Text',size:Math.max(size[0],size[1])*.15});
  }
  function runOperation(action=operation){
    if(!chosen.length||busy)return;stop();setError('');setProgress(`Applying ${action}…`);const current=ticket.current,ids=[...selected],base=docRef.current;
    const editor=new Worker(new URL('../modelViewer/editWorker.js',import.meta.url),{type:'module'});worker.current=editor;
    editor.onmessage=({data})=>{if(ticket.current!==current)return;editor.terminate();worker.current=null;setProgress('');if(data.error){setError(data.error);return;}
      if(docRef.current!==base){setError('The scene changed during this edit. Run the operation again.');return;}
      attempt(()=>{const removed=new Set(ids);commit([...base.objects.filter(o=>!removed.has(o.id)),...data.objects],`${action} applied.`,data.objects.map(o=>o.id));setOperation(null);});};
    editor.onerror=()=>{if(ticket.current===current){stop();setError('The geometry worker stopped. The original objects are unchanged. Try a smaller model.');}};
    editor.postMessage({action,objects:chosen,options:params});
  }
  async function download(format){
    if(busy)return;stop();setError('');setProgress(`Preparing ${format==='project'?'project':'STL'}…`);const current=ticket.current,base=docRef.current;
    const exporter=new Worker(new URL('../modelViewer/projectWorker.js',import.meta.url),{type:'module'});worker.current=exporter;
    exporter.onmessage=async({data})=>{
      if(ticket.current!==current)return;exporter.terminate();worker.current=null;
      if(data.error){setProgress('');setError(data.error);return;}
      const extension=format==='project'?'law3d':'stl',name=(base.name||'model').replace(/\.(stl|3mf|law3d)$/i,'')+'-edited.'+extension;
      try{
        const blob=new Blob([data.text||data.bytes],{type:format==='project'?'application/json':'model/stl'});
        const nativeSave=!!window.workstationDesktop?.save3DEditorFile;
        if(nativeSave){const result=await window.workstationDesktop.save3DEditorFile({name,format:extension,bytes:new Uint8Array(await blob.arrayBuffer())});if(result?.error)throw Error(result.error);if(!result?.saved){setProgress('');return;}}
        else{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
        if(ticket.current!==current)return;if(format==='project'&&nativeSave&&docRef.current===base){setDirty(false);remember(base,[],false);}setNotice(format==='project'?(nativeSave?'Project saved with editable objects and textures.':'Project download requested. Edits stay in memory until you close the scene.'):'STL exported in millimeters. Keep a project copy to retain paint and separate objects.');
      }catch(failure){if(ticket.current===current)setError(failure.message);}finally{if(ticket.current===current)setProgress('');}
    };
    exporter.onerror=()=>{if(ticket.current===current){stop();setError('Export failed. Try a smaller scene.');}};exporter.postMessage({action:format,document:base});
  }
  function keyboard(event){
    if(busy||confirm||/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)||event.target.isContentEditable)return;
    const mod=event.ctrlKey||event.metaKey,key=event.key.toLowerCase();let action;
    if(mod&&key==='z')action=()=>undo(event.shiftKey);else if(mod&&key==='y')action=()=>undo(true);else if(mod&&key==='a')action=()=>setSelected(doc.objects.map(o=>o.id));
    else if(mod&&key==='c')action=()=>copy();else if(mod&&key==='x')action=()=>copy(true);else if(mod&&key==='v')action=paste;else if(mod&&key==='d')action=duplicate;
    else if(key==='delete'&&chosen.length)action=()=>replaceSelected([],'Objects deleted.');else if(key==='escape')action=()=>{setMode('select');setSelected([]);setOperation(null);};
    if(action){event.preventDefault();attempt(action);}
  }
  return <section className="model-viewer model-editor" aria-label="3D Viewer & Editor" onKeyDown={keyboard} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();if(!busy)open(event.dataTransfer.files[0],doc.objects.length?'append':'replace');}}>
    <header className="model-editor-heading"><div><h1>3D Viewer &amp; Editor</h1></div><span className="model-project-state">{doc.units}{dirty?' · Unsaved edits':''}</span></header>
    <div className="model-toolbar model-filebar"><button disabled={busy} onClick={()=>guarded(()=>{reset();setActive(true);})}>New scene</button><button disabled={busy} onClick={()=>chooseFile('replace')}>Open file</button><input ref={input} type="file" accept=".stl,.3mf,.law3d" hidden onChange={event=>{open(event.target.files[0],inputMode.current);event.target.value='';}}/>
      <button disabled={!active||busy} onClick={()=>download('project')}>Save project</button><button disabled={!doc.objects.length||busy} onClick={()=>download('stl')}>Export STL</button><button disabled={!active&&!busy} onClick={()=>guarded(reset)}>Close model</button>
      <span className="model-toolbar-spacer"/><button disabled={busy||!history.current.past.length} onClick={()=>undo()}>Undo</button><button disabled={busy||!history.current.future.length} onClick={()=>undo(true)}>Redo</button>
    </div>
    <div className="model-ribbon-tabs" role="tablist" aria-label="Editor tools">{TABS.map(name=><button id={`model-tab-${name}`} role="tab" aria-selected={tab===name} aria-controls="model-ribbon-panel" key={name} onClick={()=>setTab(name)}>{name}</button>)}</div>
    <div className="model-ribbon" role="tabpanel" id="model-ribbon-panel" aria-labelledby={`model-tab-${tab}`}>
      {tab==='Insert'&&<><div className="model-toolbar"><button disabled={busy} onClick={()=>chooseFile('append')}>＋ Add</button><button aria-expanded={custom} disabled={busy} onClick={()=>setCustom(!custom)}>Custom</button>{PRIMITIVES.map(name=><button key={name} disabled={busy} onClick={()=>insert(name)}>{name}</button>)}</div>
        {custom&&<form className="model-custom model-toolbar" onSubmit={e=>{e.preventDefault();insert(shape);}}><label>Shape <select value={shape} onChange={e=>setShape(e.target.value)}>{PRIMITIVES.map(name=><option key={name}>{name}</option>)}</select></label>{['X','Y','Z'].map((axis,i)=><label key={axis}>{axis}<input aria-label={`Shape ${axis}`} type="number" step="any" min=".001" max="1000000" required value={dimensions[i]} onChange={e=>setDimensions(values=>values.map((v,j)=>i===j?e.target.value:v))}/></label>)}<button disabled={busy}>Insert shape</button></form>}</>}
      {tab==='Object'&&<div className="model-toolbar"><button disabled={!chosen.length||busy} onClick={duplicate}>Duplicate</button><button disabled={!chosen.length||busy} onClick={()=>copy()}>Copy</button><button disabled={!chosen.length||busy} onClick={()=>copy(true)}>Cut</button><button disabled={!clipboard.length||busy} onClick={paste}>Paste</button><button disabled={!chosen.length||busy} onClick={()=>replaceSelected([],'Objects deleted.')}>Delete</button><button disabled={!chosen.length||busy} onClick={()=>attempt(()=>replaceSelected(settleObjects(chosen),'Objects settled onto Z = 0.'))}>Settle</button>{['X','Y','Z'].map((axis,i)=><button key={axis} disabled={!chosen.length||busy} onClick={()=>attempt(()=>replaceSelected(mirrorObjects(chosen,i),`Mirrored across ${axis}.`))}>Mirror {axis}</button>)}<button disabled={!doc.objects.length||busy} aria-pressed={mode==='measure'} onClick={()=>setMode(mode==='measure'?'select':'measure')}>Measure</button></div>}
      {tab==='Edit'&&<><div className="model-toolbar">{[['simplify','Simplify'],['split','Split'],['smooth','Smooth'],['emboss','Emboss'],['extrude','Extrude down'],['merge','Merge'],['intersect','Intersect'],['subtract','Subtract'],['hollow','Hollow']].map(([action,label])=><button key={action} disabled={busy||(['merge','intersect','subtract'].includes(action)?!many:!one)} onClick={()=>tool(action)}>{label}</button>)}</div></>}

      {tab==='View'&&<div className="model-toolbar"><button disabled={!active} onClick={()=>scene.current?.fit()}>Center view</button>{[['shading','Shading'],['shadows','Shadows'],['colors','Colors'],['reflections','Reflections'],['smoothing','Smoothing'],['wireframe','Wireframe'],['grid','Grid'],['axes','XYZ axes'],['xray','X-ray']].map(([key,label])=><label key={key}><input type="checkbox" checked={view[key]} onChange={e=>{const value=e.target.checked;setView(v=>({...v,[key]:value}));scene.current?.setting(key,value);}}/>{label}</label>)}</div>}
    </div>
    {error&&<p role="alert">{error}</p>}{progress&&<div className="model-toolbar"><p role="status">{progress}</p><button onClick={()=>{stop();setNotice('Cancelled. Existing objects were kept.');}}>Cancel {progress.startsWith('Reading')||progress.startsWith('Building')?'loading':'operation'}</button></div>}
    {warning&&<div className="model-warning" role="alertdialog" aria-label="Large model warning"><p>{warning.message}</p><button autoFocus onClick={stop}>Cancel</button><button onClick={warning.continue}>Continue loading</button></div>}
    {confirm&&<div className="model-warning" role="alertdialog" aria-label="Unsaved 3D edits"><p>There are unsaved edits. Save your project before replacing or closing this scene.</p><button autoFocus onClick={()=>setConfirm(null)}>Keep editing</button><button onClick={()=>{const action=confirm.action;setConfirm(null);action();}}>Discard edits</button></div>}
    {operation&&<form className="model-operation model-toolbar" onSubmit={e=>{e.preventDefault();runOperation();}} aria-label={`${operation} settings`}>
      <strong>{({extrude:'Extrude down',emboss:'Emboss',hollow:'Hollow',split:'Split',simplify:'Simplify',smooth:'Smooth',merge:'Merge',intersect:'Intersect',subtract:'Subtract'})[operation]}</strong>
      {operation==='split'&&<><label>Axis <select value={params.axis} onChange={e=>{const axis=Number(e.target.value),b=selectionInfo.bounds;setParams(p=>({...p,axis,offset:(b.min[axis]+b.max[axis])/2}));}}>{['X','Y','Z'].map((axis,i)=><option key={axis} value={i}>{axis}</option>)}</select></label><label>Plane position <input type="number" step="any" required value={params.offset} onChange={e=>setParams(p=>({...p,offset:e.target.value}))}/></label></>}
      {operation==='emboss'&&<><label>Text <input maxLength={60} required value={params.text} onChange={e=>setParams(p=>({...p,text:e.target.value}))}/></label><label>Text size <input required type="number" min=".001" step="any" value={params.size} onChange={e=>setParams(p=>({...p,size:e.target.value}))}/></label></>}
      {['simplify','hollow','emboss','extrude'].includes(operation)&&<label>{operation==='simplify'?'Tolerance':operation==='hollow'?'Wall thickness':'Depth'}<input type="number" required min=".0001" step="any" value={params[operation==='simplify'?'tolerance':operation==='hollow'?'thickness':'depth']} onChange={e=>setParams(p=>({...p,[operation==='simplify'?'tolerance':operation==='hollow'?'thickness':'depth']:e.target.value}))}/></label>}
      <button disabled={busy}>Apply {operation}</button><button type="button" disabled={busy} onClick={()=>setOperation(null)}>Cancel</button>

    </form>}
    <div className="model-editor-body"><main className="model-viewport-column">
      <div className="model-toolbar model-viewport-toolbar">{[['select','Select'],['translate','Move'],['rotate','Rotate'],['scale','Scale']].map(([key,label])=><button key={key} disabled={busy||(key!=='select'&&!one)} aria-pressed={mode===key} onClick={()=>setMode(key)}>{label}</button>)}<span className="model-toolbar-spacer"/><button disabled={!active} onClick={()=>scene.current?.view('Isometric')}>Reset view</button><button disabled={!active} onClick={()=>scene.current?.fit()}>Fit model</button><label><input type="checkbox" checked={ortho} onChange={e=>{setOrtho(e.target.checked);scene.current?.projection(e.target.checked);}}/>Orthographic</label></div>
      <div className="model-stage" ref={host}>{!active&&<div className="model-empty"><strong>No model open.</strong><p>Open a local STL / 3MF or insert a shape to begin.</p><button onClick={()=>insert('Cube')}>Start with a cube</button></div>}{mode==='measure'&&<div className="model-stage-hint">{measurement?.distance!=null?`Distance: ${number(measurement.distance)} ${doc.units}`:measurement?.pending?'Click the second point on a surface.':'Click two surface points to measure.'}</div>}{mode==='pick'&&<div className="model-stage-hint">Click an object to sample its material.</div>}</div>
      <div className="model-toolbar model-camera-views" aria-label="Camera views">{['Front','Back','Left','Right','Top','Bottom','Isometric'].map(name=><button key={name} disabled={!active} onClick={()=>scene.current?.view(name)}>{name}</button>)}</div>
      <p className="model-editor-status" aria-live="polite">{notice||'Select objects in the viewport or the list.'} {chosen.length>0&&`${chosen.length} selected.`}</p>
    </main><aside className="model-inspector" aria-label="Object inspector"><div className="model-inspector-heading"><h2>Objects <span>{doc.objects.length}</span></h2><button disabled={busy||!doc.objects.length} onClick={()=>setSelected(doc.objects.map(o=>o.id))}>Select all</button></div>
      <div className="model-object-list">{doc.objects.length?doc.objects.map(object=><label key={object.id} className={selected.includes(object.id)?'selected':''}><input type="checkbox" aria-label={`Select ${object.name}`} disabled={busy} checked={selected.includes(object.id)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,object.id]:ids.filter(id=>id!==object.id))}/><button disabled={busy} onClick={()=>setSelected([object.id])}>{object.name}</button>{selected[0]===object.id&&many&&<small>Base</small>}</label>):<p>No objects yet.</p>}</div>
      {tab==='Paint'?<ModelPaint disabled={busy||!chosen.length} onPaint={paint} onPick={()=>setMode('pick')} brush={brush} onBrush={setBrush} onError={setError}/>:<>{one&&<><label className="model-name">Name <input aria-label="Object name" maxLength={300} key={chosen[0].id+chosen[0].name} defaultValue={chosen[0].name} disabled={busy} onBlur={e=>{const name=e.target.value.trim();if(name&&name!==chosen[0].name)attempt(()=>commit(docRef.current.objects.map(o=>o.id===chosen[0].id?{...o,name}:o),'Object renamed.'));}}/></label><TransformFields object={chosen[0]} disabled={busy} onApply={values=>attempt(()=>{const converted=Object.fromEntries(Object.entries(values).map(([k,list])=>[k,list.map(Number)]));transform(chosen[0].id,transformObject(chosen[0],converted).matrix);})}/></>}
        {!!chosen.length&&<div className="model-selection-details"><h3>Selection</h3><p>X {number(selectionInfo.dimensions[0])} × Y {number(selectionInfo.dimensions[1])} × Z {number(selectionInfo.dimensions[2])} {doc.units}</p><p>{number(selectionInfo.triangles)} triangles · Area {number(selectionInfo.area)} {doc.units}²</p></div>}
        {!chosen.length&&<p>Select an object to change its position, rotation, size, or paint.</p>}</>}
    </aside></div>
    {sourceFile&&<details className="model-repair-section"><summary>Repair source mesh with Windows</summary><ModelRepair file={sourceFile} onPreview={file=>open(file,'replace',false,false,true)} loading={busy}/></details>}
    {doc.objects.length>0&&<details className="model-details"><summary>{doc.name} · {number(info.triangles)} triangles · {info.meshes} meshes</summary><p>Dimensions ({doc.units}): X {number(info.dimensions[0])} × Y {number(info.dimensions[1])} × Z {number(info.dimensions[2])}</p><p>Bounds: [{info.bounds.min.map(number).join(', ')}] to [{info.bounds.max.map(number).join(', ')}] · Surface area: {number(info.area)} {doc.units}²</p>{doc.warnings?.map(message=><p key={message}>{message}</p>)}</details>}

  </section>;
}
