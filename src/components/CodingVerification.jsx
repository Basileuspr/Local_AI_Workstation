import { useState } from 'react';
import { checkStatus, displayCommand } from '../codingCoordinator';

export function CheckEvidence({ check }) {
  return <dl className="verification-evidence">
    <dt>Command</dt><dd><code>{displayCommand(check.argv)}</code></dd>
    <dt>Working directory</dt><dd>{check.cwd || '.'}</dd>
    {check.source && <><dt>Detected from</dt><dd>{check.source}</dd></>}
    {check.definition && <><dt>Script definition</dt><dd><code>{check.definition}</code></dd></>}
    {check.timeout_seconds && <><dt>Timeout</dt><dd>{check.timeout_seconds} seconds</dd></>}
    {check.reason && <><dt>Reason</dt><dd>{check.reason}</dd></>}
    {'exit_code' in check && <><dt>Exit status</dt><dd>{check.exit_code ?? 'Not available — no completed process exit'}</dd></>}
    {check.seconds != null && <><dt>Duration</dt><dd>{check.seconds} seconds</dd></>}
  </dl>;
}

export function VerificationHistory({ checks = [] }) {
  return <section className="verification-history" aria-label="Verification history"><h3>Verification history</h3>
    <p className="coding-hint">Actual executions and skipped checks. A passing check covers only what that command tested.</p>
    {checks.length ? checks.map((check, index) => <details key={index} open={check.running || ['failed', 'timed_out', 'cancelled'].includes(checkStatus(check))}>
      <summary><span>{check.name}</span><span className={`verification-badge ${checkStatus(check)}`}>{checkStatus(check).replaceAll('_', ' ')}</span><span>revision {check.revision}</span></summary>
      <CheckEvidence check={check}/>{check.error && <p role="alert">{check.error}</p>}
      <pre>{check.output || (checkStatus(check) === 'not_run' ? 'This check did not execute.' : 'No process output recorded.')}</pre>
    </details>) : <p>No checks have run.</p>}
  </section>;
}

export function VerificationApproval({ pending, busy, onDecision }) {
  const [remember, setRemember] = useState(false);
  if (!pending) return null;
  const manual = pending.kind === 'manual';
  return <section className="verification-approval" aria-label="Verification approval" role="region">
    <span className="coding-eyebrow">{manual ? 'MANUAL VERIFICATION' : 'EXECUTION APPROVAL'}</span>
    <h3>{manual ? 'Ready for your verification run' : 'Review before executing'}</h3><p>{pending.reason}</p>
    {pending.checks.map(check => <div key={check.id}><h4>{check.name}</h4><CheckEvidence check={check}/><p className="coding-hint">{check.risk}</p></div>)}
    {!manual && <label className="coding-consent"><input type="checkbox" checked={remember} disabled={busy} onChange={event => setRemember(event.target.checked)}/>Save approval for this exact definition in this project</label>}
    <div className="coding-actions"><button className="coding-primary" disabled={busy} onClick={() => onDecision(true, remember)}>{manual ? 'Run verification now' : 'Approve for this task'}</button>
      <button disabled={busy} onClick={() => onDecision(false, false)}>{manual ? 'Finish without verification' : 'Do not run'}</button></div>
  </section>;
}

export default function CodingVerification({ catalog, selected, onSelected, mode, onMode, commands, onCommands,
  profileName, onProfileName, onProfile, onSave, onInspect, onApprove, onRevoke, busy, trusted, onTrusted }) {
  if (!catalog) return <section className="coding-verification"><h3>Verification Manager</h3><p>Choose a project to detect its environments and checks. Inspection does not execute project code.</p></section>;
  const groups = ['tests', 'types', 'lint', 'build', 'security'];
  return <section className="coding-verification" aria-labelledby="verification-heading">
    <header className="verification-heading"><div><span className="coding-eyebrow">PROJECT VERIFICATION</span><h3 id="verification-heading">Verification Manager</h3></div><button disabled={busy} onClick={onInspect}>Inspect again</button></header>
    <div className="verification-environment"><strong>{catalog.environments.join(' + ') || 'No recognized environment'}</strong><p>{catalog.inspection}</p></div>
    {catalog.warnings?.map((warning, index) => <p className="coding-hint" key={index}>{warning}</p>)}
    <div className="verification-profile"><label>Saved profile<select aria-label="Saved verification profile" defaultValue="" disabled={busy} onChange={event => { if (event.target.value) onProfile(catalog.profiles.find(profile => profile.name === event.target.value)); event.target.value = ''; }}>
      <option value="">Load a profile…</option>{catalog.profiles.map(profile => <option key={profile.name}>{profile.name}</option>)}</select></label>
      <label>Profile name<input value={profileName} disabled={busy} onChange={event => onProfileName(event.target.value)} maxLength={80} placeholder="For example: frontend changes"/></label><button disabled={busy || !profileName.trim()} onClick={onSave}>Save profile</button></div>
    <h4>1. Verification configuration</h4><p className="coding-hint">Select available checks. Final verification prioritizes their package and language for the changed files; other selections are recorded as not run.</p>
    {groups.map(category => {
      const checks = catalog.checks.filter(check => check.category === category);
      return checks.length > 0 && <fieldset className="verification-group" key={category}><legend>{({ tests: 'Tests', types: 'Type checks', lint: 'Lint / static analysis', build: 'Build', security: 'Security checks' })[category]}</legend>
        {checks.map(check => <div className={`verification-check ${check.unavailable ? 'unavailable' : ''}`} key={check.id}>
          <label className="verification-check-title"><input type="checkbox" checked={selected.includes(check.id)} disabled={busy || !!check.unavailable} onChange={event => onSelected(event.target.checked ? [...selected, check.id] : selected.filter(id => id !== check.id))}/><strong>{check.name}</strong><span className="verification-badge">{check.approved ? 'approved definition' : 'approval needed'}</span></label>
          <code className="verification-command">{displayCommand(check.argv) || 'Required tool unavailable'}</code>
          <span className="coding-hint">From {check.source} · {check.language} files · {check.timeout_seconds}s limit</span>
          {check.unavailable ? <p role="note">{check.unavailable}</p> : <details><summary>Command details and execution scope</summary><CheckEvidence check={check}/><p>{check.risk}</p></details>}
        </div>)}
      </fieldset>;
    })}
    {!catalog.checks.length && <p>No supported checks were found. Configure a Python or Node check under Advanced.</p>}
    <details className="verification-custom"><summary>Advanced / Custom checks</summary><p className="coding-hint">Optional Python or Node commands, one per line. Quote paths containing spaces. No shell pipelines. Custom checks run from the project root and always apply.</p>
      <label>Custom check commands<textarea aria-label="Custom check commands" value={commands} disabled={busy} onChange={event => onCommands(event.target.value)} rows={3} spellCheck={false} placeholder="python -m pytest -q"/></label></details>
    <h4>2. Execution permissions</h4><label>Permission policy<select value={mode} disabled={busy} onChange={event => onMode(event.target.value)}>
      <option value="ask">Ask before executing checks</option><option value="approved">Automatically run previously approved checks</option><option value="manual">Manual verification only</option></select></label>
    <p className="coding-hint">{mode === 'ask' ? 'Each definition needs approval during this task. An approval covers repeated executions while that definition stays unchanged.' : mode === 'approved' ? 'Saved approvals apply only to the same project, command, working directory, timeout and inspected configuration. New or changed definitions stop for approval.' : 'The model can prepare changes but cannot run checks. You choose Run verification now after implementation, or finish with an unverified result.'}</p>
    <div className="coding-actions"><button disabled={busy || !selected.length} onClick={onApprove}>Approve selected detected checks</button><button disabled={busy} onClick={onRevoke}>Forget saved approvals</button></div>
    <label className="coding-consent"><input type="checkbox" checked={trusted} disabled={busy} onChange={event => onTrusted(event.target.checked)}/>I trust this project’s checks to execute code on this PC.</label>
    <p className="coding-hint">Checks use your account permissions. Credentials are filtered and processes have time limits, but execution is not an OS sandbox. Profiles save configuration separately from approvals.</p>
    <output className="verification-selection">{selected.length} detected checks selected{commands.trim() ? ' + custom checks' : ''} · {mode === 'manual' ? 'manual execution' : mode === 'approved' ? 'saved approvals checked at execution' : 'approval required at execution'}</output>
  </section>;
}
