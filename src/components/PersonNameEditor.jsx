import {useEffect,useState} from 'react';

export default function PersonNameEditor({personId,name,label,busy,act,onRename}) {
  const [draft,setDraft]=useState(name);
  useEffect(()=>setDraft(name),[personId,name]);
  return <form className="vr-person-name" onSubmit={event=>{
    event.preventDefault();
    const next=draft.trim();
    if(!busy&&next&&next!==name)act(()=>onRename(personId,next));
  }}>
    <label>Name<input aria-label={label} value={draft} maxLength={120} disabled={busy}
      onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setDraft(name);}
      }}/></label>
    <button type="submit" disabled={busy||!draft.trim()||draft.trim()===name}>Save name</button>
  </form>;
}
