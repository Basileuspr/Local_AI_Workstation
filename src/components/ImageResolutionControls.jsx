import {useEffect,useState} from 'react';
import {fitDimensions,ratioLabel,ratioSizes,resizeDimensions} from '../imageDimensions';

export const ASPECT_RATIOS = [[1,1],[4,3],[3,2],[16,9],[21,9],[3,4],[2,3],[9,16],[9,21]];

export default function ImageResolutionControls({width,height,onChange,min=256,max=1536,prefix='',locked:controlled,onLock,sourceSize}) {
  const [localLock,setLocalLock]=useState(true),[text,setText]=useState({width:String(width),height:String(height)}),[error,setError]=useState('');
  const locked=controlled??localLock;
  useEffect(()=>{setText({width:String(width),height:String(height)});},[width,height]);
  const sizes=ratioSizes(width,height,{min,max}),index=sizes.findIndex(s=>s.width===Number(width)&&s.height===Number(height)),value=`${width}x${height}`;
  const ratio=ratioLabel(width,height),knownRatio=ASPECT_RATIOS.find(([w,h])=>ratioLabel(w,h)===ratio);
  const nearest = target => sizes.reduce((best,size)=>Math.abs(Math.max(size.width,size.height)-target)<Math.abs(Math.max(best.width,best.height)-target)?size:best, sizes[0]);
  const presets=[...new Map([sizes[0],...[256,384,512,768,1024,1280,1536,1792,2048].filter(n=>n>=min&&n<=max).map(nearest),sizes.at(-1)].filter(Boolean).map(p=>[`${p.width}x${p.height}`,p])).values()];
  function changeRatio(value) {
    const [w,h]=value.split(':').map(Number),options=ratioSizes(w,h,{min,max}),target=Math.max(Number(width),Number(height));
    const size=options.reduce((best,item)=>Math.abs(Math.max(item.width,item.height)-target)<Math.abs(Math.max(best.width,best.height)-target)?item:best,options[0]);
    if(size){onChange(size);setError('');}
  }
  function commit(key){try{const next=resizeDimensions({width,height},key,text[key],{locked,min,max});onChange(next);setText({width:String(next.width),height:String(next.height)});setError('');}catch(e){setError(e.message);}}
  return <div className="image-resolution-controls">
    <label>Aspect ratio<select aria-label={`${prefix}Aspect ratio`} value={knownRatio?knownRatio.join(':'):'custom'} onChange={e=>changeRatio(e.target.value)}>
      {!knownRatio&&<option value="custom">Custom · {ratio}</option>}
      {ASPECT_RATIOS.filter(([w,h])=>ratioSizes(w,h,{min,max}).length).map(([w,h])=><option key={`${w}:${h}`} value={`${w}:${h}`}>{w===h?'Square':w>h?'Landscape':'Portrait'} · {w}:{h}</option>)}
    </select></label>
    <label>Resolution<select aria-label={`${prefix}Resolution`} value={value} onChange={e=>{const [w,h]=e.target.value.split('x').map(Number);onChange({width:w,height:h});setError('');}}>
      {!presets.some(p=>`${p.width}x${p.height}`===value)&&<option value={value}>Custom · {width} × {height}</option>}
      {presets.map(p=><option key={`${p.width}x${p.height}`} value={`${p.width}x${p.height}`}>{p.width} × {p.height}</option>)}
    </select></label>
    <div className="image-dimension-fields">{['width','height'].map(key=><label key={key}>{key==='width'?'Width':'Height'}<input aria-label={`${prefix}${key==='width'?'Width':'Height'}`} type="number" min={min} max={max} step="8" value={text[key]} onChange={e=>setText({...text,[key]:e.target.value})} onBlur={()=>commit(key)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}}}/></label>)}</div>
    <label className="image-ratio-lock"><input aria-label={`${prefix}Lock aspect ratio`} type="checkbox" checked={locked} onChange={e=>onLock?onLock(e.target.checked):setLocalLock(e.target.checked)}/> Lock aspect ratio · {ratioLabel(width,height)}</label>
    {sizes.length>1&&<label>Scale · {width} × {height}<input aria-label={`${prefix}Resolution scale`} type="range" min="0" max={sizes.length-1} value={Math.max(0,index)} onChange={e=>onChange(sizes[Number(e.target.value)])}/></label>}
    <div className="image-quick-buttons">
    {sourceSize&&<button type="button" onClick={()=>{const next=fitDimensions(sourceSize.width,sourceSize.height,{min,max});if(next){onChange(next);setError('');}else setError('The source is too wide or tall for these limits. Choose an output ratio.');}}>Match source proportions</button>}
    </div><small>{min}–{max} pixels per side, multiples of 8. Locked resizing preserves the ratio; unlocked values round to the nearest supported size.</small>
    {error&&<p role="alert">{error}</p>}
  </div>;
}
