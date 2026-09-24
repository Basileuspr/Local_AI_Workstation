import {useState} from 'react';
import {BATCH_FIELDS,buildImageBatch,batchLabel} from '../imageBatch';
export default function ImageBatchControls({settings,onChange,onSubmit,disabled}) {
  const [count,setCount]=useState(4),[increments,setIncrements]=useState({seed:1}),[submitting,setSubmitting]=useState(false),[notice,setNotice]=useState('');
  let rows=[],error='';try{rows=buildImageBatch(settings,count,increments);}catch(e){error=e.message;}
  return <details className="image-batch"><summary>Batch requests · vary settings per image</summary>
    <p>Start with the settings above, then add each enabled increment for the next image. All enabled settings advance together. A blank starting seed uses 1 when Seed is enabled.</p>
    <label>Images in batch<input aria-label="Images in batch" type="number" min="1" max="32" value={count} onChange={e=>setCount(e.target.value)}/></label>
    <div className="image-batch-fields">{BATCH_FIELDS.map(field=><div key={field.key}>
      <label className="image-ratio-lock"><input aria-label={`Vary ${field.label}`} type="checkbox" disabled={field.key==='loraScale'&&!settings.loraId&&increments[field.key]===undefined} checked={increments[field.key]!==undefined} onChange={e=>{const next={...increments};if(e.target.checked)next[field.key]=field.key==='seed'||field.key==='steps'?1:field.step;else delete next[field.key];setIncrements(next);}}/>{field.label}</label>
      {increments[field.key]!==undefined&&<><label>Start<input aria-label={`Batch starting ${field.label}`} type="number" min={field.min} max={field.max} step={field.step} value={field.key==='seed'&&settings.seed===''?1:settings[field.key]??1} onChange={e=>onChange({[field.key]:e.target.value})}/></label><label>Increment<input aria-label={`Batch ${field.label} increment`} type="number" step={field.step} value={increments[field.key]} onChange={e=>setIncrements({...increments,[field.key]:e.target.value})}/></label></>}
    </div>)}</div>
    {error?<p role="alert">{error}</p>:<div className="image-batch-preview"><table><caption>Batch preview · {rows.length} requests</caption><thead><tr><th>#</th><th>Seed</th><th>Steps</th><th>Guidance</th><th>LoRA</th></tr></thead><tbody>{rows.map((row,i)=><tr key={i}><td>{i+1}</td><td>{row.seed===''?'Random':row.seed}</td><td>{row.steps}</td><td>{row.guidanceScale}</td><td>{row.loraId?row.loraScale:'None'}</td></tr>)}</tbody></table></div>}
    <button type="button" disabled={disabled||submitting||!!error} onClick={async()=>{setSubmitting(true);setNotice('');try{const accepted=await onSubmit(rows.map((row,i)=>({settings:{...row},label:batchLabel(row,i,rows.length)})));setNotice(accepted?`${rows.length} requests submitted. Follow or stop them in the request list and Prompt Queue.`:'Batch was not submitted. Check the message above.');}catch(e){setNotice(e.message);}finally{setSubmitting(false);}}}>Queue batch ({rows.length})</button>
    {notice&&<p role="status">{notice}</p>}
  </details>;
}
