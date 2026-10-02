import { useEffect, useRef, useState } from "react";
import { knowledgeGraphRequest } from "../api";
import { KNOWLEDGE_NODE_KINDS, knowledgeNodeDraft } from "../knowledgeNodes";

export function KnowledgeNodeForm({ draft, onChange, disabled, submitLabel, onSubmit, onCancel }) {
  return <form className="vault-compose-form" onSubmit={onSubmit}>
    <fieldset disabled={disabled}>
      <legend className="vault-compose-legend">{submitLabel}</legend>
      <div className="vault-compose-heading">
        <label>Node title<input required maxLength={100} value={draft.title} onChange={event => onChange({ ...draft, title: event.target.value })} placeholder="Give this node a name…" /></label>
        <label>Node type<select value={draft.kind} onChange={event => onChange({ ...draft, kind: event.target.value })}>{KNOWLEDGE_NODE_KINDS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      </div>
      <label>Node content<textarea rows={5} maxLength={100000} value={draft.text} onChange={event => onChange({ ...draft, text: event.target.value })} placeholder="Write here, paste text, or start with just a title. Use [[another node title]] to link nodes." /></label>

      <div className="vault-compose-actions"><button type="submit" disabled={!draft.title.trim()}>{submitLabel}</button>{onCancel && <button type="button" onClick={onCancel}>Close</button>}</div>
    </fieldset>
  </form>;
}

export default function KnowledgeNodeComposer({ open, onClose, onCreated, disabled }) {
  const [draft, setDraft] = useState({ title: "", kind: "note", text: "" });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [created, setCreated] = useState(null), lock = useRef(false);
  const titleInput = useRef(null);
  useEffect(() => { if (open) titleInput.current?.querySelector("input")?.focus(); }, [open]);
  if (!open) return null;
  async function create(event) {
    event.preventDefault(); if (lock.current || disabled) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const result = created || await knowledgeGraphRequest("/nodes", "POST", knowledgeNodeDraft(draft), false);
      setCreated(result);
      await onCreated(result.doc_id);
      setDraft({ title: "", kind: "note", text: "" }); setCreated(null); onClose();
    } catch (failure) { setError(failure.message); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="vault-node-composer" aria-label="Start Knowledge node" ref={titleInput}>
    <div className="vault-compose-title"><h2>Start a node</h2><button disabled={busy} aria-label="Close new node" onClick={onClose}>×</button></div>
    <KnowledgeNodeForm draft={draft} onChange={setDraft} disabled={busy || disabled || !!created} submitLabel={busy ? "Creating node…" : "Create node"} onSubmit={create} onCancel={onClose} />
    {created && !busy && <button onClick={create}>Open created node</button>}
    {busy && <p role="status">Saving and indexing your node…</p>}
    {error && <p role="alert">{created ? "The node was created, but could not be opened. " : ""}{error}</p>}
  </section>;
}

export function KnowledgeNodeContent({ node, active, onSaved, disabled }) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [message, setMessage] = useState(""), [retry, setRetry] = useState(0), lock = useRef(false);
  useEffect(() => {
    if (!open || !active || draft) return;
    let disposed = false; setError("");
    knowledgeGraphRequest(`/nodes/${encodeURIComponent(node.doc_id)}`, "GET", undefined, false)
      .then(result => { if (!disposed) setDraft({ title: result.title, kind: result.kind, text: result.text }); })
      .catch(failure => { if (!disposed) setError(failure.message); });
    return () => { disposed = true; };
  }, [open, active, node.doc_id, retry, draft]);
  async function save(event) {
    event.preventDefault(); if (lock.current || disabled) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      await knowledgeGraphRequest(`/nodes/${encodeURIComponent(node.doc_id)}`, "PUT", knowledgeNodeDraft(draft), false);
      await onSaved(node.doc_id); setMessage("Node content saved and indexed.");
    } catch (failure) { setError(failure.message); }
    finally { lock.current = false; setBusy(false); }
  }
  return <details className="vault-node-content" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Edit node content</summary>
    {open && (draft ? <KnowledgeNodeForm draft={draft} onChange={value => { setDraft(value); setMessage(""); }} disabled={busy || disabled} submitLabel={busy ? "Saving content…" : "Save content"} onSubmit={save} /> : !error && <p role="status">Loading node content…</p>)}
    {error && <p role="alert">{error}{!draft && <button onClick={() => setRetry(value => value + 1)}>Retry</button>}</p>}
    {message && <p role="status">{message}</p>}
  </details>;
}
