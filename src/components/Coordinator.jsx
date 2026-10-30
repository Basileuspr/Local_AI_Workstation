import { useEffect, useState } from 'react';
import CodingCoordinator from './CodingCoordinator';
import CoordinatorHarness from './CoordinatorHarness';
import { coordinatorRequest, harnesses, harnessName, loadCoordinatorDraft, saveCoordinatorDraft } from '../coordinator';
import './Coordinator.css';

export default function Coordinator({ active = true, legacyCoding = false, onNavigate = () => {} }) {
  const [selected, setSelected] = useState(() => loadCoordinatorDraft('selection', { harness: 'coding' }).harness);
  const harness = harnesses.some(item => item.id === selected) ? selected : 'coding';
  const [history, setHistory] = useState([]), [error, setError] = useState(''), [warnings, setWarnings] = useState([]);
  const [requests, setRequests] = useState({});
  useEffect(() => { if (active && legacyCoding) setSelected('coding'); }, [active, legacyCoding]);
  useEffect(() => { saveCoordinatorDraft('selection', { harness }); }, [harness]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(); let timer;
    async function poll() {
      try { const value = await coordinatorRequest('/coordinator/runs', undefined, controller.signal); if (!controller.signal.aborted) { setHistory(value.runs); setWarnings(value.warnings || []); setError(''); } }
      catch (failure) { if (!controller.signal.aborted) setError(failure.message); }
      finally { if (!controller.signal.aborted) timer = setTimeout(poll, 2000); }
    }
    poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [active]);
  function openRun(key) {
    const run = history.find(item => `${item.harness_id}:${item.id}` === key);
    if (run) { setSelected(run.harness_id); setRequests(value => ({ ...value, [run.harness_id]: { id: run.id, nonce: Date.now() } })); }
  }
  return <section className="coordinator-workspace" aria-labelledby="coordinator-heading">
    <header className="coordinator-header"><div><span className="coding-eyebrow">LOCAL AI WORKSTATION</span><h1 id="coordinator-heading">Coordinator</h1><p>Choose a harness. Follow the plan, inspect the evidence, and review the result.</p></div>
      <div className="coordinator-links"><button onClick={() => onNavigate('dashboard')}>Dashboard</button><button onClick={() => onNavigate('tools')}>Functions</button><button onClick={() => onNavigate('info-center')}>Info Center</button><button onClick={() => onNavigate('queue')}>Prompt Queue</button></div></header>
    <div className="coordinator-toolbar"><label>Harness<select aria-label="Coordinator harness" value={harness} onChange={event => setSelected(event.target.value)}>{harnesses.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>All saved tasks<select aria-label="Coordinator task history" value="" onChange={event => openRun(event.target.value)}><option value="">Open a saved task…</option>{history.map(run => <option key={`${run.harness_id}:${run.id}`} value={`${run.harness_id}:${run.id}`}>{harnessName(run.harness_id)} · {run.goal.slice(0, 65)} · {run.status.replaceAll('_', ' ')}</option>)}</select></label></div>
    <p className="coordinator-description">{harnesses.find(item => item.id === harness).description} Switching harnesses keeps submitted tasks and drafts.</p>
    {error && <p role="alert">{error}</p>}{warnings.map((warning, index) => <p key={index} role="alert">{warning}</p>)}
    <div hidden={harness !== 'coding'}><CodingCoordinator active={active && harness === 'coding'} requestedRun={requests.coding}/></div>
    {['research', 'media'].map(id => <div key={id} hidden={harness !== id}><CoordinatorHarness harness={id} active={active && harness === id} requestedRun={requests[id]} onNavigate={onNavigate}/></div>)}
  </section>;
}
