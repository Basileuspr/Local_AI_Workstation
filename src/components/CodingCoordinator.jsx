import { useEffect, useRef, useState } from 'react';
import { codingChecks, codingControl, codingRequest, codingTerminal } from '../codingCoordinator';
import './CodingCoordinator.css';

export function CodingResult({ run }) {
  if (!run) return null;
  return <div className="coding-result">
    <div className="coding-status" role="status"><strong>{run.status.replaceAll('_', ' ')}</strong><span>{run.phase}</span></div>
    {run.error && <p role="alert">{run.error}</p>}
    <p className="coding-meta">{run.model} · {run.rounds} implementer rounds · {run.changes.length} changed files</p>
    <h3>Task plan</h3><ol>{run.plan.map((step, index) => <li key={index}>{step}</li>)}</ol>
    {run.summary && <p>{run.summary}</p>}
    {run.review && <div className="coding-review"><strong>Model review: {run.review.approved ? 'accepted' : 'needs attention'}</strong><p>{run.review.summary}</p></div>}
    <h3>Changes</h3>{run.changes.length ? run.changes.map(change => <details key={change.path} open={run.changes.length === 1}>
      <summary>{change.path}</summary><pre>{change.diff || 'No textual difference'}</pre></details>) : <p>No file edits recorded.</p>}
    <h3>Checks</h3>{run.check_results.length ? run.check_results.map((check, index) => <details key={index} open={check.running || !check.passed}>
      <summary>{check.name} · {check.running ? 'running' : check.cancelled ? 'cancelled' : check.timed_out ? 'timed out' : check.passed ? 'passed' : 'failed'} · revision {check.revision}</summary>
      <pre>{check.output || 'No output yet.'}</pre></details>) : <p>No checks completed yet.</p>}
    {run.protected_files.length > 0 && <details><summary>Preserved pre-existing changes ({run.protected_files.length})</summary><pre>{run.protected_files.join('\n')}</pre></details>}
    <details><summary>Activity</summary><ol>{run.events.map((event, index) => <li key={index}>{event.text}</li>)}</ol></details>
  </div>;
}

export default function CodingCoordinator({ active = true }) {
  const [project, setProject] = useState(null), [goal, setGoal] = useState('');
  const [model, setModel] = useState('gpt-oss:20b'), [models, setModels] = useState([]);
  const [commands, setCommands] = useState('python -m pytest -q'), [trusted, setTrusted] = useState(false);
  const [context, setContext] = useState(8192), [rounds, setRounds] = useState(24);
  const [listing, setListing] = useState({ runs: [], active: null }), [selected, setSelected] = useState(''), [run, setRun] = useState(null);
  const [error, setError] = useState(''), [connectionError, setConnectionError] = useState(''), [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0), actionLock = useRef(false);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    codingRequest('/models', controller.signal).then(value => setModels(value.models)).catch(failure => {
      if (!controller.signal.aborted) setError(failure.message);
    });
    return () => controller.abort();
  }, [active, refresh]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(); let timer;
    async function poll() {
      try {
        const value = await codingRequest('/runs', controller.signal);
        if (controller.signal.aborted) return;
        setListing(value); setConnectionError('');
        const id = selectedRef.current || value.active || value.runs[0]?.id;
        if (id) {
          if (!selectedRef.current) setSelected(id);
          const task = await codingRequest(`/runs/${id}`, controller.signal);
          if (!controller.signal.aborted && (!selectedRef.current || selectedRef.current === id)) setRun(task);
        }
      } catch (failure) { if (!controller.signal.aborted) setConnectionError(failure.message); }
      finally { if (!controller.signal.aborted) timer = setTimeout(poll, 1500); }
    }
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active, selected, refresh]);
  async function act(operation) {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError('');
    try { await operation(); setRefresh(value => value + 1); }
    catch (failure) { setError(failure.message); }
    finally { actionLock.current = false; setBusy(false); }
  }
  async function choose() {
    if (!window.workstationDesktop?.chooseCodingProject) throw Error('Project selection requires the updated desktop app.');
    const value = await window.workstationDesktop.chooseCodingProject();
    if (value.error) throw Error(value.error);
    if (!value.canceled) { setProject(value); setTrusted(false); }
  }
  async function start() {
    const task = await codingControl({ action: 'start', projectId: project.id, goal, model, checks: codingChecks(commands),
      trusted_checks: trusted, context_tokens: context, max_rounds: rounds });
    setSelected(task.id); setRun(task); setListing(value => ({ ...value, active: task.id }));
  }
  const activeRun = !!listing.active, runningSelection = run && !codingTerminal(run.status);
  return <section className="coding-workspace" aria-labelledby="coding-heading">
    <header><span className="coding-eyebrow">LOCAL MODELS · PROJECT TOOLS</span><h2 id="coding-heading">Coding Coordinator</h2>
      <p>Plan a change, edit your project, run checks, and inspect the result.</p></header>
    <div className="coding-grid"><div className="coding-setup">
      <label>Project folder<div className="coding-project"><output>{project?.root || 'Choose a Git repository'}</output><button disabled={busy || activeRun} onClick={() => act(choose)}>Choose project…</button></div></label>
      <label>Task<textarea value={goal} disabled={busy || activeRun} onChange={event => setGoal(event.target.value)} placeholder="Describe a focused change and how you will know it works." rows={5}/></label>
      <label>Local model<select value={model} disabled={busy || activeRun} onChange={event => setModel(event.target.value)}>
        {!models.some(item => item.name === model) && <option value={model}>{model} · unavailable</option>}
        {models.map(item => <option key={item.name} value={item.name} disabled={!item.tools}>{item.name}{item.tools ? ' · tool support reported' : ' · no native tools'}</option>)}
      </select></label>
      <label>Check commands<textarea value={commands} disabled={busy || activeRun} onChange={event => setCommands(event.target.value)} rows={3} spellCheck={false}/></label>
      <p className="coding-hint">One command per line. For this app’s frontend checks: <code>node node_modules/vitest/vitest.mjs run</code></p>
      <label className="coding-consent"><input type="checkbox" checked={trusted} disabled={busy || activeRun} onChange={event => setTrusted(event.target.checked)}/>I trust this project’s checks to execute code on this PC.</label>
      <details><summary>Run limits</summary><label>Context tokens<select value={context} onChange={event => setContext(Number(event.target.value))} disabled={busy || activeRun}>{[4096, 8192, 16384, 32768].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Maximum model rounds<input type="number" min={2} max={40} value={rounds} disabled={busy || activeRun} onChange={event => setRounds(Number(event.target.value))}/></label></details>
      <div className="coding-actions"><button className="coding-primary" disabled={busy || activeRun || !project || goal.trim().length < 3 || !trusted || !models.some(item => item.name === model && item.tools) || !!connectionError} onClick={() => act(start)}>Start coding task</button>
        <button disabled={busy} onClick={() => setRefresh(value => value + 1)}>Refresh</button></div>
      <p className="coding-hint">Starting authorizes edits and configured checks in the chosen project. Existing changes are protected. Review the diff before committing or publishing.</p>
    </div><div className="coding-output">
      <label>Saved task<select value={selected} onChange={event => { setSelected(event.target.value); setRun(null); }}>
        <option value="">Choose a task</option>{listing.runs.map(item => <option key={item.id} value={item.id}>{item.goal.slice(0, 70)} · {item.status.replaceAll('_', ' ')}</option>)}</select></label>
      {run && <div className="coding-actions">{runningSelection ? <><button disabled={busy} onClick={() => act(() => codingControl({ action: 'pause', id: run.id }))}>Pause task</button><button disabled={busy} onClick={() => act(() => codingControl({ action: 'cancel', id: run.id }))}>Stop task</button></> : ['paused', 'interrupted'].includes(run.status) && <button disabled={busy || activeRun} onClick={() => act(() => codingControl({ action: 'resume', id: run.id }))}>Resume task</button>}</div>}
      {(error || connectionError) && <p className="coding-error" role="alert">{error || connectionError}</p>}
      {listing.warnings?.map(warning => <p role="alert" key={warning}>{warning}</p>)}
      {run ? <CodingResult run={run}/> : <div className="coding-empty"><h3>A visible trail from request to result</h3><p>Your plan, changed files, checks, and model review appear here. Saved tasks remain available after restarting the app.</p></div>}
    </div></div>
  </section>;
}
