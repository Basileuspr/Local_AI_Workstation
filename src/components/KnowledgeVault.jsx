import { useEffect, useRef, useState } from "react";
import * as api from "../api";
import { useStore, useDispatch } from "../useStore";
import KnowledgeGraph from "./KnowledgeGraph";
import BulkActions, { SelectionCheckbox } from "./BulkActions";
import { useSelection, useBatchAction } from "../useSelection";
import "./KnowledgeVault.css";

export default function KnowledgeVault({ active }) {
  const state = useStore(), dispatch = useDispatch();
  const [graph, setGraph] = useState({ nodes: [], edges: [] });
  const [selectedId, setSelectedId] = useState(() => {
    try { return localStorage.getItem("knowledge-vault-selected-v1") || ""; } catch { return ""; }
  });
  const [query, setQuery] = useState(""), [target, setTarget] = useState("");
  const [detail, setDetail] = useState(null), [page, setPage] = useState(0);
  const [error, setError] = useState(""), [detailError, setDetailError] = useState("");
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const upload = useRef(null), request = useRef(0);
  const selection = useSelection(graph.nodes, node => node.doc_id), batch = useBatchAction();
  useEffect(() => {
    try { localStorage.setItem("knowledge-vault-selected-v1", selectedId); } catch { /* Storage can be unavailable. */ }
  }, [selectedId]);
  async function refresh() {
    const version = ++request.current; setLoading(true); setError("");
    try {
      const data = await api.knowledgeGraphRequest();
      if (version === request.current) { setGraph(data); setSelectedId(current => data.nodes.some(node => node.doc_id === current) ? current : ""); }
    } catch (failure) { if (version === request.current) setError(failure.message); }
    finally { if (version === request.current) setLoading(false); }
  }
  useEffect(() => { if (active) refresh(); return () => { request.current++; }; }, [active, state.kbDocuments]);
  useEffect(() => { setPage(0); setTarget(""); }, [selectedId]);
  useEffect(() => {
    let cancelled = false; setDetail(null); setDetailError("");
    if (active && selectedId) api.knowledgeGraphRequest(`/documents/${encodeURIComponent(selectedId)}?offset=${page * 30}`, undefined, undefined, false)
      .then(data => { if (!cancelled) setDetail(data); }).catch(failure => { if (!cancelled) setDetailError(failure.message); });
    return () => { cancelled = true; };
  }, [active, selectedId, page, graph]);
  async function mutate(action) {
    setBusy(true); setError("");
    try { await action(); await refresh(); } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function addFile(event) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    await mutate(async () => {
      const result = await api.addToKnowledgeBase(file);
      if (result.error) throw new Error(result.error);
      dispatch({ type: "SET_KB_DOCUMENTS", payload: await api.listKnowledgeBase() });
      if (result.doc_id) setSelectedId(result.doc_id);
    });
  }
  const selected = graph.nodes.find(node => node.doc_id === selectedId);
  const connections = graph.edges.filter(edge => edge.source === selectedId || edge.target === selectedId);
  const visibleNodes = graph.nodes.filter(node => node.filename.toLowerCase().includes(query.toLowerCase()));
  function removeDocuments(items) {
    return batch.run({ items, key: node => node.doc_id, selection,
      confirm: `Remove ${items.length} document(s) from Knowledge? Their indexed chunks and vault links will be removed; original files are unchanged.`,
      action: node => api.removeFromKnowledgeBase(node.doc_id), after: async () => {
        dispatch({ type: "SET_KB_DOCUMENTS", payload: await api.listKnowledgeBase() });
        await refresh();
      }, verb: "Removed" });
  }
  return <section className="knowledge-vault" aria-label="Knowledge vault">
    <header className="vault-header"><div><h1>Knowledge vault</h1><p>{graph.nodes.length} documents · {graph.edges.length} connections · Available to RAG</p></div>
      <label className="vault-rag"><input type="checkbox" checked={state.useKnowledgeBase} onChange={event => dispatch({ type: "SET_PARAM", key: "useKnowledgeBase", value: event.target.checked })} />Use Knowledge in chats</label>
      <button disabled={busy} onClick={() => upload.current?.click()}>{busy ? "Working…" : "+ Add document"}</button>
      <input ref={upload} type="file" accept=".txt,.md,.pdf,.docx" hidden onChange={addFile} />
    </header>
    {error && <div className="vault-error" role="alert">{error} <button onClick={refresh}>Retry</button></div>}
    <div className="vault-workspace">
      <aside className="vault-files" aria-label="Vault documents"><label>Find a document<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search filenames…" /></label>
        {loading && <p role="status">Loading vault…</p>}
        <BulkActions selection={selection} items={visibleNodes} label="documents" batch={batch} disabled={busy}
          actions={[{ label: "Remove selected", danger: true, onClick: removeDocuments }]} />
        {visibleNodes.map(node => <div className="vault-file" key={node.doc_id}><SelectionCheckbox selection={selection} item={node} label={node.filename} disabled={batch.busy} /><button aria-pressed={selectedId === node.doc_id} onClick={() => setSelectedId(node.doc_id)}><span>{node.filename}</span><small>{node.chunks} chunks</small></button></div>)}
        {!loading && query && !graph.nodes.some(node => node.filename.toLowerCase().includes(query.toLowerCase())) && <p>No matching documents.</p>}
      </aside>
      <KnowledgeGraph {...graph} selectedId={selectedId} query={query} onSelect={setSelectedId} onPosition={async (id, position) => {
        try { await api.knowledgeGraphRequest(`/positions/${encodeURIComponent(id)}`, "PUT", position); }
        catch (failure) { setError(`Position not saved: ${failure.message}`); }
      }} />
      <aside className="vault-inspector" aria-label="Document details">
        {!selected ? <div className="vault-inspector-empty"><h2>Select a document</h2><p>Explore its indexed text and connected documents.</p><p>Connect documents here, or import text containing <code>[[another document]]</code>.</p><p>Lines show explicit links, not inferred similarity. Disconnected documents still participate in RAG.</p></div> : <>
          <div className="vault-inspector-heading"><h2>{selected.filename}</h2><button onClick={() => setSelectedId("")} aria-label="Close document">×</button></div>
          <p>{selected.chunks} indexed chunks</p><button className="vault-remove" disabled={batch.busy || busy} onClick={() => removeDocuments([selected])}>Remove from Knowledge</button><h3>Connections</h3>
          {!connections.length && <p>No connections yet.</p>}
          {connections.map(edge => {
            const otherId = edge.source === selectedId ? edge.target : edge.source;
            const other = graph.nodes.find(node => node.doc_id === otherId);
            return <div className="vault-connection" key={otherId}><button onClick={() => setSelectedId(otherId)}>{other?.filename}</button><small>{edge.kinds.join(" + ")}</small>
              {edge.kinds.includes("manual") && <button disabled={busy} aria-label={`Unlink ${other?.filename}`} onClick={() => mutate(() => api.knowledgeGraphRequest("/links", "DELETE", { source: selectedId, target: otherId }))}>Unlink</button>}
            </div>;
          })}
          <form className="vault-link-form" onSubmit={event => { event.preventDefault(); if (target) mutate(() => api.knowledgeGraphRequest("/links", "POST", { source: selectedId, target })); }}>
            <select aria-label="Document to connect" value={target} onChange={event => setTarget(event.target.value)}><option value="">Connect to a document…</option>{graph.nodes.filter(node => node.doc_id !== selectedId).map(node => <option key={node.doc_id} value={node.doc_id}>{node.filename}</option>)}</select>
            <button disabled={busy || !target}>Connect</button>
          </form>
          {!!selected.unresolved_links?.length && <p className="vault-unresolved">Unresolved or ambiguous links: {selected.unresolved_links.join(", ")}</p>}
          <h3>Indexed text</h3><p className="vault-hint">Chunks may overlap. This is the text available to retrieval.</p>
          {detailError ? <p role="alert">{detailError}</p> : !detail ? <p role="status">Loading document…</p> : <>
            {detail.chunks.map(chunk => <article className="vault-chunk" key={chunk.index}><small>Chunk {chunk.index + 1}</small><p>{chunk.text}</p></article>)}
            <div className="vault-pages"><button disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous</button><span>{page + 1} / {Math.max(1, Math.ceil(detail.total / 30))}</span><button disabled={(page + 1) * 30 >= detail.total} onClick={() => setPage(value => value + 1)}>Next</button></div>
          </>}
        </>}
      </aside>
    </div>
  </section>;
}
