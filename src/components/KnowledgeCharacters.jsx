import {useEffect,useRef,useState} from 'react';
import * as faces from '../faceApi';
import {addToKnowledgeBase} from '../api';
import {useCharacterWorkspace} from '../CharacterWorkspace';
import {characterIdFromDocument,characterNoteFile} from '../characterKnowledge';

export function KnowledgeCharacterStart({active,nodes,onSelect,onIndexed}) {
  const workspace = useCharacterWorkspace();
  const [open,setOpen] = useState(false), [characters,setCharacters] = useState([]), [id,setId] = useState('');
  const [busy,setBusy] = useState(false), [loading,setLoading] = useState(false), [error,setError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    if (workspace?.knowledgeTarget) {setId(workspace.knowledgeTarget.id);setOpen(true);}
  },[workspace?.knowledgeTarget]);
  useEffect(() => {
    if (!active || !open) return;
    let disposed = false;setLoading(true);setError('');
    faces.listCharacters().then(value => {
      if (disposed) return;
      setCharacters(value.characters);
      setId(current => value.characters.some(item => item.id === current) ? current : value.characters.some(item => item.id === workspace?.selected?.id) ? workspace.selected.id : value.characters[0]?.id || '');
    }).catch(e => {if (!disposed) setError(e.message);}).finally(() => {if (!disposed) setLoading(false);});
    return () => {disposed = true;};
  },[active,open,workspace?.knowledgeTarget]);
  if (!workspace) return null;
  const existing = id && nodes.find(node => characterIdFromDocument(node.filename) === id);
  async function start() {
    if (lock.current || !id) return;
    if (existing) {onSelect(existing.doc_id);setOpen(false);return;}
    lock.current = true;setBusy(true);setError('');
    try {
      const character = await faces.getCharacter(id);
      const result = await addToKnowledgeBase(characterNoteFile(character));
      await onIndexed(result.doc_id);setOpen(false);
    } catch(e) {setError(e.message);}
    finally {lock.current = false;setBusy(false);}
  }
  return <div className="vault-character-start">
    <button type="button" aria-expanded={open} disabled={busy} onClick={() => setOpen(value => !value)}>Start character node</button>
    <button type="button" onClick={() => workspace.openCreator()}>Open Character Creator</button>
    {open && <div className="vault-character-form">
      <label>Saved character <select aria-label="Character for Knowledge node" disabled={busy || loading} value={id} onChange={e => setId(e.target.value)}><option value="">Choose a character…</option>{characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>
      <button type="button" disabled={!id || busy || loading} onClick={start}>{busy ? 'Creating character node…' : existing ? 'Open character node' : 'Create character node'}</button>

      {loading && <p role="status">Loading characters…</p>}
      {!loading && !characters.length && !error && <p>Create a character in Character Creator first. Face images are optional.</p>}
      {error && <p role="alert">{error}</p>}
    </div>}
  </div>;
}

export function CharacterNodePointer({filename,onIndexed}) {
  const workspace = useCharacterWorkspace(), id = characterIdFromDocument(filename);
  const [busy,setBusy] = useState(false), [message,setMessage] = useState('');
  const lock = useRef(false);
  if (!workspace || !id) return null;
  async function refresh() {
    if (lock.current) return;
    lock.current = true;setBusy(true);setMessage('');
    try {const profile = await faces.getCharacter(id);const result = await addToKnowledgeBase(characterNoteFile(profile,filename));await onIndexed(result.doc_id);}
    catch(e) {setMessage(e.message);}
    finally {lock.current = false;setBusy(false);}
  }
  return <div className="vault-character-pointer"><strong>Character profile</strong><code>face_bank/{id}.json</code>
    <button type="button" onClick={() => workspace.openCreator(id)}>Open character</button>
    <button type="button" disabled={busy} onClick={refresh}>{busy ? 'Refreshing character node…' : 'Refresh character node'}</button>
    <button type="button" onClick={async () => {try {await navigator.clipboard.writeText(`[[${filename}]]`);setMessage('Knowledge link copied.');} catch {setMessage('Clipboard unavailable. Copy this link: '+`[[${filename}]]`);}}}>Copy Knowledge link</button>
    {message && <p role="status">{message}</p>}
  </div>;
}
