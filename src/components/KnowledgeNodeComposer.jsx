import { useEffect, useRef, useState } from "react";
import { knowledgeGraphRequest } from "../api";
import { KNOWLEDGE_NODE_KINDS, knowledgeNodeDraft } from "../knowledgeNodes";
import { listCharacters } from '../faceApi';
import { useCharacterWorkspace } from '../CharacterWorkspace';

export function KnowledgeNodeForm({ draft, onChange, disabled, submitLabel, onSubmit, onCancel }) {
  const workspace = useCharacterWorkspace();
  const [characters, setCharacters] = useState([]), [characterError, setCharacterError] = useState('');
  const [loadingCharacters, setLoadingCharacters] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (draft.kind !== 'character') return;
    let disposed = false; setLoadingCharacters(true); setCharacterError('');
    listCharacters().then(value => { if (!disposed) setCharacters(value.characters || []); })
      .catch(error => { if (!disposed) setCharacterError(error.message); })
      .finally(() => { if (!disposed) setLoadingCharacters(false); });
    return () => { disposed = true; };
  }, [draft.kind, retry]);
  const kind = KNOWLEDGE_NODE_KINDS.find(item => item.value === draft.kind);
  return <form className="vault-compose-form" onSubmit={onSubmit}>
    <fieldset disabled={disabled}>
      <legend className="vault-compose-legend">{submitLabel}</legend>
      <div className="vault-compose-heading">
        <label>Node title<input required maxLength={100} value={draft.title} onChange={event => onChange({ ...draft, title: event.target.value })} placeholder="Give this node a name…" /></label>
        <label>Node type<select value={draft.kind} onChange={event => onChange({ ...draft, kind: event.target.value })}>{KNOWLEDGE_NODE_KINDS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      </div>
      <p className="vault-node-kind-hint" role="status">{kind?.hint}</p>
      {draft.kind === 'character' && <div className="vault-node-character-fields">
        <label>Saved character profile (optional)<select aria-label="Linked character profile" disabled={loadingCharacters} value={draft.character_id || ''} onChange={event => onChange({ ...draft, character_id: event.target.value })}>
          <option value="">No linked profile</option>
          {!!draft.character_id && !characters.some(item => item.id === draft.character_id) && <option value={draft.character_id}>Previously linked profile (unavailable)</option>}
          {characters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        {loadingCharacters && <small>Loading character profiles…</small>}
        {characterError && <p role="alert">{characterError} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry profiles</button></p>}
        <small>A character node can have its own notes. Linking a profile keeps those notes intact.</small>
        {workspace && draft.character_id && <button type="button" onClick={() => workspace.openCreator(draft.character_id)}>Open linked character</button>}
      </div>}
      <label>{draft.kind === 'character' ? 'Character notes' : 'Node content'}<textarea rows={5} maxLength={100000} value={draft.text} onChange={event => onChange({ ...draft, text: event.target.value })} placeholder={draft.kind === 'character' ? 'Add a biography, traits, background, or other character criteria…' : 'Write here, paste text, or keep just a title. Use [[another node title]] to link nodes.'} /></label>

      <div className="vault-compose-actions"><button type="submit" disabled={!draft.title.trim()}>{submitLabel}</button>{onCancel && <button type="button" onClick={onCancel}>Close</button>}</div>
    </fieldset>
  </form>;
}

export function KnowledgeNodeContent({ node, active, onSaved, onPreview, disabled, initiallyOpen = false }) {
  const [open, setOpen] = useState(initiallyOpen), [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [message, setMessage] = useState(""), [retry, setRetry] = useState(0), lock = useRef(false);
  const baseline = useRef(null), form = useRef(null), focused = useRef(false);
  useEffect(() => { if (initiallyOpen) setOpen(true); }, [initiallyOpen]);
  useEffect(() => {
    if (initiallyOpen && draft && !focused.current) {
      focused.current = true; const input = form.current?.querySelector('input'); input?.focus(); input?.select();
    }
  }, [initiallyOpen, draft]);
  useEffect(() => {
    if (!open || !active || draft) return;
    let disposed = false; setError("");
    knowledgeGraphRequest(`/nodes/${encodeURIComponent(node.doc_id)}`, "GET", undefined, false)
      .then(result => {
        if (!disposed) {
          const saved = { title: result.title, kind: result.kind, text: result.text, character_id: result.character_id || '' };
          baseline.current = JSON.stringify(saved); setDraft(saved);
        }
      })
      .catch(failure => { if (!disposed) setError(failure.message); });
    return () => { disposed = true; };
  }, [open, active, node.doc_id, retry, draft]);
  async function save(event) {
    event.preventDefault(); if (lock.current || disabled) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const payload = knowledgeNodeDraft(draft);
      await knowledgeGraphRequest(`/nodes/${encodeURIComponent(node.doc_id)}`, "PUT", payload, false);
      const saved = { ...payload, character_id: payload.character_id || '' };
      baseline.current = JSON.stringify(saved); setDraft(saved);
      try { await onSaved(node.doc_id); onPreview?.(null); setMessage("Node content saved and indexed."); }
      catch (failure) { throw new Error(`The node was saved, but the view could not refresh. ${failure.message}`); }
    } catch (failure) { setError(failure.message); }
    finally { lock.current = false; setBusy(false); }
  }
  const dirty = draft && JSON.stringify(draft) !== baseline.current;
  return <details className="vault-node-content" ref={form} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Edit node details</summary>
    {open && (draft ? <>
      <KnowledgeNodeForm draft={draft} onChange={value => { setDraft(value); onPreview?.(value); setMessage(''); setError(''); }} disabled={busy || disabled} submitLabel={busy ? "Saving content…" : "Save content"} onSubmit={save} />
      {dirty && <p className="vault-node-dirty" role="status">Unsaved {KNOWLEDGE_NODE_KINDS.find(item => item.value === draft.kind)?.label.toLowerCase()} changes · Save content to keep them.</p>}
    </> : !error && <p role="status">Loading node content…</p>)}
    {error && <p role="alert">{error}{!draft && <button onClick={() => setRetry(value => value + 1)}>Retry</button>}</p>}
    {message && <p role="status">{message}</p>}
  </details>;
}
