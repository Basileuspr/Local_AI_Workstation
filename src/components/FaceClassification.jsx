import {useId,useState} from 'react';
import {apiUrl} from '../api';
import PersonNameEditor from './PersonNameEditor';
import PersonTagSelect from './PersonTagSelect';

function FaceEditor({face,people,names,busy,act,onCorrect}) {
  const [changing,setChanging]=useState(false),[target,setTarget]=useState(''),[newName,setNewName]=useState('');
  const choicesId=useId();
  return <div className="vr-face-editor">
    <div className="vr-actions">
      <button type="button" disabled={busy} aria-expanded={changing} onClick={()=>setChanging(!changing)}>Change person</button>
      <button type="button" disabled={busy} onClick={()=>act(()=>onCorrect(face,{person_id:face.person_id,exclude:true},'Face removed from grouping.'))}>Not a face</button>
    </div>
    {changing&&<form className="vr-correction" onSubmit={event=>{event.preventDefault();act(async()=>{
      await onCorrect(face,target==='new'?{person_id:null,...(newName.trim()?{name:newName.trim()}:{})}:{person_id:target},'Face moved to another person.');
      setChanging(false);
    });}}>
      <label>This face belongs to<select aria-label="Move face to person" value={target} disabled={busy} onChange={event=>setTarget(event.target.value)}>
        <option value="">Choose a person…</option><option value="new">A new person…</option>
        {people.filter(person=>person.id!==face.person_id).map(person=><option key={person.id} value={person.id}>{person.name}</option>)}
      </select></label>
      {target==='new'&&<><label>Person’s name (optional)<input aria-label="New person name" value={newName} list={choicesId} maxLength={120} disabled={busy} onChange={event=>setNewName(event.target.value)} placeholder="Add or choose a name"/></label><datalist id={choicesId}>{names.map(name=><option key={name} value={name}/>)}</datalist></>}
      {target==='new'&&<PersonTagSelect names={names} value={newName} onChange={setNewName} label="New person name from Tags" disabled={busy}/>}
      <div className="vr-actions"><button disabled={busy||!target}>Move face</button><button type="button" disabled={busy} onClick={()=>setChanging(false)}>Cancel</button></div>
    </form>}
  </div>;
}

export default function FaceClassification({classification,people=[],names=[],focusPerson='',busy,act,onRename,onCorrect,undo,onUndo}) {
  const [selected,setSelected]=useState(null);
  const faces=classification.faces;
  const current=faces.find(face=>face.id===selected)||faces.find(face=>face.person_id===focusPerson)||faces[0];
  return <section className="vr-face-section" aria-label="People in this photo">
    <h3>People in this photo</h3>
    {faces.length>0?<>
      <div className="vr-faces">{faces.map((face,index)=><article className="vr-person-card" key={face.id}>
        <button type="button" disabled={busy} aria-pressed={current?.id===face.id} aria-label={`Edit face ${index+1}: ${face.name}`} onClick={()=>setSelected(face.id)}>
        <img src={apiUrl(`/visual-review/faces/${face.id}`)} alt=""/><span>{face.name}</span>
        </button>
        <PersonNameEditor personId={face.person_id} name={face.name} label={`Face ${index+1} name`} busy={busy} act={act} onRename={onRename} names={names} canMerge={people.some(person=>person.id!==face.person_id&&person.name.trim().toLowerCase()===face.name.trim().toLowerCase())}/>
      </article>)}</div>
      <FaceEditor key={`${current.id}:${current.person_id}:${current.name}`} face={current} people={people} names={names} busy={busy} act={act} onCorrect={onCorrect}/>
    </>:<p>{classification.faces_done?'No faces are grouped in this photo.':'This photo has not been scanned for faces yet. Use Group faces and classify it first.'}</p>}
    {undo&&<div className="vr-undo" role="status"><span>{undo.message}</span><button disabled={busy} onClick={()=>act(onUndo)}>Undo last face correction</button></div>}
  </section>;
}
