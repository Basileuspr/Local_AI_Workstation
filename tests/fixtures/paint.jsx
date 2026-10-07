import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {StoreProvider} from '../../src/useStore';
import Paint from '../../src/components/CanvasPaintWorkspace';
import {getPaintDocument} from '../../src/paintDocument';
import '../../src/styles.css';
window.paintQA={engine:getPaintDocument()};
function Fixture(){const [visible,setVisible]=useState(true),[pending,setPending]=useState([]);useEffect(()=>{const stage=e=>{e.preventDefault();setPending(e.detail);};window.addEventListener('stage-function-result',stage);return()=>window.removeEventListener('stage-function-result',stage);},[]);return <StoreProvider><div style={{height:'100vh',display:'flex',flexDirection:'column'}}><header><button onClick={()=>setVisible(!visible)}>Toggle workspace</button><span data-pending>{pending.length} pending attachments</span></header><main style={{flex:1,minHeight:0}}>{visible?<Paint/>:<p>Another workspace · Paint draft retained</p>}</main></div></StoreProvider>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
