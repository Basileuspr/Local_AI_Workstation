import React from 'react';
import {createRoot} from 'react-dom/client';
import ImageWorkflows from '../../src/components/ImageWorkflows';
import '../../src/styles.css';
const operations=['controlnet','multi_reference','outpaint','upscale'];
const state={saves:[],runs:0,errors:[]};window.workflowQA=state;
window.addEventListener('error',event=>state.errors.push(event.message));
const assets=[1,2].map(n=>({id:String(n).repeat(64),name:`Sample ${n}.png`,width:512,height:512,suffix:'.png'}));
let workflow={id:'a'.repeat(32),name:'Advanced workflows',revision:1,assets,stages:[],scene_notes:'',mode:'stages',
  prompt_settings:{prompt:'A studio portrait',negative_prompt:'',seed:123,steps:16,guidance:5}};
const catalog={operations:operations.map(id=>({id,label:id,supported:true,help:`Configure ${id}.`})),providers:[
  ...operations.map((operation,i)=>({id:['local-sdxl-controlnet','local-sdxl-ip-adapter','local-sdxl-outpaint','local-realesrgan'][i],name:['Canny ControlNet','IP-Adapter Plus','SDXL outpainting','Real-ESRGAN'][i],operations:[operation],available:true,models:operation==='upscale'?[]:[{id:'test',name:'Installed SDXL'}]})),
  {id:'pillow-lanczos',name:'Lanczos',operations:['upscale'],available:true,models:[]}]};
window.fetch=async(url,options={})=>{
  const pathname=new URL(url,location.href).pathname;let data;
  if(pathname==='/image-workflows/capabilities')data=catalog;
  else if(pathname==='/image-workflows'&&options.method==='POST')data=workflow;
  else if(pathname==='/image-workflows')data={workflows:[],warnings:[]};
  else if(pathname.endsWith('/image-vault/status'))data={locked:false,hidden_hashes:[]};
  else if(pathname.endsWith('/jobs'))data={jobs:[]};
  else if(options.method==='PUT'){const body=JSON.parse(options.body);state.saves.push(body);workflow={...workflow,...body,revision:workflow.revision+1};data=workflow;}
  else if(pathname.endsWith('/preflight'))data={ready:true,inputs_valid:true,issues:[],plan:[],revision:workflow.revision};
  else if(pathname.includes('/assets/'))return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="steelblue"/></svg>',{headers:{'Content-Type':'image/svg+xml'}});
  else if(pathname==='/faces/characters')data={characters:[]};
  else data={};
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
createRoot(document.getElementById('root')).render(<ImageWorkflows active/>);
