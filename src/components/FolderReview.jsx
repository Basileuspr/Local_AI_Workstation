import { useEffect, useRef, useState } from 'react';
import { sharedPollingObserver } from '../polling';
import { folderReviewDefaults, folderReviewExport, folderReviewModels, folderReviewRequest, readFolderReviewStatus, folderReviewRunning } from '../folderReview';
import './FolderReview.css';

export function FolderReviewFiles({ items = [] }) {
  return <div className="folder-review-files">{items.map(item => <details key={item.ordinal}>
    <summary><strong>{item.path}</strong><span>{item.kind} · {item.status.replaceAll('_', ' ')}</span></summary>
    {item.analysis && <pre>{item.analysis}</pre>}
    {item.error && <p className="folder-review-warning">{item.error}</p>}
    {item.coverage?.reason && <p className="folder-review-warning">{item.coverage.reason}</p>}
    {item.data_warnings?.map((warning, index) => <p className="folder-review-warning" key={index}>{warning}</p>)}
    {item.coverage?.batches_total > 0 && <p>{item.coverage.batches_completed} of {item.coverage.batches_total} text batches analyzed by the model.</p>}
    <h3>Metadata</h3><pre>{JSON.stringify(item.metadata, null, 2)}</pre>
  </details>)}</div>;
}

export function FolderReviewProcessing({ processing }) {
  if (!processing?.context_limit) return null;
  return <div className="folder-review-processing">
    <span>Model context: {processing.context_limit.toLocaleString()} tokens · Text batches: {processing.text_batches_completed || 0}/{processing.text_batches_total || 0} · Compactions: {processing.compactions || 0}</span>
    <span>Memory preparation checks: {processing.offload_preparations || 0}{processing.model_released && ' · Review model released'}{processing.model_release_deferred && ' · Model release deferred while other work owns the queue'}</span>
    {processing.provider_retries > 0 && <span>Provider retries: {processing.provider_retries}</span>}
    {processing.model_release_error && <p className="folder-review-warning">Model release could not be confirmed: {processing.model_release_error}</p>}
  </div>;
}

export default function FolderReview({ active = true, models = [], defaultModel = '' }) {
  const [root, setRoot] = useState(''), [model, setModel] = useState(''), [options, setOptions] = useState(folderReviewDefaults);
  const [status, setStatus] = useState(null), [reviewId, setReviewId] = useState(''), [offset, setOffset] = useState(0);
  const [files, setFiles] = useState(null), [report, setReport] = useState(''), [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState(''), [working, setWorking] = useState(false);
  const observer = useRef(null), submitted = useRef(false), modelTouched = useRef(false), actionLock = useRef(false);
  const names = folderReviewModels(models);
  const reviews = status?.reviews || [], review = reviews.find(item => item.id === reviewId);
  const busy = Boolean(status?.active) || working;
  useEffect(() => { if (!modelTouched.current && defaultModel) setModel(defaultModel); }, [defaultModel]);
  useEffect(() => {
    if (!active) return;
    const poll = sharedPollingObserver('folder-review-status', {
      read: readFolderReviewStatus, active: value => Boolean(value?.active),
      interval: (value, context) => context.hidden ? null : context.failures ? 5000 : value?.active ? 1000 : 10000,
    });
    observer.current = poll;
    return poll.subscribe({ data: value => {
      setStatus(value); setConnectionError('');
      setReviewId(current => current || value.active || value.reviews[0]?.id || '');
      if (!submitted.current && value.reviews[0]) {
        submitted.current = true; setRoot(current => current || value.reviews[0].root);
      }
    }, recovered: () => setConnectionError(''),
    error: failure => setConnectionError(failure?.message || 'Could not reach Folder Review. Reconnect to check a running review before starting another.') });
  }, [active]);
  useEffect(() => {
    if (!active || !reviewId) return;
    const controller = new AbortController();
    folderReviewRequest(`/reviews/${reviewId}/files?offset=${offset}&limit=50`, { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setFiles(value);
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [active, reviewId, offset, review?.processed, review?.total, review?.status]);
  async function act(operation) {
    if (actionLock.current) return;
    actionLock.current = true; setWorking(true); setError('');
    try { await operation(); }
    catch (failure) { setError(failure.message); }
    finally { actionLock.current = false; setWorking(false); }
  }
  async function chooseFolder() {
    if (!window.workstationDesktop?.chooseFolderReviewFolder) throw Error('Paste a local folder path, or restart the desktop app to use Browse.');
    const result = await window.workstationDesktop.chooseFolderReviewFolder();
    if (result?.error) throw Error(result.error);
    if (result?.path) setRoot(result.path);
  }
  async function start() {
    const result = await folderReviewRequest('/reviews', { body: { root: root.trim(), model: model === '__inventory__' ? '' : model, ...options } });
    setReviewId(result.id); setOffset(0); setFiles(null); setReport(''); submitted.current = true;
    setStatus(current => ({ active: result.id, reviews: [result, ...(current?.reviews || [])] }));
    observer.current?.invalidate();
  }
  function selectReview(id) { setReviewId(id); setOffset(0); setFiles(null); setReport(''); }
  return <section className="folder-review-workspace" aria-labelledby="folder-review-heading">
    <header><h1 id="folder-review-heading">Folder Review</h1>
      </header>
    <div className="folder-review-settings">
      <label>Folder<div className="folder-review-actions"><input value={root} onChange={event => setRoot(event.target.value)} placeholder="Paste a local folder path" disabled={busy}/>
        <button type="button" disabled={busy} onClick={() => act(chooseFolder)}>Browse…</button></div></label>
      <label>Review model<select value={model} disabled={busy} onChange={event => { modelTouched.current = true; setModel(event.target.value); }}>
        <option value="">Choose a local model</option><option value="__inventory__">Inventory and text extraction only</option>
        {model && model !== '__inventory__' && !names.includes(model) && <option value={model}>{model}</option>}
        {names.map(name => <option key={name} value={name}>{name}</option>)}
      </select></label>
      <label className="folder-review-check"><input type="checkbox" checked={options.recursive} disabled={busy} onChange={event => setOptions({ ...options, recursive: event.target.checked })}/>Include subfolders</label>
      <details><summary>Batch size and coverage limits</summary><div className="folder-review-limits">
        {[['max_entries', 'Maximum discovered entries', 1, 10000], ['max_chars', 'Readable characters per file', 1000, 1000000], ['batch_chars', 'Characters per text batch', 500, 6000]].map(([key, label, min, max]) => <label key={key}>{label}<input type="number" min={min} max={max} value={options[key]} disabled={busy} onChange={event => setOptions({ ...options, [key]: Number(event.target.value) })}/></label>)}
        <label>Maximum file size (MiB)<input type="number" min={1} max={32} value={options.max_bytes / 1048576} disabled={busy} onChange={event => setOptions({ ...options, max_bytes: Number(event.target.value) * 1048576 })}/></label>
      </div></details>
      <div className="folder-review-actions"><button type="button" disabled={busy || !root.trim() || !model || !!connectionError} onClick={() => act(start)}>Start Folder Review</button>
        {status?.active && <button type="button" disabled={working || reviews.find(item => item.id === status.active)?.status === 'cancelling'} onClick={() => act(async () => { await folderReviewRequest(`/reviews/${status.active}/cancel`, { body: {} }); observer.current?.invalidate(); })}>Stop review</button>}
        <button type="button" disabled={working} onClick={() => act(() => observer.current?.invalidate())}>Refresh results</button></div>
    </div>
    {(error || connectionError || review?.error) && <p role="alert">{error || connectionError || review.error}</p>}
    {reviews.length > 0 && <label>Saved review<select value={reviewId} onChange={event => selectReview(event.target.value)}>{reviews.map(item => <option key={item.id} value={item.id}>{new Date(item.started_at).toLocaleString()} · {item.root} · {item.status.replaceAll('_', ' ')}</option>)}</select></label>}
    {review && <div className="folder-review-progress" role="status"><strong>{review.status.replaceAll('_', ' ')} · {review.processed} of {review.total} recorded entries processed</strong>
      <span>{review.phase}{review.current_path && ` · ${review.current_path}`}{review.batches > 0 && ` · ${review.processing?.operation === 'compacting' ? 'Compaction' : 'Text'} batch ${review.batch}/${review.batches}`}</span>
      <span>{Object.entries(review.types || {}).map(([kind, count]) => `${count} ${kind}`).join(' · ')}</span>
      <span>{Object.entries(review.extensions || {}).map(([extension, count]) => `${extension}: ${count}`).join(' · ')}</span>
      <FolderReviewProcessing processing={review.processing}/>
      {review.data_warnings?.map((warning, index) => <p className="folder-review-warning" key={index}>{warning}</p>)}
      {!folderReviewRunning(review.status) && !review.inventory_complete && <p className="folder-review-warning">Folder inventory is incomplete. See the configured entry limit and recorded errors.</p>}
      {review.status === 'interrupted' && <p>App stopped before completion. Start a new review to read the remaining files.</p>}
    </div>}
    {review && !folderReviewRunning(review.status) && <div className="folder-review-actions">
      <button type="button" disabled={working} onClick={() => act(async () => setReport((await folderReviewRequest(`/reviews/${reviewId}`)).report))}>Show full report</button>
      <a href={folderReviewExport(reviewId)} download>Download Markdown report</a>
    </div>}
    {report && <details open className="folder-review-report"><summary>Full report</summary><button type="button" onClick={() => act(() => navigator.clipboard.writeText(report))}>Copy report</button><pre>{report}</pre></details>}
    {files && <><h2>Per-file findings</h2><FolderReviewFiles items={files.items}/>
      {files.total > 50 && <div className="folder-review-actions"><button type="button" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button><span>{offset + 1}–{Math.min(offset + 50, files.total)} of {files.total} entries</span><button type="button" disabled={offset + 50 >= files.total} onClick={() => setOffset(offset + 50)}>Next</button></div>}
    </>}

  </section>;
}
