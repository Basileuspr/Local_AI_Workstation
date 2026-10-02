import {lazy, Suspense, useEffect, useRef, useState} from 'react';
import {localRequest, localAsset} from '../localFiles';
import LocalDocument from './LocalDocument';
import LocalDatabase from './LocalDatabase';
import LocalVideo from './LocalVideo';
import './LocalFiles.css';
const ModelViewer=lazy(()=>import('./ModelViewer'));
const EDITORS={document:LocalDocument,database:LocalDatabase,video:LocalVideo};

export default function LocalFiles({active=true}) {
  const [file,setFile]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false);
  const [handlers,setHandlers]=useState([]),[progress,setProgress]=useState(''),[modelFile,setModelFile]=useState(null);
  const [modelVisible,setModelVisible]=useState(true);
  const current=useRef(null), mounted=useRef(true), container=useRef(null);
  useEffect(()=>{if(container.current)container.current.scrollTop=0;},[file?.id]);
  useEffect(()=>{mounted.current=true; return()=>{mounted.current=false; if(current.current)localRequest(`/${current.current.id}`,null,'DELETE').catch(()=>{});};},[]);
  useEffect(()=>{if(active&&!handlers.length)localRequest('/handlers').then(setHandlers).catch(e=>setError(e.message));},[active,handlers.length]);
  useEffect(()=>{if(!active)setModelVisible(false);},[active]);
  useEffect(()=>{
    window.workstationDesktop?.localDocumentDirty(dirty);
    const warn=e=>{if(dirty){e.preventDefault();e.returnValue='Unsaved document changes';}};
    window.addEventListener('beforeunload',warn); return()=>window.removeEventListener('beforeunload',warn);
  },[dirty]);
  useEffect(()=>{
    if(!busy||!file)return;
    let alive=true, timer;
    async function poll(){try{const status=await localRequest(`/${file.id}/status`);if(alive)setProgress(status.progress);}catch{/* Operation response reports errors. */}finally{if(alive)timer=setTimeout(poll,700);}}
    poll();return()=>{alive=false;clearTimeout(timer);};
  },[busy,file?.id]);
  function accept(value){current.current=value;setFile(value);}
  async function run(work){setBusy(true);setError('');try{await work();}catch(failure){if(mounted.current)setError(failure.message);}finally{if(mounted.current){setBusy(false);setProgress('');}}}
  async function close(){
    if(dirty&&!window.confirm('Discard unsaved document changes?'))return false;
    if(current.current){await localRequest(`/${current.current.id}`,null,'DELETE');window.workstationDesktop?.forgetLocalFile(current.current.id);}
    accept(null);setModelFile(null);setDirty(false);return true;
  }
  async function open(){await run(async()=>{
    if(!await close())return;
    const result=await window.workstationDesktop.openLocalFile();
    if(result.error)throw new Error(result.error);
    if(result.canceled)return;
    accept(result);
    if(result.handler==='model'){
      const response=await fetch(localAsset(result.id,'source'));if(!response.ok)throw new Error('Could not read the selected model.');
      setModelFile(new File([await response.blob()],result.name));
      setModelVisible(true);
    }
  });}
  const Editor=EDITORS[file?.handler];
  return <section ref={container} className="local-files" aria-label="Local Files"><header><h1>Local Files</h1></header>
    <div className="local-toolbar"><button disabled={busy||!window.workstationDesktop?.openLocalFile} onClick={open}>Open local file</button>
      <button disabled={busy||!file} onClick={()=>run(close)}>Close file</button><strong>{file?.name || 'No file open'}</strong>{dirty&&<span>● Unsaved</span>}</div>
    {!window.workstationDesktop?.openLocalFile&&<p>Open Local AI Workstation’s desktop app to use native file selection.</p>}
    {error&&<p role="alert">{error}</p>}{busy&&<p role="status">{progress||'Working locally…'}</p>}
    {!file&&<div className="local-handler-grid">{handlers.map(handler=><article key={handler.id}><h2>{handler.label}</h2><p>{handler.extensions.join(' · ')}</p><p>{handler.capabilities.join(' · ')}</p><small>{handler.available?'Available':'Runtime unavailable'}</small></article>)}</div>}
    {Editor&&<Editor key={file.id} file={file} run={run} busy={busy} active={active} onSaved={accept} onDirty={setDirty}/>}
    {file?.handler==='model'&&<>
      {!modelVisible&&<button onClick={()=>setModelVisible(true)}>Open model again</button>}
      {active&&modelVisible&&modelFile&&<Suspense fallback={<p>Opening model…</p>}><ModelViewer initialFile={modelFile}/></Suspense>}</>}
  </section>;
}
