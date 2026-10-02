import {useEffect,useRef,useState} from 'react';
import {DEFAULT_MATERIAL} from '../modelViewer/editor';
import {imageTexture,MATERIAL_PRESETS,proceduralTexture,qrTexture,stampTexture,STAMPS,TEXTURES} from '../modelViewer/materials';

export default function ModelPaint({disabled,onPaint,onPick,brush,onBrush,onError}){
  const [transparent,setTransparent]=useState(true),[url,setUrl]=useState(''),[recent,setRecent]=useState([]),[loading,setLoading]=useState(false),[camera,setCamera]=useState(false);
  const input=useRef(null),video=useRef(null),stream=useRef(null),mounted=useRef(true),cameraTicket=useRef(0);
  const material=brush||DEFAULT_MATERIAL;
  function stopCamera(){cameraTicket.current++;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;setCamera(false);void window.workstationDesktop?.end3DTextureCamera?.();}
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;cameraTicket.current++;stream.current?.getTracks().forEach(t=>t.stop());void window.workstationDesktop?.end3DTextureCamera?.();};},[]);
  useEffect(()=>{if(camera&&video.current&&stream.current){video.current.srcObject=stream.current;video.current.play().catch(()=>onError('Camera preview could not start.'));}},[camera]);
  function apply(patch){const next={...material,...patch};onBrush(next);onPaint(patch);}
  async function texture(create,name){
    if(disabled||loading)return;setLoading(true);
    try{const data=await create();if(!mounted.current)return;const next={mapData:data,textureName:name};apply(next);setRecent(items=>[{name,data},...items.filter(item=>item.data!==data)].slice(0,6));}
    catch(error){if(mounted.current)onError(error.message);}finally{if(mounted.current)setLoading(false);}
  }
  async function startCamera(){
    const ticket=++cameraTicket.current;setLoading(true);
    try{
      if(window.workstationDesktop){if(!window.workstationDesktop.request3DTextureCamera)throw Error('Restart the desktop app to enable camera textures.');const permission=await window.workstationDesktop.request3DTextureCamera();if(!permission?.allowed){if(permission?.error)throw Error(permission.error);return;}}
      if(!mounted.current||ticket!==cameraTicket.current)return;
      const media=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720}},audio:false});
      if(!mounted.current||ticket!==cameraTicket.current){media.getTracks().forEach(t=>t.stop());return;}stream.current=media;setCamera(true);
    }catch(error){onError(`Camera: ${error.message}`);void window.workstationDesktop?.end3DTextureCamera?.();}finally{if(mounted.current)setLoading(false);}
  }
  function capture(){if(!video.current?.videoWidth)return;const c=document.createElement('canvas');c.width=video.current.videoWidth;c.height=video.current.videoHeight;c.getContext('2d').drawImage(video.current,0,0);void texture(()=>c.toDataURL('image/png'),'Camera');stopCamera();}
  return <div className="model-paint" aria-label="Paint tools">
    <div className="model-toolbar"><label>Material <select disabled={disabled} value="" onChange={e=>apply(MATERIAL_PRESETS[e.target.value])}><option value="">Choose preset…</option>{Object.keys(MATERIAL_PRESETS).map(name=><option key={name}>{name}</option>)}</select></label>
      <label>Color <input aria-label="Paint color" type="color" value={material.color} disabled={disabled} onChange={e=>apply({color:e.target.value,vertexColors:false})}/></label>
      <button disabled={disabled} onClick={()=>apply({mapData:null,textureName:null})}>Remove texture</button>
      <button disabled={disabled} onClick={()=>onPaint(material)}>Apply brush</button>
    </div>
    <div className="model-paint-values">{[['roughness','Roughness'],['metalness','Metallic'],['opacity','Opacity']].map(([key,label])=><label key={key}>{label}<input aria-label={label} type="number" min="0" max="1" step=".05" value={material[key]} disabled={disabled} onChange={e=>{const value=Number(e.target.value);if(value>=0&&value<=1)apply({[key]:value});}}/></label>)}</div>
    <div className="model-toolbar"><button disabled={disabled||loading} onClick={()=>input.current.click()}>Load texture</button><button disabled={disabled||loading} onClick={onPick}>Texture picker</button><button disabled={disabled||loading} onClick={camera?stopCamera:startCamera}>{camera?'Stop camera':'Camera'}</button>
      <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files[0];if(file)void texture(()=>imageTexture(file),file.name);e.target.value='';}}/>
    </div>
    {camera&&<div className="model-camera"><video ref={video} autoPlay muted playsInline aria-label="Texture camera preview"/><button onClick={capture}>Capture texture</button><button onClick={stopCamera}>Cancel camera</button></div>}
    <div className="model-toolbar"><label>Generate QR texture for <input aria-label="QR URL" type="url" placeholder="https://example.com" value={url} onChange={e=>setUrl(e.target.value)} maxLength={2048}/></label><button disabled={disabled||loading||!url.trim()} onClick={()=>texture(()=>qrTexture(url.trim(),transparent),'QR code')}>Generate QR</button></div>
    <label className="model-check"><input type="checkbox" checked={transparent} onChange={e=>setTransparent(e.target.checked)}/> Transparent stamp / QR background</label>
    {loading&&<p role="status">Preparing texture…</p>}
    {recent.length>0&&<><h3>Recent materials</h3><div className="model-swatches">{recent.map((item,i)=><button key={i} title={item.name} aria-label={`Use recent ${item.name}`} disabled={disabled||loading} onClick={()=>texture(()=>item.data,item.name)}><img alt="" src={item.data}/></button>)}</div></>}
    <details open><summary>Textures</summary><div className="model-swatches">{TEXTURES.map(([name,color,kind])=><button key={name} title={name} aria-label={`Texture ${name}`} disabled={disabled||loading} onClick={()=>texture(()=>proceduralTexture(name),name)}><span className={`model-texture-chip ${kind}`} style={{backgroundColor:color}}/><small>{name}</small></button>)}</div></details>
    <details><summary>Shape stamps</summary><div className="model-stamps">{STAMPS.map(name=><button key={name} disabled={disabled||loading} onClick={()=>texture(()=>stampTexture(name,material.color,transparent),name)}>{name}</button>)}</div></details>

  </div>;
}
