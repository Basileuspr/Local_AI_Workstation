import { useRef, useState } from 'react';
import { readEnvironment, checkAppUpdates, checkDependencies, dependencyAction } from '../applicationAwareness';
import './ApplicationMaintenance.css';

export default function ApplicationMaintenance() {
  const [environment, setEnvironment] = useState(null), [updates, setUpdates] = useState(null), [dependencies, setDependencies] = useState(null);
  const [profile, setProfile] = useState('requirements.txt'), [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState(null);
  const lock = useRef(false);
  async function act(operation) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await operation(); } catch (failure) { setError(failure.message); }
    finally { lock.current = false; setBusy(false); }
  }
  const rows = dependencies?.dependencies.filter(row => row.ecosystem === 'javascript' || row.profile === profile) || [];
  return <section className="dashboard-card software-specs application-maintenance" aria-label="Application maintenance">
    <h2>Application awareness and maintenance</h2>

    <div className="software-spec-actions">
      <button disabled={busy} onClick={() => act(async () => setEnvironment(await readEnvironment()))}>Inspect Environment</button>
      <button disabled={busy} onClick={() => act(async () => setUpdates(await checkAppUpdates()))}>Check for Updates</button>
      <button disabled={busy} onClick={() => act(async () => setDependencies(await checkDependencies(profile)))}>Check Dependency Compatibility</button>
    </div>
    {busy && <p role="status">Checking or preparing maintenance… Package downloads may take a few minutes.</p>}
    {error && <p role="alert">{error}</p>}
    {updates && <p role="status">Current version: {updates.current_version || 'unknown'} · Latest known: {updates.latest_version || 'unknown'} · {{up_to_date:'Up to date', update_available:'Update available', unable_to_check:'Unable to check'}[updates.status]}. {updates.detail}</p>}
    {environment && <details open><summary>Environment snapshot · {new Date(environment.static.sampled_at).toLocaleString()}</summary><pre className="software-spec-preview">{JSON.stringify(environment, null, 2)}</pre></details>}
    {dependencies && <>
      <label>Dependency profile <select aria-label="Dependency profile" disabled={busy || Boolean(plan)} value={profile} onChange={event => { const next = event.target.value; setProfile(next); act(async () => setDependencies(await checkDependencies(next))); }}>
        {dependencies.profiles.map(name => <option key={name}>{name}</option>)}
      </select></label>
      <p className="dashboard-note">{dependencies.limitations}</p>
      <p>Python {dependencies.python.installed} · recorded baseline {dependencies.python.recorded_baseline}; Node recorded baseline {dependencies.node.recorded_baseline}. No declared interpreter range: compatibility unknown.</p>
      <div className="maintenance-dependencies"><table><thead><tr><th>Dependency</th><th>Installed</th><th>Declared</th><th>Compatibility</th><th>Recorded target / action</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={`${row.ecosystem}-${row.name}-${index}`}>
          <td>{row.name}</td><td>{row.installed || 'Missing'}</td><td>{row.declared}{row.node_engine && <small> · Node {row.node_engine}: {row.node_engine_status}</small>}</td><td>{row.status}</td>
          <td>{row.recorded_target || 'No recorded target'} · {row.upgrade_risk === 'manual_review' ? 'Manual review required for upgrades' : row.updatable ? <button disabled={busy || Boolean(plan)} onClick={() => act(async () => {
            const value = await dependencyAction('prepare', row.name, profile);
            if (value.status === 'approval_required') setPlan(value); else setResult(value);
          })}>Update Dependency: {row.name}</button> : 'At recorded target'}</td>
        </tr>)}</tbody></table></div>
      {dependencies.installed_metadata_conflicts.length > 0 && <details open><summary>Installed package conflicts</summary><pre className="software-spec-preview">{dependencies.installed_metadata_conflicts.join('\n')}</pre></details>}
      {dependencies.voice_runtimes?.length > 0 && <details><summary>Separate voice runtimes</summary><pre className="software-spec-preview">{JSON.stringify(dependencies.voice_runtimes,null,2)}</pre></details>}
    </>}
    {plan && <div className="dependency-proposal" role="group" aria-label="Approve dependency proposal">
      <h3>Proposed change: {plan.name}</h3><p>{plan.current || 'Missing'} → {plan.target}</p><p>{plan.scope} {plan.risk} Proposal expires in ten minutes.</p>
      <button disabled={busy} onClick={() => act(async () => {
        try { const value = await dependencyAction('approve', plan.ticket); setResult(value); setDependencies(await checkDependencies(profile)); }
        finally { setPlan(null); }
      })}>Approve and install {plan.name}</button>
      <button disabled={busy} onClick={() => act(async () => { try { await dependencyAction('cancel', plan.ticket); } finally { setPlan(null); } })}>Cancel proposal</button>
    </div>}
    {result && <p role={result.status === 'failed' ? 'alert' : 'status'}>{result.name}: {result.status}. {result.detail} {result.recovery}</p>}
  </section>;
}
