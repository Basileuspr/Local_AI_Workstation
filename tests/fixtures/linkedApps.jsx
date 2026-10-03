import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import DocumentEditor from '../../src/components/DocumentEditor';
import Slicer from '../../src/components/Slicer';
import AppIntegrations from '../../src/components/AppIntegrations';
import FileConverter from '../../src/components/FileConverter';
import '../../src/styles.css';

const actualFetch=window.fetch.bind(window);
window.fetch=async(input,options={})=>{
  const url=new URL(input,location.href),json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  if(url.pathname==='/slicer/readiness')return json({ready:true,engine:'Neutral fixture CuraEngine',machines:[{id:'fdmprinter',name:'Generic 220 × 220 × 250 mm printer'}]});
  if(url.pathname==='/slicer/status')return json({job:null});
  if(url.pathname==='/integrations/status')return json({processes:{cura:[],discord:[],spotify:[],phone:[]},phone:{ready:true,release:'Supplied Windows release',source_available:true,description:'scrcpy mirrors and controls an Android phone; it does not emulate Android.'}});
  if(url.pathname==='/integrations/embed')return json({url:'https://open.spotify.com/embed/track/0123456789ABCDEFGHIJKL'});
  if(url.pathname==='/integrations/discord/send')return new Response(JSON.stringify({detail:'Fixture deliberately blocks external delivery.'}),{status:400,headers:{'Content-Type':'application/json'}});
  return actualFetch(input,options);
};
window.workstationDesktop={openLinkedContent:async()=>({ready:true}),placeLinkedContent:async()=>{},closeLinkedContent:async()=>{},requestPlaybackCapture:async()=>({error:'Browser fixture: use the Windows desktop app to record playback.'}),cancelPlaybackCapture:async()=>{}};
function Fixture(){
  const [tab,setTab]=useState('documents');
  return <div style={{height:'100vh',display:'flex',flexDirection:'column'}}><nav style={{display:'flex',gap:15,padding:10}}>{['documents','slicer','integrations','icons'].map(id=><button key={id} onClick={()=>setTab(id)}>{id}</button>)}<span>Isolated verification · synthetic content</span></nav><div style={{flex:1,minHeight:0}}>{tab==='documents'?<DocumentEditor/>:tab==='slicer'?<Slicer/>:tab==='integrations'?<AppIntegrations/>:<FileConverter/>}</div></div>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
