import {useRangeSelection} from '../useRangeSelection';
import { useEffect, useRef, useState } from 'react';
import './GitHubPublisher.css';

export function githubPublicationSteps(job, paths) {
  const validated = !!job.validation && JSON.stringify([...paths].sort()) === JSON.stringify([...job.validation.paths].sort());
  return { validated, committed: !!job.commit, published: !!job.result };
}

export default function GitHubPublisher({ initialJob = { status: 'idle' } }) {
  const [job, setJob] = useState(initialJob), [selected, setSelected] = useState(initialJob.selectedPaths || []);
  const [message, setMessage] = useState('Update Local AI Workstation'), [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [expanded, setExpanded] = useState(() => {
    try { return globalThis.window?.localStorage?.getItem('law.github-publication.expanded') === 'true'; }
    catch { return false; }
  });
  const seen = useRef(null), locked = useRef(false);
  const busy = starting || job.busy || ['preparing', 'validating', 'committing', 'pushing'].includes(job.status);
  const desktop = globalThis.window?.workstationDesktop;
  function acceptState(state) {
    setJob(state);
    if (state.preview && state.preview.id !== seen.current) {
      seen.current = state.preview.id; setSelected(state.selectedPaths || []);
    }
  }
  useEffect(() => {
    if (!desktop?.githubPublicationState) return;
    let ended = false, timer;
    async function poll() {
      try {
        const state = await desktop.githubPublicationState();
        if (!ended) acceptState(state);
      } catch { if (!ended) setError('Could not read GitHub publication progress.'); }
      if (!ended) timer = setTimeout(poll, 1000);
    }
    void poll();
    return () => { ended = true; clearTimeout(timer); };
  }, [desktop]);
  async function act(method, request) {
    if (locked.current) return;
    locked.current = true; setStarting(true); setError('');
    try {
      const result = await desktop[method](request);
      if (result?.error) throw Error(result.error);
      acceptState(await desktop.githubPublicationState());
    } catch (failure) { setError(failure.message); }
    finally { locked.current = false; setStarting(false); }
  }
  const review = job.preview, steps = githubPublicationSteps(job, selected), selectionLocked = busy || steps.committed || steps.published;
  const fileRange = useRangeSelection((review?.changes || []).map(item => item.path),selected,setSelected,{array:true,scope:review?.id});
  function toggleDetails() {
    const next = !expanded;
    setExpanded(next);
    try { globalThis.window?.localStorage?.setItem('law.github-publication.expanded', String(next)); }
    catch { /* The disclosure still works when browser storage is unavailable. */ }
  }
  const summary = busy ? (job.phase || 'Working') + '…'
    : steps.published ? 'Pushed and verified on GitHub'
    : steps.committed ? 'Committed locally · ready to push'
    : review ? `${selected.length} of ${review.changes.length} changes selected · ${steps.validated ? 'Validated' : 'Validation pending'}`
    : 'Review, validate, commit locally and push when ready.';
  return <section className="dashboard-card github-publisher" aria-labelledby="github-publication-heading">
    <div className="github-publisher-header">
      <h2 id="github-publication-heading">GitHub update</h2>
      <button type="button" aria-expanded={expanded} aria-controls="github-publication-details" onClick={toggleDetails}>
        {expanded ? 'Hide GitHub details' : 'Show GitHub details'}
      </button>
    </div>
    <p className="github-publication-summary" role="status" aria-live="polite">{summary}</p>
    {(error || job.error) && <p role="alert">{error || job.error}</p>}
    <div id="github-publication-details" className="github-publication-details" hidden={!expanded}>

    <button type="button" disabled={busy || !desktop?.prepareGitHubPublication} onClick={() => act('prepareGitHubPublication')}>Review source changes</button>
    {!desktop?.prepareGitHubPublication && <p className="dashboard-note">Fully quit and restart the desktop app after rebuilding to use this button.</p>}
    {review && <div>
      <p><a href={review.repository} target="_blank" rel="noreferrer">{review.repository.replace('https://github.com/', '')}</a> · {review.branch}</p>
      <p className="dashboard-note">Snapshot captured {new Date(review.captured_at).toLocaleString()}. Later edits are left for a new review. Uncheck unfinished changes.</p>
      <div className="github-selection-controls">
        <button type="button" disabled={selectionLocked} onClick={() => setSelected(review.changes.map(item => item.path))}>Select all</button>
        <button type="button" disabled={selectionLocked} onClick={() => setSelected([])}>Clear selection</button>
        <span>{selected.length} of {review.changes.length} changes selected</span>
      </div>
      <div className="github-source-list" aria-label="Source changes">{review.changes.map(item => <label key={item.path}>
        <input type="checkbox" disabled={selectionLocked} checked={selected.includes(item.path)} onClick={event => fileRange.toggle(item.path,event)} onChange={() => {}}/>
        <span>{item.path}</span><small>{item.status}</small>
      </label>)}</div>
      {!!review.blocked.length && <details><summary>{review.blocked.length} files excluded by the source/privacy checks</summary>{review.blocked.map(item => <p key={item.path}>{item.path}: {item.reason}</p>)}</details>}
      <ol className="github-publication-steps" aria-label="GitHub update steps">
        <li><strong>{steps.validated ? 'Validated' : job.validation ? 'Selection changed — validate again' : 'Validation pending'}</strong>

          <button type="button" disabled={selectionLocked || !selected.length || !desktop?.validateGitHubSelection} onClick={() => act('validateGitHubSelection', { id: review.id, paths: selected })}>Validate selected changes</button></li>
        <li><strong>{steps.committed ? 'Committed locally' : 'Local commit pending'}</strong>
          <label className="github-commit-message">Commit message<input maxLength={500} value={job.commit?.message || message} disabled={selectionLocked} onChange={event => setMessage(event.target.value)}/></label>

          <button type="button" disabled={busy || !steps.validated || steps.committed || !message.trim() || !desktop?.commitGitHubSelection} onClick={() => act('commitGitHubSelection', { id: review.id, paths: selected, message })}>Commit locally</button>
          {job.commit && <p>Commit <code>{job.commit.commit.slice(0, 7)}</code> retained on <code>{job.commit.branch}</code>.</p>}</li>
        <li><strong>{steps.published ? 'Pushed and verified on GitHub' : 'GitHub push pending'}</strong>

          <button type="button" disabled={busy || !steps.committed || steps.published || !desktop?.pushGitHubCommit} onClick={() => act('pushGitHubCommit', { id: review.id })}>Push to GitHub</button></li>
      </ol>
    </div>}
    {job.status !== 'idle' && <button type="button" disabled={starting} onClick={() => act('openGitHubPublicationLog')}>Open publication log</button>}
    </div>
    {job.result && <p role="status">Published {job.result.files} files: <a href={job.result.url} target="_blank" rel="noreferrer">{job.result.commit.slice(0, 7)}</a>. GitHub commit verified.</p>}
  </section>;
}
