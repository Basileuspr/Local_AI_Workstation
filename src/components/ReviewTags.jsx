import {useEffect,useRef,useState} from 'react';

export function tagList(value) {
  const names=new Map();
  for(const name of (Array.isArray(value)?value:value.split(',')).map(value=>value.trim()).filter(Boolean)) {
    if(!names.has(name.toLowerCase()))names.set(name.toLowerCase(),name);
  }
  return [...names.values()];
}

export default function ReviewTags({value,available=[],disabled=false,maxLength=80,onChange,onApply=onChange}) {
  const [selected,setSelected]=useState(''),[created,setCreated]=useState('');
  const [text,setText]=useState(value.join(', ')),edited=useRef(null);
  useEffect(()=>{if(edited.current!==value)setText(value.join(', '));},[value]);
  function edit(text){setText(text);edited.current=tagList(text);onChange(edited.current);}
  const choices=tagList([...available,...tagList(value)]).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));
  const newTag=created.trim(),current=tagList(value);
  const apply=name=>onApply(tagList([...current,name]));
  return <section className="vr-tags" aria-label="Image tags">
    <label>Tags on this image<input aria-label="Review tags" disabled={disabled} value={text} onChange={event=>edit(event.target.value)} placeholder="Tags, separated by commas"/></label>
    <div className="vr-actions">
      <label>Existing tag<select aria-label="Existing review tag" disabled={disabled||!choices.length} value={choices.includes(selected)?selected:''} onChange={event=>setSelected(event.target.value)}>
        <option value="">{choices.length?'Choose a saved tag':'No saved tags yet'}</option>{choices.map(name=><option key={name} value={name}>{name}</option>)}
      </select></label>
      <button type="button" disabled={disabled||!selected||!choices.includes(selected)} onClick={()=>apply(selected)}>Apply existing tag</button>
    </div>
    <div className="vr-actions">
      <label>New tag name<input aria-label="New review tag name" disabled={disabled} maxLength={maxLength} value={created} onChange={event=>setCreated(event.target.value)} placeholder="Enter a tag name"/></label>
      <button type="button" disabled={disabled||!newTag||newTag.includes(',')} onClick={()=>apply(choices.find(name=>name.toLowerCase()===newTag.toLowerCase())||newTag)}>Create & apply tag</button>
    </div>

  </section>;
}
