import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import ModelViewer from '../../src/components/ModelViewer';
import '../../src/styles.css';
function Fixture(){const [active,setActive]=useState(true);return <div style={{display:'flex',height:'100vh',flexDirection:'column'}}><button id="switch-tab" onClick={()=>setActive(v=>!v)}>Switch tab</button>{active?<ModelViewer/>:<p>Another workspace</p>}</div>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
