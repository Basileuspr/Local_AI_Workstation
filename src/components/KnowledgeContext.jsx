import { useState } from "react";
import { useStore, useDispatch } from "../useStore";
import { listKnowledgeBase } from "../api";

export default function KnowledgeContext() {
  const state = useStore(), dispatch = useDispatch();
  const [open, setOpen] = useState(false), [error, setError] = useState("");
  const mode = state.useKnowledgeBase ? (state.knowledgeDocIds === null ? "all" : "selected") : "off";
  const ids = state.knowledgeScopes?.[state.currentSessionId || "draft"]?.ids || state.knowledgeDocIds || [];
  function change(nextMode, nextIds = ids) { dispatch({ type: "SET_KNOWLEDGE_SCOPE", payload: { mode: nextMode, ids: nextIds } }); }
  async function toggle() {
    setOpen(!open);
    if (!open) try { dispatch({ type: "SET_KB_DOCUMENTS", payload: await listKnowledgeBase() }); setError(""); } catch (failure) { setError(failure.message); }
  }
  return <span className="model-order-control">
    <button type="button" onClick={toggle} aria-expanded={open}>Knowledge: {mode === "off" ? "Off" : mode === "all" ? "All" : `${ids.length} selected`}</button>
    {open && <div className="model-order-panel" role="dialog" aria-label="Knowledge context">
      <strong>Knowledge for this chat</strong>
      <select aria-label="Knowledge scope" value={mode} onChange={event => change(event.target.value)}>
        <option value="off">Off</option><option value="all">Search all documents</option><option value="selected">Search selected documents</option>
      </select>
      <p>Supplies up to five relevant excerpts within the context limit.</p>
      {error && <p role="alert">{error}</p>}
      {mode === "selected" && <div className="knowledge-context-files">{state.kbDocuments.map(doc => <label key={doc.doc_id}>
        <input type="checkbox" checked={ids.includes(doc.doc_id)} onChange={event => change("selected", event.target.checked ? [...ids, doc.doc_id] : ids.filter(id => id !== doc.doc_id))} />{doc.filename}
      </label>)}{!ids.length && <p>No documents selected. No Knowledge will be supplied.</p>}</div>}
      <button type="button" onClick={() => setOpen(false)}>Done</button>
    </div>}
  </span>;
}
