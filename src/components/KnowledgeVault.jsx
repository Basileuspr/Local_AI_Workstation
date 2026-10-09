import {preventSelectionText} from '../fileSelection';
import { useEffect, useRef, useState } from "react";
import * as api from "../api";
import { useStore, useDispatch } from "../useStore";
import KnowledgeGraph from "./KnowledgeGraph";
import KnowledgeContext from "./KnowledgeContext";
import KnowledgeNodeEditor from "./KnowledgeNodeEditor";
import KnowledgeNodeSymbol from "./KnowledgeNodeSymbol";
import { KnowledgeNodeContent } from "./KnowledgeNodeComposer";
import { newKnowledgeNodeDraft } from '../knowledgeNodes';
import { nodeLabel, nodeMatches } from "../knowledgeNodeOptions";
import { layoutKnowledgeGraph3D } from "../knowledgeGraph3D";
import BulkActions, { SelectionCheckbox } from "./BulkActions";
import { useSelection, useBatchAction } from "../useSelection";
import "./KnowledgeVault.css";
import {KnowledgeCharacterStart,CharacterNodePointer} from './KnowledgeCharacters';
import {useCharacterWorkspace} from '../CharacterWorkspace';
import { KnowledgeIndexLinks } from "./IndexKnowledgeLinks";

export default function KnowledgeVault({ active }) {
  const state = useStore(), dispatch = useDispatch();
  const characters=useCharacterWorkspace();
  const [graph, setGraph] = useState({ nodes: [], edges: [] });
  const [nodePreview, setNodePreview] = useState(null);
  const [startingNode, setStartingNode] = useState(false), [editingNodeId, setEditingNodeId] = useState('');
  const [nodeContentPreview, setNodeContentPreview] = useState(null);
  const newNodeLock = useRef(false), pendingNode = useRef(null);
  const [selectedId, setSelectedId] = useState(() => {
    try { return localStorage.getItem("knowledge-vault-selected-v1") || ""; } catch { return ""; }
  });
  const [query, setQuery] = useState(""), [target, setTarget] = useState("");
  const [detail, setDetail] = useState(null), [page, setPage] = useState(0);
  const [error, setError] = useState(""), [detailError, setDetailError] = useState("");
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [nodeSaving, setNodeSaving] = useState(false), nodeSaveLock = useRef(false);
  const upload = useRef(null), request = useRef(0);
  const batch = useBatchAction();
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
  useEffect(() => {
    if(characters?.documentTarget){setQuery('');setSelectedId(characters.documentTarget.id);setPage(0);}
  },[characters?.documentTarget]);
  useEffect(() => {
    if (active && state.knowledgeNodeTarget) {
      setQuery(""); setSelectedId(state.knowledgeNodeTarget.id); setPage(0);
      dispatch({ type: "CLEAR_KNOWLEDGE_NODE_TARGET" });
    }
  }, [active, state.knowledgeNodeTarget, dispatch]);
  useEffect(() => { setPage(0); setTarget(""); setNodePreview(null); setNodeContentPreview(null); }, [selectedId]);
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
  const previewNodes = graph.nodes.map(node => {
    if (nodeContentPreview?.id !== node.doc_id) return node;
    const draft = nodeContentPreview.draft;
    return { ...node, node_kind: draft.kind, character_id: draft.kind === 'character' ? draft.character_id || '' : '',
      options: { ...node.options, label: !node.options?.label || node.options.label === node.node_title ? draft.title : node.options.label } };
  });
  const selected = previewNodes.find(node => node.doc_id === selectedId);
  const savedSelected = graph.nodes.find(node => node.doc_id === selectedId);
  async function selectIndexedDocument(docId, select = true) {
    const documents = await api.listKnowledgeBase();
    const data = await api.knowledgeGraphRequest();
    request.current++; setLoading(false); setGraph(data);
    dispatch({type:'SET_KB_DOCUMENTS',payload:documents});
    if (select) { setQuery('');setSelectedId(docId);setPage(0); }
  }
  async function startNode() {
    if (newNodeLock.current || busy || batch.busy) return;
    newNodeLock.current = true; setStartingNode(true); setError('');
    try {
      // Retain a successful POST through a failed refresh so retry cannot create a duplicate.
      pendingNode.current ||= await api.knowledgeGraphRequest('/nodes', 'POST', newKnowledgeNodeDraft(graph.nodes), false);
      const id = pendingNode.current.doc_id;
      await selectIndexedDocument(id); setEditingNodeId(id); pendingNode.current = null;
    } catch (failure) { setError(`${pendingNode.current ? 'The node was created. Click Open created node to finish opening it. ' : ''}${failure.message}`); }
    finally { newNodeLock.current = false; setStartingNode(false); }
  }
  const connections = graph.edges.filter(edge => edge.source === selectedId || edge.target === selectedId);
  const visibleNodes = previewNodes.filter(node => nodeMatches(node, query));
  const selection = useSelection(graph.nodes, node => node.doc_id, "", visibleNodes);
  const previewGraph = { ...graph, nodes: previewNodes.map(node => nodePreview?.id === node.doc_id ? { ...node, options: nodePreview.options } : node) };
  async function saveNodePresentation(action) {
    if (nodeSaveLock.current) throw new Error("Wait for the current node save to finish.");
    nodeSaveLock.current = true; setNodeSaving(true);
    try { return await action(); }
    finally { nodeSaveLock.current = false; setNodeSaving(false); }
  }
  async function saveNodeOptions(id, options) {
    return saveNodePresentation(async () => {
    // Lock the current layout even when this node has never been dragged.
    const node = graph.nodes.find(item => item.doc_id === id);
    const needsPosition = options.locked && (!node.position || (!Number.isFinite(node.position.z) && !node.options?.locked));
    const position = needsPosition ? layoutKnowledgeGraph3D(graph.nodes, graph.edges)[id] : node.position;
    if (needsPosition) await api.knowledgeGraphRequest(`/positions/${encodeURIComponent(id)}`, "PUT", position);
    const result = await api.knowledgeGraphRequest(`/options/${encodeURIComponent(id)}`, "PUT", options);
    setGraph(current => ({ ...current, nodes: current.nodes.map(node => node.doc_id === id ? { ...node, position, options: result.options } : node) }));
    setNodePreview(current => current?.id === id ? null : current);
    return result.options;
    });
  }
  async function saveNodeSymbol(id, icon) {
    return saveNodePresentation(async () => {
    const result = await api.knowledgeGraphRequest(`/symbols/${encodeURIComponent(id)}`, "PUT", { icon });
    setGraph(current => ({ ...current, nodes: current.nodes.map(node => node.doc_id === id ? { ...node, options: result.options } : node) }));
    setNodePreview(current => current?.id === id ? { ...current, options: { ...current.options, icon } } : current);
    });
  }
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
      <KnowledgeContext />
      <button disabled={busy || batch.busy || startingNode || nodeSaving} onClick={startNode}>{startingNode ? 'Creating node…' : pendingNode.current ? 'Open created node' : '+ New node'}</button>
      <button disabled={busy} onClick={() => upload.current?.click()}>{busy ? "Working…" : "+ Add document"}</button>
      <input ref={upload} type="file" accept=".txt,.md,.pdf,.docx" hidden onChange={addFile} />
    </header>
    <KnowledgeCharacterStart active={active} nodes={graph.nodes} onSelect={id => {setQuery('');setSelectedId(id);}} onIndexed={selectIndexedDocument}/>
    {error && <div className="vault-error" role="alert">{error} <button onClick={refresh}>Retry</button></div>}
    <div className="vault-workspace">
      <aside className="vault-files" aria-label="Vault documents"><label>Find a document<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Names, tags, notes…" /></label>
        {loading && <p role="status">Loading vault…</p>}
        <BulkActions selection={selection} items={visibleNodes} label="documents" batch={batch} disabled={busy}
          actions={[{ label: "Remove selected", danger: true, onClick: removeDocuments }]} />
        {visibleNodes.map(node => <div className="vault-file" key={node.doc_id}><SelectionCheckbox selection={selection} item={node} label={nodeLabel(node)} disabled={batch.busy} /><button aria-pressed={selectedId === node.doc_id} onMouseDown={preventSelectionText} onClick={event => selection.activate(node,event,()=>setSelectedId(node.doc_id))}><span>{nodeLabel(node)}</span><small>{node.authored ? `${node.node_kind} · ` : node.options?.label && `${node.filename} · `}{node.chunks} chunks{node.options?.locked ? " · Locked" : ""}</small>{!!node.options?.tags?.length && <small>{node.options.tags.join(" · ")}</small>}</button></div>)}
        {!loading && query && !visibleNodes.length && <p>No matching documents.</p>}
      </aside>
      <KnowledgeGraph {...previewGraph} selectedId={selectedId} query={query} onSelect={setSelectedId} onPosition={async (id, position) => {
        try { await api.knowledgeGraphRequest(`/positions/${encodeURIComponent(id)}`, "PUT", position); setGraph(current => ({ ...current, nodes: current.nodes.map(node => node.doc_id === id ? { ...node, position } : node) })); }
        catch (failure) { setError(`Position not saved: ${failure.message}`); }
      }} />
      <aside className="vault-inspector" aria-label="Document details">
        {!selected ? <div className="vault-inspector-empty"><h2>Select a document</h2></div> : <>
          <div className="vault-inspector-heading"><h2>{selected.authored ? nodeLabel(selected) : selected.filename}</h2><button onClick={() => setSelectedId("")} aria-label="Close document">×</button></div>
          <KnowledgeNodeSymbol key={`node-symbol:${selectedId}`} node={savedSelected} disabled={busy || batch.busy || nodeSaving} onSave={icon => saveNodeSymbol(selectedId, icon)} />
          {selected.authored && <KnowledgeNodeContent key={`node-content:${selectedId}`} node={savedSelected} active={active} initiallyOpen={editingNodeId === selectedId} disabled={busy || batch.busy || nodeSaving} onSaved={id => selectIndexedDocument(id, false)} onPreview={draft => setNodeContentPreview(current => draft ? { id: selectedId, draft } : current?.id === selectedId ? null : current)} />}
          <KnowledgeNodeEditor key={`node-options:${selectedId}`} node={savedSelected} disabled={busy || batch.busy || nodeSaving} onPreview={options => setNodePreview(options ? { id: selectedId, options } : null)} onSave={options => saveNodeOptions(selectedId, options)} />
          <CharacterNodePointer key={selectedId} filename={selected.filename} onIndexed={selectIndexedDocument}/>
          <KnowledgeIndexLinks key={`index-links:${selectedId}`} docId={selectedId} active={active} disabled={busy || batch.busy} />
          <p>{selected.chunks} indexed chunks</p><button className="vault-remove" disabled={batch.busy || busy} onClick={() => removeDocuments([selected])}>Remove from Knowledge</button><h3>Connections</h3>
          {!connections.length && <p>No connections yet.</p>}
          {connections.map(edge => {
            const otherId = edge.source === selectedId ? edge.target : edge.source;
            const other = graph.nodes.find(node => node.doc_id === otherId);
            return <div className="vault-connection" key={otherId}><button onClick={() => setSelectedId(otherId)}>{other ? nodeLabel(other) : "Unavailable node"}</button><small>{edge.kinds.join(" + ")}</small>
              {edge.kinds.includes("manual") && <button disabled={busy} aria-label={`Unlink ${other?.filename}`} onClick={() => mutate(() => api.knowledgeGraphRequest("/links", "DELETE", { source: selectedId, target: otherId }))}>Unlink</button>}
            </div>;
          })}
          <form className="vault-link-form" onSubmit={event => { event.preventDefault(); if (target) mutate(() => api.knowledgeGraphRequest("/links", "POST", { source: selectedId, target })); }}>
            <select aria-label="Document to connect" value={target} onChange={event => setTarget(event.target.value)}><option value="">Connect to a document…</option>{graph.nodes.filter(node => node.doc_id !== selectedId).map(node => <option key={node.doc_id} value={node.doc_id}>{nodeLabel(node)}</option>)}</select>
            <button disabled={busy || !target}>Connect</button>
          </form>
          {!!selected.unresolved_links?.length && <p className="vault-unresolved">Unresolved or ambiguous links: {selected.unresolved_links.join(", ")}</p>}
          <h3>Indexed text</h3>
          {detailError ? <p role="alert">{detailError}</p> : !detail ? <p role="status">Loading document…</p> : <>
            {detail.chunks.map(chunk => <article className="vault-chunk" key={chunk.index}><small>Chunk {chunk.index + 1}</small><p>{chunk.text}</p></article>)}
            <div className="vault-pages"><button disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous</button><span>{page + 1} / {Math.max(1, Math.ceil(detail.total / 30))}</span><button disabled={(page + 1) * 30 >= detail.total} onClick={() => setPage(value => value + 1)}>Next</button></div>
          </>}
        </>}
      </aside>
    </div>
  </section>;
}
