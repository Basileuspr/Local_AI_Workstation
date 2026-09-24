import {useEffect,useState} from 'react';
import {imageSizes} from '../imageSettingsControls';
import {fitDimensions,ratioLabel,ratioSizes,resizeDimensions} from '../imageDimensions';

export default function ImageResolutionControls({width,height,onChange,min=512,max=1536,prefix='',locked:controlled,onLock,sourceSize}) {
  const [localLock,setLocalLock]=useState(true),[text,setText]=useState({width:String(width),height:String(height)}),[error,setError]=useState('');
  const locked=controlled??localLock;
  useEffect(()=>{setText({width:String(width),height:String(height)});},[width,height]);
  const presets=[...new Map(imageSizes.map(p=>({...p,...fitDimensions(p.width,p.height,{min,max})})).filter(p=>p.width>=min&&p.width<=max&&p.height>=min&&p.height<=max).map(p=>[`${p.width}x${p.height}`,p])).values()];
  const sizes=ratioSizes(width,height,{min,max}),index=sizes.findIndex(s=>s.width===width&&s.height===height),value=`${width}x${height}`;
  function commit(key){try{const next=resizeDimensions({width,height},key,text[key],{locked,min,max});onChange(next);setText({width:String(next.width),height:String(next.height)});setError('');}catch(e){setError(e.message);}}
  return <div className="image-resolution-controls">
    <label>Resolution preset<select aria-label={`${prefix}Aspect ratio`} value={value} onChange={e=>{const [w,h]=e.target.value.split('x').map(Number);onChange({width:w,height:h});setError('');}}>
      {!presets.some(p=>`${p.width}x${p.height}`===value)&&<option value={value}>Custom · {width} × {height}</option>}
      {presets.map(p=><option key={`${p.width}x${p.height}`} value={`${p.width}x${p.height}`}>{p.label} · {p.width} × {p.height}</option>)}
    </select></label>
    <div className="image-dimension-fields">{['width','height'].map(key=><label key={key}>{key==='width'?'Width':'Height'}<input aria-label={`${prefix}${key==='width'?'Width':'Height'}`} type="number" min={min} max={max} step="8" value={text[key]} onChange={e=>setText({...text,[key]:e.target.value})} onBlur={()=>commit(key)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}}}/></label>)}</div>
    <label className="image-ratio-lock"><input aria-label={`${prefix}Lock aspect ratio`} type="checkbox" checked={locked} onChange={e=>onLock?onLock(e.target.checked):setLocalLock(e.target.checked)}/> Lock aspect ratio · {ratioLabel(width,height)}</label>
    {sizes.length>1&&<label>Scale · {width} × {height}<input aria-label={`${prefix}Resolution scale`} type="range" min="0" max={sizes.length-1} value={Math.max(0,index)} onChange={e=>onChange(sizes[Number(e.target.value)])}/></label>}
    <div className="image-quick-buttons">{[512,768,1024].filter(v=>v>=min&&v<=max).map(v=><button type="button" key={v} onClick={()=>{onChange({width:v,height:v});setError('');}}>{v} × {v}</button>)}
    {sourceSize&&<button type="button" onClick={()=>{const next=fitDimensions(sourceSize.width,sourceSize.height,{min,max});if(next){onChange(next);setError('');}else setError('The source is too wide or tall for these limits. Choose an output ratio.');}}>Match source proportions</button>}
    </div><small>{min}–{max} pixels per side, multiples of 8. Locked resizing preserves the ratio; unlocked values round to the nearest supported size.</small>
    {error&&<p role="alert">{error}</p>}
  </div>;
}
