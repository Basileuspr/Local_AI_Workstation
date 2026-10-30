import { useEffect, useRef, useState } from 'react';
import { codingChecks, codingControl, codingRequest, codingTerminal, displayCommand } from '../codingCoordinator';
import CodingVerification, { VerificationApproval, VerificationHistory } from './CodingVerification';
import './CodingCoordinator.css';
import { loadCoordinatorDraft, saveCoordinatorDraft } from '../coordinator';

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
    <VerificationHistory checks={run.check_results}/>
    {run.protected_files.length > 0 && <details><summary>Preserved pre-existing changes ({run.protected_files.length})</summary><pre>{run.protected_files.join('\n')}</pre></details>}
    <details><summary>Activity</summary><ol>{run.events.map((event, index) => <li key={index}>{event.text}</li>)}</ol></details>
  </div>;
}

export default function CodingCoordinator({ active = true, requestedRun }) {
  const [draft] = useState(() => loadCoordinatorDraft('coding', { goal: '', model: 'gpt-oss:20b', context: 8192, rounds: 24 }));
  const [project, setProject] = useState(null), [goal, setGoal] = useState(draft.goal);
  const [model, setModel] = useState(draft.model), [models, setModels] = useState([]);
  const [commands, setCommands] = useState(''), [trusted, setTrusted] = useState(false);
  const [catalog, setCatalog] = useState(null), [selectedChecks, setSelectedChecks] = useState([]);
  const [mode, setMode] = useState('ask'), [profileName, setProfileName] = useState('');
  const [context, setContext] = useState(draft.context), [rounds, setRounds] = useState(draft.rounds);
  const [listing, setListing] = useState({ runs: [], active: null }), [selected, setSelected] = useState(''), [run, setRun] = useState(null);
  const [error, setError] = useState(''), [connectionError, setConnectionError] = useState(''), [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0), actionLock = useRef(false);
  const outputRef = useRef(null);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  useEffect(() => { if (requestedRun) { setSelected(requestedRun.id); setRun(null); } }, [requestedRun]);
  useEffect(() => { saveCoordinatorDraft('coding', { goal, model, context, rounds }); }, [goal, model, context, rounds]);
  useEffect(() => { if (active && run?.pending_approval) outputRef.current?.scrollIntoView({ block: 'start' }); }, [active, run?.pending_approval?.id]);
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
    if (!value.canceled) {
      setProject(value); setTrusted(false); setCatalog(null); setSelectedChecks([]); setCommands(''); setProfileName(''); setMode('ask');
      const inspected = await codingControl({ action: 'inspect', projectId: value.id });
      setCatalog(inspected);
      const defaults = inspected.checks.filter(check => check.recommended && !check.unavailable);
      const rootChecks = defaults.filter(check => check.cwd === '.');
      setSelectedChecks((rootChecks.length ? rootChecks : defaults).slice(0, 6).map(check => check.id));
    }
  }
  const selection = () => ({ projectId: project.id, selected_checks: selectedChecks, checks: codingChecks(commands, true), verification_mode: mode });
  async function inspect() {
    const inspected = await codingControl({ action: 'inspect', projectId: project.id });
    setCatalog(inspected); setSelectedChecks(value => value.filter(id => inspected.checks.some(check => check.id === id && !check.unavailable)));
  }
  function loadProfile(profile) {
    if (profile.selected_checks.some(id => !catalog.checks.some(check => check.id === id && !check.unavailable))) throw Error('This profile references missing or unavailable checks. Inspect the project and update the profile.');
    setSelectedChecks(profile.selected_checks); setCommands(profile.checks.map(check => displayCommand(check.argv)).join('\n'));
    setMode(profile.verification_mode); setProfileName(profile.name);
  }
  async function saveProfile() { setCatalog(await codingControl({ action: 'save-profile', ...selection(), name: profileName.trim() })); }
  async function approveChecks() {
    setCatalog(await codingControl({ action: 'approve-checks', projectId: project.id, selected_checks: selectedChecks, checks: [],
      expected_fingerprints: Object.fromEntries(catalog.checks.filter(check => selectedChecks.includes(check.id)).map(check => [check.id, check.fingerprint])) }));
  }
  async function start() {
    const task = await codingControl({ action: 'start', ...selection(), goal, model,
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
      <details><summary>Run limits</summary><label>Context tokens<select value={context} onChange={event => setContext(Number(event.target.value))} disabled={busy || activeRun}>{[4096, 8192, 16384, 32768].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Maximum model rounds<input type="number" min={2} max={40} value={rounds} disabled={busy || activeRun} onChange={event => setRounds(Number(event.target.value))}/></label></details>
      <div className="coding-actions"><button className="coding-primary" disabled={busy || activeRun || !catalog || (!selectedChecks.length && !commands.trim()) || goal.trim().length < 3 || !trusted || !models.some(item => item.name === model && item.tools) || !!connectionError} onClick={() => act(start)}>Start coding task</button>
        <button disabled={busy} onClick={() => setRefresh(value => value + 1)}>Refresh</button></div>
      <p className="coding-hint">Starting authorizes source edits in the selected project. Verification follows the permission policy. Existing changes are protected; publication remains a separate step.</p>
    </div><CodingVerification catalog={catalog} selected={selectedChecks} onSelected={setSelectedChecks} mode={mode} onMode={setMode} commands={commands} onCommands={setCommands}
      profileName={profileName} onProfileName={setProfileName} onProfile={profile => act(() => loadProfile(profile))} onSave={() => act(saveProfile)} onInspect={() => act(inspect)}
      onApprove={() => act(approveChecks)} onRevoke={() => act(async () => setCatalog(await codingControl({ action: 'revoke-checks', projectId: project.id })))}
      busy={busy || activeRun} trusted={trusted} onTrusted={setTrusted}/><div className="coding-output" ref={outputRef}>
      <label>Saved task<select value={selected} onChange={event => { setSelected(event.target.value); setRun(null); }}>
        <option value="">Choose a task</option>{listing.runs.map(item => <option key={item.id} value={item.id}>{item.goal.slice(0, 70)} · {item.status.replaceAll('_', ' ')}</option>)}</select></label>
      {run && <div className="coding-actions">{runningSelection ? <><button disabled={busy} onClick={() => act(() => codingControl({ action: 'pause', id: run.id }))}>Pause task</button><button disabled={busy} onClick={() => act(() => codingControl({ action: 'cancel', id: run.id }))}>Stop task</button></> : ['paused', 'interrupted'].includes(run.status) && <button disabled={busy || activeRun} onClick={() => act(() => codingControl({ action: 'resume', id: run.id }))}>Resume task</button>}</div>}
      {(error || connectionError) && <p className="coding-error" role="alert">{error || connectionError}</p>}
      {listing.warnings?.map(warning => <p role="alert" key={warning}>{warning}</p>)}
      {run?.pending_approval && <VerificationApproval key={run.pending_approval.id} pending={run.pending_approval} busy={busy} onDecision={(approved, remember) => act(() => codingControl({ action: 'verification-approval', id: run.id, request_id: run.pending_approval.id, approved, remember }))}/>}
      {run ? <CodingResult run={run}/> : <div className="coding-empty"><h3>A visible trail from request to result</h3><p>Your plan, changed files, checks, and model review appear here. Saved tasks remain available after restarting the app.</p></div>}
    </div></div>
  </section>;
}
