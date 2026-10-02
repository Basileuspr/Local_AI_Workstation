import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import VisualReview from '../../src/components/VisualReview';
import {apiUrl} from '../../src/api';
import '../../src/styles.css';
function Preview(){const [ids,setIds]=useState([]);useEffect(()=>{fetch(apiUrl('/fixture/items')).then(r=>r.json()).then(v=>setIds(v.ids));},[]);return <main style={{padding:24,maxWidth:1150,margin:'auto',height:'100vh',overflow:'auto'}}><h1>Image Manager review integration</h1><p>Synthetic files and simulated face/scene inference. Real routes, database, queue and file reads.</p><VisualReview source="image-manager" ids={ids}/></main>;}
createRoot(document.getElementById('root')).render(<Preview/>);
