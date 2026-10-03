import {useEffect,useId,useState} from 'react';
import {tagList} from './ReviewTags';
import PersonTagSelect from './PersonTagSelect';

export default function PersonNameEditor({personId,name,label,busy,act,onRename,names=[],canMerge=false}) {
  const [draft,setDraft]=useState(name);
  const choicesId=useId(),choices=tagList(names).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));
  useEffect(()=>setDraft(name),[personId,name]);
  return <form className="vr-person-name" onSubmit={event=>{
    event.preventDefault();
    const next=draft.trim();
    if(!busy&&next&&(next!==name||canMerge))act(()=>onRename(personId,next));
  }}>
    <label>Name<input aria-label={label} value={draft} list={choicesId} maxLength={120} disabled={busy}
      onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setDraft(name);}
      }}/></label>
    <datalist id={choicesId}>{choices.map(choice=><option key={choice} value={choice}/>)}</datalist>
    <PersonTagSelect names={choices} value={draft} onChange={setDraft} label={`${label} from Tags`} disabled={busy}/>
    <button type="submit" disabled={busy||!draft.trim()||(draft.trim()===name&&!canMerge)}>Save name</button>
  </form>;
}
