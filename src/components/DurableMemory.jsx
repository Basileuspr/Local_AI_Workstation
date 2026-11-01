import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { memoryCategories, memoryDate, memoryDraft, memoryRequest, filterMemories } from '../durableMemory';
import { confirmAction } from '../confirmAction';
import { downloadBlob } from '../downloadBlob';
import ScrollToolbar from './ScrollToolbar';
import './DurableMemory.css';

const pageSize = 30;
export default function DurableMemory({ active = true }) {
  const [data, setData] = useState({ memories: [], candidate_ids: [] });
  const [loaded, setLoaded] = useState(false), [loading, setLoading] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(''), [category, setCategory] = useState(''), [status, setStatus] = useState('all'), [sort, setSort] = useState('priority');
  const [page, setPage] = useState(0), [editor, setEditor] = useState(null), [draft, setDraft] = useState(memoryDraft());
  const sequence = useRef(0), actionLock = useRef(false), textField = useRef(null);
  const editorReturnFocus = useRef(null), addButton = useRef(null);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    try {
      const result = await memoryRequest();
      if (request === sequence.current) { setData(result); setLoaded(true); setError(''); }
    } catch (failure) { if (request === sequence.current) setError(failure.message); }
    finally { if (request === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => {
    if (!active) return;
    void load();
    const refresh = () => { if (!actionLock.current) void load(); };
    window.addEventListener('durable-memory-changed', refresh);
    return () => { ++sequence.current; window.removeEventListener('durable-memory-changed', refresh); };
  }, [active, load]);
  const visible = useMemo(() => filterMemories(data.memories, { query, category, status, sort }), [data.memories, query, category, status, sort]);
  const categories = [...new Set([...memoryCategories, ...data.memories.map(memory => memory.memory_type)])].sort();
  const activeCount = data.memories.filter(memory => memory.is_active).length;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(visible.length / pageSize) - 1));
  const rows = visible.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const dirty = editor && JSON.stringify(draft) !== JSON.stringify(memoryDraft(editor.id ? editor : null));
  async function openEditor(memory) {
    if (actionLock.current) return;
    if (dirty && !await confirmAction('Discard the unsaved changes to this memory?')) return;
    editorReturnFocus.current = document.activeElement;
    setEditor(memory || {}); setDraft(memoryDraft(memory)); setNotice('');
    requestAnimationFrame(() => textField.current?.focus());
  }
  async function closeEditor() {
    if (dirty && !await confirmAction('Discard the unsaved changes to this memory?')) return;
    setEditor(null);
    restoreFocus();
  }
  function restoreFocus() {
    requestAnimationFrame(() => {
      if (addButton.current?.closest('[hidden], [inert]')) return;
      const previous = editorReturnFocus.current;
      if (previous?.isConnected && previous.getClientRects().length && !previous.disabled) previous.focus();
      else addButton.current?.focus();
    });
  }
  async function perform(action, message) {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); setNotice(message); await load(); return true; }
    catch (failure) { setError(failure.message); return false; }
    finally { actionLock.current = false; setBusy(false); }
  }
  function save(event) {
    event.preventDefault();
    if (!draft.memory_text.trim() || !draft.memory_type.trim()) return;
    void perform(async () => {
      const result = await memoryRequest(editor.id ? `/${editor.id}` : '', {
        method: editor.id ? 'PATCH' : 'POST',
        body: { ...draft, ...(editor.id ? { version: editor.version } : { username: 'local-user' }) },
      });
      const saved = { ...editor, ...result.memory };
      setEditor(saved); setDraft(memoryDraft(saved));
    }, 'Memory saved. Changes apply to future requests.');
  }
  async function remove() {
    const reviewed = editor;
    if (!reviewed?.id || actionLock.current) return;
    if (!await confirmAction('Delete this saved memory permanently? Existing replies, chat history and backups keep their copies.')) return;
    const deleted = await perform(async () => {
      await memoryRequest(`/${reviewed.id}?version=${reviewed.version}`, { method: 'DELETE' });
      setEditor(null);
    }, 'Memory deleted from the library.');
    if (deleted) restoreFocus();
  }
  function toggle(memory) {
    void perform(async () => {
      const result = await memoryRequest(`/${memory.id}`, { method: 'PATCH', body: { version: memory.version, is_active: !memory.is_active } });
      // Preserve any unsaved editor text. Its old version will require a refresh before saving.
      if (editor?.id === memory.id && !dirty) {
        const saved = { ...editor, ...result.memory }; setEditor(saved); setDraft(memoryDraft(saved));
      }
    }, memory.is_active ? 'Memory paused. It will not be supplied to future requests.' : 'Memory resumed and eligible for future requests.');
  }
  async function exportVisible() {
    try {
      await downloadBlob(new Blob([JSON.stringify({ format: 'workstation-memories-v1', exported_at: new Date().toISOString(), memories: visible }, null, 2)], { type: 'application/json' }), 'saved-memories.json');
      setNotice('Export prepared for the filtered memories. This file contains their full text.');
    } catch (failure) { setError(failure.message || 'Could not export memories.'); }
  }
  function filter(setter, value) { setter(value); setPage(0); }
  return <section className="durable-memory" aria-labelledby="memory-heading">
    <header className="memory-header"><div><span className="memory-eyebrow">YOUR ASSISTANT’S REFERENCE</span><h1 id="memory-heading">Durable Memory</h1>
      <p>See what you’ve saved, keep it organized, and decide what can inform future replies.</p></div>
      <div className="memory-actions"><button type="button" disabled={busy || loading} onClick={load}>Refresh</button><button ref={addButton} className="memory-primary" type="button" disabled={busy || !loaded} onClick={() => openEditor(null)}>Add memory</button></div>
    </header>
    <div className="memory-stats" aria-label="Memory library summary">
      <span><strong>{loaded ? data.memories.length : '—'}</strong> saved</span><span><strong>{loaded ? activeCount : '—'}</strong> active</span>
      <span><strong>{loaded ? data.memories.length - activeCount : '—'}</strong> paused</span><span><strong>{loaded ? new Set(data.memories.map(memory => memory.memory_type)).size : '—'}</strong> categories</span>
    </div>
    <details className="memory-explanation"><summary>How saved memory affects replies</summary>
      <p>These are explicitly saved facts and preferences. Working memory is the rolling summary inside each chat; Knowledge holds documents and notes.</p>
      <p>When saved memory is enabled for a request, up to 10 active memories are considered, ordered by priority and most recent edit. “Next candidate” marks that current shortlist for ordinary chat; project requests can narrow it. The context budget may shorten or omit content. Categories organize entries but do not limit which chats can use them.</p>
      <p>Pause keeps an entry here and excludes it from future requests. Changes do not rewrite existing replies, rolling summaries or backups. Check a reply’s Response influences for what was supplied to that request.</p>
    </details>
    <ScrollToolbar as="div" label="Memory filters" className="memory-filters">
      <label className="memory-search">Search memories<input type="search" value={query} onChange={event => filter(setQuery, event.target.value)} placeholder="Find a preference, project or phrase…" /></label>
      <label>Category<select value={category} onChange={event => filter(setCategory, event.target.value)}><option value="">All categories</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Status<select value={status} onChange={event => filter(setStatus, event.target.value)}><option value="all">All memories</option><option value="active">Active</option><option value="paused">Paused</option></select></label>
      <label>Sort<select value={sort} onChange={event => filter(setSort, event.target.value)}><option value="priority">Priority first</option><option value="newest">Recently edited</option><option value="oldest">Oldest edited</option></select></label>
      <button type="button" disabled={!query && !category && status === 'all'} onClick={() => { setQuery(''); setCategory(''); setStatus('all'); setPage(0); }}>Clear filters</button>
    </ScrollToolbar>
    {error && <p className="memory-error" role="alert">{error} {loaded && 'The last loaded library remains below. Unsaved edits are retained.'}</p>}
    <p className="memory-notice" role="status" aria-live="polite">{loading ? 'Loading memories…' : notice || (loaded ? `${visible.length} of ${data.memories.length} memories shown` : 'Connect to the backend to load saved memories.')}</p>
    <div className="memory-layout">
      <div className="memory-library" role="region" aria-label="Saved memories" aria-busy={loading}>
        {!rows.length && loaded && <div className="memory-empty"><h2>{data.memories.length ? 'No matching memories' : 'A clear place for lasting context'}</h2><p>{data.memories.length ? 'Change the filters or clear your search.' : 'Add a preference, project fact or constraint you want the assistant to keep using.'}</p></div>}
        {rows.map(memory => <article key={memory.id} className={`memory-card${editor?.id === memory.id ? ' selected' : ''}${!memory.is_active ? ' paused' : ''}`}>
          <div className="memory-card-meta"><span>{memory.memory_type}</span><span>Priority {memory.importance}/5</span><span>{memory.is_active ? 'Active' : 'Paused'}</span>{data.candidate_ids?.includes(memory.id) && <span className="memory-candidate">Next candidate</span>}</div>
          <p className="memory-text" tabIndex={0}>{memory.memory_text}</p>
          {memory.project_name && <p className="memory-muted">Project: {memory.project_name}</p>}
          <div className="memory-card-footer"><small>Edited {memoryDate(memory.updated_at)}</small><div className="memory-actions">
            <button type="button" disabled={busy} aria-label={`Edit memory: ${memory.memory_text.slice(0, 60)}`} onClick={() => openEditor(memory)}>Edit</button>
            <button type="button" disabled={busy || (dirty && editor?.id === memory.id)} aria-label={`${memory.is_active ? 'Pause' : 'Resume'} memory: ${memory.memory_text.slice(0, 60)}`} onClick={() => toggle(memory)}>{memory.is_active ? 'Pause' : 'Resume'}</button>
          </div></div>
        </article>)}
        {visible.length > pageSize && <nav className="memory-pagination" aria-label="Memory pages"><button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {Math.ceil(visible.length / pageSize)}</span><button disabled={(currentPage + 1) * pageSize >= visible.length} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}
        <button type="button" disabled={!visible.length || busy || loading} onClick={exportVisible}>Export filtered memories · JSON</button>
      </div>
      <aside className="memory-editor" aria-label="Memory editor">
        {editor ? <form onSubmit={save}><div className="memory-editor-heading"><h2>{editor.id ? 'Edit memory' : 'New memory'}</h2><span>{dirty ? 'Unsaved changes' : editor.id ? 'Saved' : 'Draft'}</span></div>
          <fieldset disabled={busy}><label>Memory text<textarea ref={textField} value={draft.memory_text} maxLength={8000} required rows={8} onChange={event => setDraft(current => ({ ...current, memory_text: event.target.value }))} placeholder="For example: Use metric units in recipes." /></label>
            <label>Category<input list="memory-category-choices" value={draft.memory_type} maxLength={100} required onChange={event => setDraft(current => ({ ...current, memory_type: event.target.value }))} /><datalist id="memory-category-choices">{categories.map(value => <option key={value} value={value} />)}</datalist></label>
            <small>Choose an existing category or type your own.</small>
            <label>Priority<select value={draft.importance} onChange={event => setDraft(current => ({ ...current, importance: Number(event.target.value) }))}>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}{value === 1 ? ' · Low' : value === 3 ? ' · Normal' : value === 5 ? ' · High' : ''}</option>)}</select></label>
            <label className="memory-check"><input type="checkbox" checked={draft.is_active} onChange={event => setDraft(current => ({ ...current, is_active: event.target.checked }))} />Active · eligible for future replies</label>
            {editor.id && <dl className="memory-details"><dt>Created</dt><dd>{memoryDate(editor.created_at)}</dd><dt>Last edited</dt><dd>{memoryDate(editor.updated_at)}</dd><dt>Association</dt><dd>{editor.project_name || (editor.project_id ? `Project ${editor.project_id}` : 'User memory')}{editor.session_id ? ' · linked to a chat' : ''}</dd></dl>}
            <div className="memory-actions"><button className="memory-primary" type="submit" disabled={!draft.memory_text.trim() || !draft.memory_type.trim() || (editor.id && !dirty)}>{busy ? 'Saving…' : 'Save memory'}</button><button type="button" onClick={closeEditor}>Close</button>{editor.id && <button className="memory-delete" type="button" onClick={remove}>Delete memory</button>}</div>
          </fieldset></form> : <div className="memory-empty"><h2>Make memory useful</h2><p>Select Edit on a saved memory to correct its text, choose a category, adjust its priority or pause it.</p><p>Short, specific entries are easier to review and fit more reliably into the model’s context.</p></div>}
      </aside>
    </div>
  </section>;
}
