import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {StoreProvider} from '../../src/useStore';
import {apiUrl} from '../../src/api';
import LocalVideo from '../../src/components/LocalVideo';
import '../../src/styles.css';
import '../../src/components/LocalFiles.css';
function Fixture(){const [file,setFile]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');useEffect(()=>{fetch(apiUrl('/fixture/video')).then(r=>r.json()).then(setFile).catch(e=>setError(e.message));},[]);async function run(work){setBusy(true);try{await work();}catch(e){setError(e.message);}finally{setBusy(false);}}return <StoreProvider><main style={{padding:24,maxWidth:1000,margin:'auto',height:'100vh',overflow:'auto'}}><h1>Video REVIEW integration · encoded test clip</h1>{error&&<p role="alert">{error}</p>}{file&&<LocalVideo file={file} onSaved={setFile} run={run} busy={busy} active/>}</main></StoreProvider>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
