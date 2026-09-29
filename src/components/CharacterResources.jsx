import {useEffect,useRef,useState} from 'react';
import {apiUrl} from '../api';
import {useCharacterWorkspace} from '../CharacterWorkspace';
import {RESOURCE_KINDS,resourceCatalog,linkResource,editResource,unlinkResource,attachCharacterFile,characterFileUrl} from '../characterResources';
import ProtectedImage from '../ImagePrivacy';
import MediaCardActions from './MediaCardActions';

function ResourceCard({item,active,disabled,onEdit,onUnlink}) {
  const workspace = useCharacterWorkspace(), [note,setNote] = useState(item.note || '');
  const player=useRef(null),[previewError,setPreviewError]=useState(false);
  useEffect(()=>{if(!active)player.current?.pause();},[active]);
  useEffect(()=>setPreviewError(false),[item.target_id,item.available]);
  useEffect(() => setNote(item.note || ''),[item.note]);
  const resource = item.resource, url = item.available && (item.kind === 'file' ? characterFileUrl(item.target_id) : resource?.url ? apiUrl(resource.url) : '');
  return <li className="character-resource-card">
    <strong>{resource?.name || 'Unavailable reference'}</strong>
    <small>{RESOURCE_KINDS[item.kind]}{resource?.category && ` · ${resource.category}`}</small>
    {!item.available && <p>Missing or unavailable in its workspace. The link is retained.</p>}
    {url && resource?.category === 'image' && !previewError && <ProtectedImage src={url} alt={resource.name} loading="lazy" onError={()=>setPreviewError(true)}/>}
    {url && resource?.category === 'image' && <MediaCardActions image={{id:item.target_id,name:resource.name,url,library:item.kind==='image'}}/>}
    {url && resource?.category === 'audio' && <audio ref={player} controls preload="none" src={url} aria-label={`Preview ${resource.name}`} onError={()=>setPreviewError(true)}/>}
    {url && resource?.category === 'video' && <video ref={player} controls playsInline preload="metadata" src={url} aria-label={`Preview ${resource.name}`} onError={()=>setPreviewError(true)}/>}
    {previewError&&<p role="status">{item.kind==='file'?'This file cannot be previewed here. Use Save file to open the original in a compatible viewer.':'This image is unavailable. Check it in the image library.'}</p>}
    <label>Reference notes<textarea aria-label={`Notes for ${resource?.name || 'unavailable reference'}`} rows={2} maxLength={4000} disabled={disabled} value={note} onChange={e => setNote(e.target.value)} placeholder="What identifies this character? For voice references, add the exact spoken words."/></label>
    <div className="face-row">
      <button type="button" disabled={disabled || note === (item.note || '')} onClick={() => onEdit(note)}>Save reference notes</button>
      {item.available && item.kind === 'file' && <a href={characterFileUrl(item.target_id,true)} download={resource.name}>Save file</a>}
      {item.available && resource?.category === 'audio' && workspace && <button type="button" disabled={disabled} onClick={()=>workspace.openVoice({id:item.target_id,name:resource.name,note:item.note})}>Use as voice reference</button>}
      {item.available && !['file','image'].includes(item.kind) && workspace && <button type="button" disabled={disabled} onClick={() => workspace.openResource(item)}>Open {item.kind==='lora_adapter'?'LoRA workspace':RESOURCE_KINDS[item.kind]}</button>}
      <button type="button" disabled={disabled} onClick={onUnlink}>Unlink</button>
    </div>
  </li>;
}

export default function CharacterResources({character,active=true,onChange,disabled,onBusy}) {
  const [kind,setKind] = useState('image'),[items,setItems] = useState([]),[target,setTarget] = useState('');
  const [note,setNote] = useState(''),[query,setQuery] = useState(''),[loading,setLoading] = useState(false);
  const [busy,setBusy] = useState(false),[error,setError] = useState(''),[notice,setNotice] = useState(''),[revision,setRevision] = useState(0);
  const lock=useRef(false),picker=useRef(null);
  useEffect(() => {
    let disposed=false;setLoading(true);setItems([]);setTarget('');setError('');
    resourceCatalog(kind).then(value => {if (!disposed) setItems(value.items.filter(item => kind !== 'character' || item.id !== character.id));})
      .catch(e => {if (!disposed) setError(e.message);}).finally(() => {if (!disposed) setLoading(false);});
    return () => {disposed=true;};
  },[kind,revision,character.id]);
  async function run(action,message) {
    if(lock.current)return;lock.current=true;setBusy(true);onBusy(true);setError('');setNotice('');
    try {await action();await onChange();setNotice(message);setRevision(value=>value+1);}
    catch(e){setError(e.message);}
    finally{lock.current=false;setBusy(false);onBusy(false);}
  }
  const locked=disabled||busy, visible=items.filter(item=>item.name.toLowerCase().includes(query.toLowerCase()));
  return <section className="character-resources" aria-label="Character reference library">
    <h3>Reference library</h3><p className="face-note">Connect anything that defines this character. Existing app resources stay in their workspaces. Uploaded files get a saved app copy. Unlink keeps the source and saved copy.</p>
    <div className="character-resource-picker">
      <label>Reference type<select aria-label="Character reference type" value={kind} disabled={locked} onChange={e=>{setKind(e.target.value);setQuery('');}}>{Object.entries(RESOURCE_KINDS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>Find a reference<input value={query} disabled={locked} onChange={e=>setQuery(e.target.value)} placeholder="Filter by name"/></label>
      <label>Existing resource<select aria-label="Existing character resource" value={target} disabled={locked||loading} onChange={e=>setTarget(e.target.value)}><option value="">{loading?'Loading…':'Choose a resource…'}</option>{visible.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <button type="button" disabled={locked||loading} onClick={()=>setRevision(value=>value+1)}>Refresh choices</button>
      <label>Note for this reference<textarea aria-label="New reference note" value={note} maxLength={4000} disabled={locked} onChange={e=>setNote(e.target.value)} rows={2}/></label>
      <div className="face-row"><button type="button" disabled={locked||loading||!target} onClick={()=>run(async()=>{await linkResource(character.id,kind,target,note);setNote('');},'Reference linked.')}>Link reference</button>
      <button type="button" disabled={locked} onClick={()=>picker.current.click()}>Upload reference file</button></div>
      <input hidden ref={picker} type="file" aria-label="Upload character reference file" disabled={locked} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)run(async()=>{await attachCharacterFile(character.id,file,note);setNote('');},'File saved and linked.');}}/>
      <small>Images, videos, audio, documents, model files, and other files up to 128 MiB. Images up to 24 megapixels. Video playback depends on the file’s codec; the original stays available to save. Use Saved file to link a previous upload again.</small>
    </div>
    {error&&<p role="alert" className="face-alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{busy&&<p role="status">Saving references…</p>}
    <ul className="character-resource-grid">{(character.resources||[]).map(item=><ResourceCard key={item.id} item={item} active={active} disabled={locked}
      onEdit={value=>run(()=>editResource(character.id,item.id,value),'Reference notes saved.')}
      onUnlink={()=>run(()=>unlinkResource(character.id,item.id),'Unlinked. The source and saved file are preserved.')}/>)}</ul>
    {!character.resources?.length&&<p className="face-note">No linked resources yet. Face references are managed below.</p>}
  </section>;
}
