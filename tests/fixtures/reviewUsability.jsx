import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import ImageReview from '../../src/components/ImageReview';
import {StoreProvider} from '../../src/useStore';
import '../../src/styles.css';
import '../../src/components/WorkspaceControls.css';

// Synthetic in-memory API. No application data, files or models are accessed.
const picture='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#dae6ee"/><circle cx="300" cy="65" r="32" fill="#edbc60"/><path d="M0 270L150 100L300 270L400 160V300H0" fill="#648977"/></svg>');
const sample=()=>['Mountain study','Garden reference','Evening light','Unsorted sketch'].map((name,index)=>({id:String(index+1),name,url:picture,annotations:{caption:'Sample notes kept during review'},tag_ids:[],tags:[],rating:index===1?'liked':null,review_status:index===1?'accepted':index===2?'reviewed':'unreviewed',favorite:index===1,category:'',project:'',file_state:'present',media_type:'image'}));
let images=sample();
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const apply=(item,changes)=>{
  Object.assign(item,changes);
  if('review_status' in changes)item.rating=({accepted:'liked',rejected:'disliked'})[changes.review_status]||null;
  else if('rating' in changes)item.review_status=({liked:'accepted',disliked:'rejected'})[changes.rating]||'unreviewed';
  if('caption' in changes)item.annotations={caption:changes.caption};
  return item;
};
const originalFetch=window.fetch.bind(window);
window.fetch=async(input,options={})=>{
  if(String(input).startsWith('data:image/'))return originalFetch(input,options);
  const url=new URL(String(input),location.href), route=url.pathname, body=options.body?JSON.parse(options.body):{};
  if(route==='/image-library')return json({images,folders:[],tags:[]});
  if(route.startsWith('/image-library/images/')&&options.method==='PATCH')return json(apply(images.find(item=>item.id===route.split('/')[3]),body));
  if(route==='/visual-review/workflow/list'){
    const status=url.searchParams.get('status'),favorite=url.searchParams.get('favorite'),query=url.searchParams.get('query')?.toLowerCase();
    const items=images.filter(item=>(!status||item.review_status===status)&&(!favorite||item.favorite)&&(!query||item.name.toLowerCase().includes(query))).map(item=>({...item,media_id:'library:'+item.id,caption:item.annotations.caption}));
    return json({items,total:items.length});
  }
  if(route==='/visual-review/workflow/presets')return json([{id:'0',name:'Folder 1',path:null}]);
  if(route==='/visual-review/workflow/plans')return json([]);
  if(route==='/visual-review/workflow/suggestions')return json(null);
  if(route==='/visual-review/workflow/metadata'){const item=images.find(item=>'library:'+item.id===url.searchParams.get('media_id'));return json({...item,media_id:'library:'+item.id,caption:item.annotations.caption});}
  if(route==='/visual-review/workflow/edit')return json({items:body.media_ids.map(id=>({media_id:id,review:apply(images.find(item=>'library:'+item.id===id),body.changes)}))});
  if(route==='/visual-review/capabilities')return json({faces:[],vision_models:[],scene_labels:[]});
  if(route==='/visual-review/catalog')return json({items:[],people:[],scenes:{},total:0,available_tags:[]});
  if(route==='/visual-review/job')return json(null);
  return new Response(JSON.stringify({detail:'Unsupported fixture route: '+route}),{status:404});
};
function Fixture(){const [revision,setRevision]=useState(0),[narrow,setNarrow]=useState(false);return <StoreProvider>
  <div style={{display:'flex',gap:12,padding:8,borderBottom:'1px solid var(--border)'}}><span>Isolated sample data</span><button onClick={()=>{images=sample();setRevision(n=>n+1);}}>Reset sample</button><button onClick={()=>{images=[];setRevision(n=>n+1);}}>Empty library</button><button onClick={()=>setNarrow(value=>!value)}>Toggle narrow layout</button></div>
  <main style={{height:'calc(100vh - 50px)',width:narrow?360:'100%',maxWidth:'100%',margin:'auto'}}><ImageReview key={revision} active/></main>
  <details style={{padding:12}}><summary>Fixture saved metadata</summary><button onClick={()=>setRevision(n=>n+1)}>Reload saved view</button><pre>{JSON.stringify(images.map(({id,rating,review_status,favorite,annotations})=>({id,rating,review_status,favorite,annotations})),null,2)}</pre></details>
  </StoreProvider>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
