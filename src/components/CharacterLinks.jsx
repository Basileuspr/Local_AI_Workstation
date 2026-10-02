import {useCallback,useEffect,useRef,useState} from 'react';
import {listCharacters} from '../faceApi';
import {linkResource,linkedCharacters,unlinkResource} from '../characterResources';
import {useCharacterWorkspace} from '../CharacterWorkspace';
import './CharacterLinks.css';

/** Optional, explicit ties from a workspace item to Character Creator profiles. */
export default function CharacterLinks({kind,targetId,label,disabled=false}) {
  const workspace = useCharacterWorkspace();
  const [characters,setCharacters] = useState([]),[links,setLinks] = useState([]),[loaded,setLoaded] = useState(false);
  const [choice,setChoice] = useState(''),[note,setNote] = useState('');
  const [busy,setBusy] = useState(false),[error,setError] = useState(''),[notice,setNotice] = useState('');
  const lock = useRef(false),serial = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++serial.current;
    const [all,linked] = await Promise.all([listCharacters(),linkedCharacters(kind,targetId)]);
    if (request !== serial.current) return;
    setCharacters(all.characters);setLinks(linked.characters);setLoaded(true);
  },[kind,targetId]);
  useEffect(() => {
    setLoaded(false);setLinks([]);setNote('');setError('');setNotice('');
    if (targetId) refresh().catch(e => setError(e.message));
    return () => {serial.current++;};
  },[refresh,targetId]);
  async function run(action,message) {
    if (lock.current) return;
    lock.current = true;setBusy(true);setError('');setNotice('');
    try {await action();setNotice(message);await refresh();}
    catch (e) {setError(e.message);}
    finally {lock.current = false;setBusy(false);}
  }
  const untied = characters.filter(character => !links.some(link => link.character_id === character.id));
  const preferred = workspace?.selected?.id;
  const current = untied.some(item => item.id === choice) ? choice : untied.some(item => item.id === preferred) ? preferred : '';
  const chosen = untied.find(item => item.id === current), locked = disabled || busy;
  return <section className="character-links" aria-label={`Characters tied to this ${label}`}>
    <h3>Characters</h3>
    <p className="character-links-note">Optional. Tying this {label} to a character lists it in that profile’s reference library. Nothing is copied, moved or trained.</p>
    {loaded && (links.length ? <ul className="character-links-list">{links.map(link => <li key={link.link_id}>
      <span><strong>{link.name}</strong>{link.note && <small>{link.note}</small>}</span>
      {workspace && <button type="button" disabled={locked} onClick={() => workspace.openCreator(link.character_id,{refresh:true})}>Open character</button>}
      <button type="button" disabled={locked} onClick={() => run(() => unlinkResource(link.character_id,link.link_id),`Untied from ${link.name}. The ${label} is unchanged.`)}>Untie</button>
    </li>)}</ul> : <p className="character-links-note">Not tied to a character.</p>)}
    {loaded && (untied.length ? <div className="character-links-add">
      <label>Character<select aria-label={`Character to tie this ${label} to`} value={current} disabled={locked} onChange={e => setChoice(e.target.value)}>
        <option value="">Choose a character…</option>{untied.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>Note (optional)<input aria-label={`Note for this ${label}`} value={note} maxLength={4000} disabled={locked} onChange={e => setNote(e.target.value)} placeholder="How it relates to the character"/></label>
      <button type="button" disabled={locked || !chosen} onClick={() => run(async () => {await linkResource(chosen.id,kind,targetId,note);setNote('');},`Tied to ${chosen?.name}.`)}>Tie to character</button>
    </div> : !characters.length && <p className="character-links-note">No characters yet.{workspace && <> <button type="button" onClick={() => workspace.openCreator()}>Open Character Creator</button></>}</p>)}
    {error && <p role="alert" className="character-links-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
