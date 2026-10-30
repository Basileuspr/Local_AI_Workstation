import { useEffect, useRef, useState } from 'react';
import { loadModels } from '../api';
import { confirmAction } from '../confirmAction';
import { activeCoordinatorRun, coordinatorRequest as request, harnessName, loadCoordinatorDraft, saveCoordinatorDraft, sourceUrl } from '../coordinator';

const defaults = { goal: '', model: 'gpt-oss:20b', urls: '', maxPages: 4, source: '', query: '', mediaIds: [], selected: '' };

export function ResearchResult({ run, busy, onSave }) {
  return <div className="coordinator-research-result">
    {run.result?.answer?.map((part, index) => <p key={index}>{part.text} <span className="coordinator-citations">{part.citations.map(id => <a key={id} href={`#coordinator-${run.id}-${id}`}>[{id}]</a>)}</span></p>)}
    <h3>Captured sources</h3>{run.result?.sources?.map(source => {
      const saved = run.receipts.some(receipt => receipt.action === 'knowledge' && receipt.source_ref === source.id);
      return <article className="coordinator-source" key={source.id} id={`coordinator-${run.id}-${source.id}`}><strong>{source.id} · {source.title}</strong><p><a href={sourceUrl(source.url)} target="_blank" rel="noreferrer">{source.url}</a></p>
        <small>Retrieved {new Date(source.retrieved_at * 1000).toLocaleString()}{source.published_at ? ` · Published ${source.published_at}` : ''}</small>
        <button disabled={busy || saved} onClick={() => onSave(source.id)}>{saved ? 'Saved to Knowledge' : `Save ${source.id} to Knowledge`}</button></article>;
    })}
    {!!run.result?.failures?.length && <p role="status">Partial coverage: {run.result.failures.map(item => item.reason).join(', ')}. Review source coverage before relying on this answer.</p>}
  </div>;
}

export function MediaResult({ run, busy, chosen, onChosen, onApply }) {
  const applied = new Set(run.receipts.filter(item => item.action === 'metadata').map(item => item.media_id));
  return <div className="coordinator-media-result"><p>{run.result?.summary}</p><p className="coding-hint">{run.result?.coverage}</p>
    {run.result?.proposals?.map(item => <label className="coordinator-proposal" key={item.media_id}><input type="checkbox" checked={chosen.includes(item.media_id)} disabled={busy || applied.has(item.media_id)} onChange={event => onChosen(event.target.checked ? [...chosen, item.media_id] : chosen.filter(id => id !== item.media_id))}/>
      <span><strong>{item.media_id}{applied.has(item.media_id) ? ' · Applied' : ''}</strong><span>Category: {item.category || '(empty)'} · Add tags: {item.tags.join(', ') || '(none)'}</span><span>{item.reason}</span></span></label>)}
    <button disabled={busy || !chosen.length} onClick={onApply}>Apply selected metadata</button>
    <h3>Duplicate candidates in this selection</h3>{run.result?.duplicate_groups?.length ? run.result.duplicate_groups.map((group, index) => <p key={index}>{group.join(' · ')}</p>) : <p>No matching recorded hashes in this selection. This is not a full-library duplicate scan.</p>}
  </div>;
}

export default function CoordinatorHarness({ harness, active, requestedRun, onNavigate }) {
  const [draft, setDraft] = useState(() => loadCoordinatorDraft(harness, defaults));
  const [storageError, setStorageError] = useState(''), [error, setError] = useState('');
  const [models, setModels] = useState([]), [runs, setRuns] = useState([]), [run, setRun] = useState(null);
  const [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0), lock = useRef(false);
  const [catalog, setCatalog] = useState({ items: [], total: 0 }), [offset, setOffset] = useState(0), [presets, setPresets] = useState([]);
  const [chosen, setChosen] = useState([]), [transferIds, setTransferIds] = useState([]), [mode, setMode] = useState('copy'), [preset, setPreset] = useState('');
  const [listError, setListError] = useState('');
  const update = patch => setDraft(value => ({ ...value, ...patch }));
  useEffect(() => { setStorageError(saveCoordinatorDraft(harness, draft) ? '' : 'Draft could not be saved in browser storage.'); }, [harness, draft]);
  useEffect(() => { if (requestedRun) update({ selected: requestedRun.id }); }, [requestedRun]);
  useEffect(() => { setChosen([]); setTransferIds([]); }, [run?.id]);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    loadModels().then(value => { if (alive) { setModels(value.models); if (value.error) setError(value.error); } });
    return () => { alive = false; };
  }, [active, refresh]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(); let timer;
    async function poll() {
      try {
        const value = await request('/coordinator/runs', undefined, controller.signal);
        if (controller.signal.aborted) return;
        const matching = value.runs.filter(item => item.harness_id === harness);
        setRuns(matching); setListError('');
        if (draft.selected) {
          const result = await request(`/coordinator/runs/${draft.selected}`, undefined, controller.signal);
          if (!controller.signal.aborted && result.harness_id === harness) setRun(result);
        } else setRun(null);
      } catch (failure) { if (!controller.signal.aborted) setListError(failure.message); }
      finally { if (!controller.signal.aborted) timer = setTimeout(poll, 1500); }
    }
    poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [active, harness, draft.selected, refresh]);
  async function act(operation) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await operation(); setRefresh(value => value + 1); }
    catch (failure) { setError(failure.message); }
    finally { lock.current = false; setBusy(false); }
  }
  async function browse(page = offset) {
    const params = new URLSearchParams({ source: draft.source, query: draft.query, offset: String(page), limit: '24' });
    const [listing, destinations] = await Promise.all([request(`/visual-review/workflow/list?${params}`), request('/visual-review/workflow/presets')]);
    setCatalog(listing); setPresets(destinations); setOffset(page);
  }
  const running = runs.some(activeCoordinatorRun), editable = !busy && !running;
  const call = async (suffix, body) => { const value = await request(`/coordinator/runs/${run.id}/${suffix}`, body); setRun(value); return value; };
  async function start() {
    const value = await request('/coordinator/runs', { harness_id: harness, goal: draft.goal, model: draft.model,
      ...(harness === 'research' ? { urls: draft.urls.split(/\r?\n/).map(line => line.trim()).filter(Boolean), max_pages: Number(draft.maxPages) } : { media_ids: draft.mediaIds }) });
    setRun(value); update({ selected: value.id });
  }
  return <section className="coordinator-harness" aria-label={`${harnessName(harness)} harness`}>
    <div className="coordinator-columns"><div className="coordinator-card"><h2>{harnessName(harness)}</h2>
      <label>Task<textarea aria-label={`${harnessName(harness)} task`} rows={4} maxLength={2000} value={draft.goal} disabled={!editable} onChange={event => update({ goal: event.target.value })} placeholder={harness === 'research' ? 'Compare evidence from public sources…' : 'Suggest useful categories and tags for these selected files…'}/></label>
      <label>Local model<select value={draft.model} disabled={!editable} onChange={event => update({ model: event.target.value })}>
        {!models.some(item => (typeof item === 'string' ? item : item.name) === draft.model) && <option value={draft.model}>{draft.model} · unavailable</option>}
        {models.map(item => { const name = typeof item === 'string' ? item : item.name; return <option key={name} value={name}>{name}</option>; })}</select></label>
      {harness === 'research' ? <><label>Public source URLs (optional, one per line)<textarea rows={3} value={draft.urls} disabled={!editable} onChange={event => update({ urls: event.target.value })}/></label><label>Maximum pages<select disabled={!editable} value={draft.maxPages} onChange={event => update({ maxPages: Number(event.target.value) })}>{[1, 2, 3, 4, 5, 6].map(count => <option key={count}>{count}</option>)}</select></label>
        <p className="coding-hint">Uses the search provider configured in Web. Captured evidence and the answer are saved locally with this task; Knowledge indexing is a separate action.</p><button onClick={() => onNavigate('web-system')}>Search provider settings</button></> : <>
        <label>Media source<select value={draft.source} onChange={event => { update({ source: event.target.value }); setOffset(0); }}><option value="">All registered media</option><option value="library">Image Library</option><option value="image-manager">Image Manager</option><option value="video-analyzer">Video Analyzer</option><option value="media-manager">Media Manager</option></select></label>
        <label>Filter metadata<input value={draft.query} maxLength={200} onChange={event => { update({ query: event.target.value }); setOffset(0); }}/></label>
        <button disabled={busy} onClick={() => act(() => browse(0))}>Browse registered media</button>
        <p>{draft.mediaIds.length}/24 selected · {catalog.total} matching</p><div className="coordinator-media-list">{catalog.items.map(item => <label key={item.media_id}><input type="checkbox" checked={draft.mediaIds.includes(item.media_id)} disabled={!editable || (!draft.mediaIds.includes(item.media_id) && draft.mediaIds.length >= 24)} onChange={event => update({ mediaIds: event.target.checked ? [...draft.mediaIds, item.media_id] : draft.mediaIds.filter(id => id !== item.media_id) })}/><span>{item.name || item.media_id}<small>{item.file_state} · {item.category || 'No category'}</small></span></label>)}</div>
        <div className="coordinator-actions"><button disabled={busy || offset === 0} onClick={() => act(() => browse(offset - 24))}>Previous</button><button disabled={busy || offset + 24 >= catalog.total} onClick={() => act(() => browse(offset + 24))}>Next</button><button disabled={!editable} onClick={() => update({ mediaIds: [] })}>Clear selection</button></div>
        <p className="coding-hint">Planning reads names, captions, tags and recorded hashes. It does not inspect pixels or delete files. Review each proposal before applying.</p></>}
      <button className="coordinator-primary" disabled={!editable || draft.goal.trim().length < 3 || !models.some(item => (typeof item === 'string' ? item : item.name) === draft.model) || (harness === 'media' && !draft.mediaIds.length)} onClick={() => act(start)}>{harness === 'research' ? 'Start research' : 'Plan media organization'}</button>
    </div><div className="coordinator-card coordinator-output"><label>Saved task<select value={draft.selected} onChange={event => { update({ selected: event.target.value }); setRun(null); }}><option value="">Choose a task</option>{runs.map(item => <option key={item.id} value={item.id}>{item.goal.slice(0, 70)} · {item.status.replaceAll('_', ' ')}</option>)}</select></label>
      {run ? <><div className="coding-status" role="status"><strong>{run.status.replaceAll('_', ' ')}</strong><span>{run.phase}</span></div><p className="coding-meta">{harnessName(run.harness_id)} v{run.harness_version} · {run.model}</p><h3>Task plan</h3><ol>{run.plan.map(step => <li key={step}>{step}</li>)}</ol>
        {activeCoordinatorRun(run) && <button disabled={busy} onClick={() => act(() => call('stop', {}))}>Stop task</button>}
        {run.error && <p role="alert">{run.error}</p>}
        {run.result && (harness === 'research' ? <ResearchResult run={run} busy={busy} onSave={source_ref => act(() => call('knowledge', { source_ref, confirmed: true }))}/> : <>
          <MediaResult run={run} busy={busy} chosen={chosen} onChosen={setChosen} onApply={() => act(async () => { await call('metadata', { media_ids: chosen, confirmed: true }); setChosen([]); })}/>
          <details><summary>Prepare a file organization plan</summary><p>Select files from this task. Configure destination folders in Review. Media Manager videos use their own transfer workspace.</p>
            {run.inputs.media_ids.filter(id => !id.startsWith('media-manager:')).map(id => <label className="coordinator-check" key={id}><input type="checkbox" checked={transferIds.includes(id)} onChange={event => setTransferIds(event.target.checked ? [...transferIds, id] : transferIds.filter(item => item !== id))}/>{id}</label>)}
            <label>File action<select value={mode} onChange={event => setMode(event.target.value)}><option value="copy">Copy</option><option value="move">Move</option></select></label>
            <button disabled={busy} onClick={() => act(async () => setPresets(await request('/visual-review/workflow/presets')))}>Refresh destination presets</button><label>Destination<select value={preset} onChange={event => setPreset(event.target.value)}><option value="">Choose a configured destination</option>{presets.filter(item => item.path).map(item => <option key={item.id} value={item.id}>{item.name} · {item.path}</option>)}</select></label>
            <button onClick={() => onNavigate('review')}>Configure destinations / transfer history</button><button disabled={busy || !preset || !transferIds.length} onClick={() => act(() => call('transfer-plan', { media_ids: transferIds, mode, destination_preset_id: preset, collision: 'rename' }))}>Prepare transfer plan</button>
            {run.transfer && <div className="coordinator-transfer"><h4>{run.transfer.mode} · {run.transfer.status}</h4>{run.transfer.entries.map(item => <p key={item.media_id}>{item.source || item.media_id} → {item.target || item.status}</p>)}<button disabled={busy || run.transfer.status !== 'ready'} onClick={() => act(async () => { if (await confirmAction(`Execute the displayed ${run.transfer.mode} plan for ${run.transfer.entries.length} selected files?`)) await call('transfer', { reviewed_plan_id: run.transfer.id, confirmed: true }); })}>Confirm displayed {run.transfer.mode} plan</button></div>}
          </details></>)}
        {!!run.receipts.length && <details><summary>Action receipts ({run.receipts.length})</summary><pre>{JSON.stringify(run.receipts, null, 2)}</pre></details>}
        <details><summary>Activity</summary><ul>{run.events.map((event, index) => <li key={index}>{event}</li>)}</ul></details>
        {!activeCoordinatorRun(run) && <button disabled={busy} onClick={() => act(async () => { if (await confirmAction('Remove this saved task and its captured evidence? Applied media changes and saved Knowledge remain.')) { await request(`/coordinator/runs/${run.id}/remove`, { confirmed: true }); update({ selected: '' }); setRun(null); } })}>Remove saved task</button>}
      </> : <p>Start a task or open saved history to inspect its plan and results.</p>}
    </div></div>{[error, listError, storageError].filter(Boolean).map((message, index) => <p role="alert" key={index}>{message}</p>)}
  </section>;
}
