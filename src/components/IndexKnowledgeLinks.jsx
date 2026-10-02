import { useState } from "react";
import { useDispatch } from "../useStore";
import { useIndexKnowledgeLinks } from "../indexKnowledgeLinks";
import "./IndexKnowledgeLinks.css";

export function IndexEntryKnowledgeLinks({ entry, catalog, disabled }) {
  const dispatch = useDispatch();
  const [choice, setChoice] = useState("");
  const links = catalog.links.filter(link => link.entry_id === entry.id);
  const available = catalog.nodes.filter(node => !links.some(link => link.doc_id === node.doc_id));
  const selected = available.some(node => node.doc_id === choice) ? choice : "";
  const locked = disabled || catalog.busy || catalog.loading;
  return <details className="index-knowledge-links" aria-label={`Knowledge connections for ${entry.title}`}>
    <summary>{links.length ? `Knowledge connections · ${links.length}` : "Connect to Knowledge"}</summary>
    <p>Connect this entry to existing Knowledge nodes. Its content stays in Index.</p>
    {links.map(link => <div className="index-knowledge-link" key={link.doc_id}>
      <button type="button" onClick={() => dispatch({ type: "OPEN_KNOWLEDGE_NODE", payload: link.doc_id })}>{link.node_label}</button>
      <button type="button" disabled={locked} aria-label={`Unlink ${link.node_label} from ${entry.title}`} onClick={() => catalog.change(entry.id, link.doc_id, true)}>Unlink</button>
    </div>)}
    {!!available.length && <form onSubmit={event => { event.preventDefault(); if (selected && !locked) void catalog.change(entry.id, selected); }}>
      <label>Knowledge node<select aria-label={`Knowledge node for ${entry.title}`} value={selected} disabled={locked} onChange={event => setChoice(event.target.value)}>
        <option value="">Choose a node…</option>{available.map(node => <option key={node.doc_id} value={node.doc_id}>{node.label}</option>)}
      </select></label>
      <button type="submit" disabled={locked || !selected}>Connect</button>
    </form>}
    {catalog.loaded && !catalog.loading && !catalog.nodes.length && <p>Create a node or add a document in Knowledge first. <button type="button" onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", payload: "knowledge" })}>Open Knowledge</button></p>}
    {catalog.loaded && !!catalog.nodes.length && !available.length && <p>Connected to every available node.</p>}
  </details>;
}

export function KnowledgeIndexLinks({ docId, active, disabled }) {
  const dispatch = useDispatch();
  const catalog = useIndexKnowledgeLinks(active, docId);
  return <section className="index-knowledge-links" aria-label="Connected Index entries">
    <h3>Index entries</h3>
    {catalog.loading && !catalog.loaded && <p role="status">Loading Index connections…</p>}
    {catalog.links.map(link => <div className="index-knowledge-link" key={link.entry_id}>
      <button type="button" aria-label={`Open ${link.entry_title} in Index`} onClick={() => dispatch({ type: "OPEN_INDEX_ENTRY", payload: link.entry_id })}>{link.entry_title}</button>
      <button type="button" disabled={disabled || catalog.busy} aria-label={`Unlink Index entry ${link.entry_title}`} onClick={() => catalog.change(link.entry_id, docId, true)}>Unlink</button>
    </div>)}
    {catalog.loaded && !catalog.links.length && <p>No Index entries connected. Use <strong>Connect to Knowledge</strong> on a saved Index entry.</p>}
    <button type="button" onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", payload: "library" })}>Open Index</button>
    {catalog.error && <p role="alert">{catalog.error} <button type="button" onClick={catalog.refresh}>Retry connections</button></p>}
    {catalog.notice && <p role="status">{catalog.notice}</p>}
  </section>;
}
