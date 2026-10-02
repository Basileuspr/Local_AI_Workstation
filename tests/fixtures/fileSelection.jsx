import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {StoreProvider} from '../../src/useStore';
import ImageManager from '../../src/components/ImageManager';
import CollectionImages from '../../src/components/CollectionImages';
import '../../src/styles.css';
import '../../src/components/ImageLibrary.css';

const originals=Array.from({length:60},(_,i)=>({id:String(i+1),relative:`Image ${String(i+1).padStart(2,'0')}.png`,name:`Image ${String(i+1).padStart(2,'0')}.png`,folder_id:'fixture',folder_path:'Synthetic files',signature:[1,1],width:320,height:200,format:'PNG',bytes:2048,date:'2026-10-02',date_source:'fixture',tags:i%2?['Even']:[],favorite:false,url:'/tests/fixtures/generatePreview.svg',folder_ids:[]}));
const realFetch=window.fetch.bind(window);
window.fetch=async(input,options={})=>{
  const url=new URL(input,location.href),json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  if(url.pathname==='/image-manager/state')return json({folders:[{id:'fixture',purpose:'source',path:'Synthetic files',count:60}],summary:{images:60,bytes:122880,hidden:0,trash:2},functions:[],duplicates:[],receipts:[],plans:[]});
  if(url.pathname==='/image-manager/images'){
    let images=originals.filter(i=>i.name.toLowerCase().includes((url.searchParams.get('search')||'').toLowerCase()));
    if(url.searchParams.get('tag'))images=images.filter(i=>i.tags.includes(url.searchParams.get('tag')));
    if(url.searchParams.get('sort')==='size')images=[...images].reverse();
    const offset=Number(url.searchParams.get('offset')||0);
    return json({images:images.slice(offset,offset+48),total:images.length,tags:['Even'],months:[],formats:['PNG']});
  }
  if(url.pathname==='/image-manager/trash')return json({entries:originals.slice(0,5).map(image=>({id:'trash-'+image.id,image,deleted_at:'2026-10-02'}))});
  if(/^\/image-manager\/images\/[^/]+\/(thumbnail|file)$/.test(url.pathname))return realFetch('/tests/fixtures/generatePreview.svg');
  if(url.pathname.startsWith('/tests/')||url.pathname.startsWith('/@'))return realFetch(input,options);
  throw new Error('Fixture blocked unexpected request: '+url.pathname);
};
function Fixture(){const [view,setView]=useState('manager');return <main style={{padding:20,maxWidth:1300,margin:'auto',height:'100vh',overflow:'auto'}}><h1>Selection checks · synthetic files</h1><nav><button onClick={()=>setView('manager')}>Image Manager fixture</button><button onClick={()=>setView('collection')}>Saved images fixture</button></nav>{view==='manager'?<ImageManager/>:<CollectionImages images={originals.slice(0,8)} title="Selection fixture"/>}</main>;}
createRoot(document.getElementById('root')).render(<StoreProvider><Fixture/></StoreProvider>);
