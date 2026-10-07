import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import ImageThumbnail from '../../src/components/ImageThumbnail';
import ImageViewer from '../../src/components/ImageViewer';
import '../../src/styles.css';
import '../../src/components/ImageStudio.css';

const red=new URL('./hardening-red.png',import.meta.url).href;
const blue=new URL('./hardening-blue.png',import.meta.url).href;
function Fixture(){
  const [source,setSource]=useState(red),[open,setOpen]=useState(false);
  const images=[{id:'reused-id',url:source,name:source===red?'Red fixture':source===blue?'Blue fixture':'Broken fixture'}];
  return <main style={{padding:40,maxWidth:1000,margin:'auto'}}>
    <h1>Generation preview recovery</h1><p>Real image loading and React controls. Disposable fixtures; no inference or user data.</p>
    <div style={{display:'flex',gap:12,margin:'24px 0'}}>{[['Red image',red],['Blue image',blue],['Broken image',red+'?broken=1']].map(([name,url])=><button key={name} onClick={()=>setSource(name==='Broken image'?new URL('./missing-hardening.png',import.meta.url).href:url)}>{name}</button>)}</div>
    <div style={{width:400,height:260}}><ImageThumbnail src={source} alt="Selected test image"/></div>
    <p role="status">Selected: {images[0].name}</p><button onClick={()=>setOpen(true)}>Open preview</button>
    <ImageViewer images={images} selectedId="reused-id" onSelect={()=>{}} onClose={()=>setOpen(false)} active={open} previewOnly
      actions={()=> <button onClick={()=>setSource(blue)}>Change selected source</button>}/>
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
