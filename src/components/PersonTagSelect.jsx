import {tagList} from './ReviewTags';

// The same saved tag palette supplies names on folders and individual faces.
export default function PersonTagSelect({names=[],value,onChange,label='Name from Tags',disabled=false}) {
  const choices=tagList(names).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));
  const selected=choices.find(name=>name.toLowerCase()===value.trim().toLowerCase())||'';
  return <label className="vr-person-tag-select">Name from Tags<select aria-label={label} disabled={disabled||!choices.length} value={selected}
    onChange={event=>{if(event.target.value)onChange(event.target.value);}}>
    <option value="">{choices.length?'Choose a saved tag…':'No saved tags yet'}</option>
    {choices.map(name=><option key={name} value={name}>{name}</option>)}
  </select></label>;
}
