import { useEffect, useRef, useState } from 'react';
import { checkAppUpdates } from '../applicationAwareness';
import './AppUpdateCheck.css';

export default function AppUpdateCheck() {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [result, setResult] = useState(null), [error, setError] = useState('');
  const dialog = useRef(null), trigger = useRef(null), lock = useRef(false);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  async function check() {
    if (lock.current) return;
    lock.current = true; setOpen(true); setBusy(true); setError(''); setResult(null);
    try { setResult(await checkAppUpdates()); }
    catch (failure) { setError(failure.message || 'Could not check application updates.'); }
    finally { lock.current = false; setBusy(false); }
  }
  function close() { setOpen(false); trigger.current?.focus(); }
  return <><button ref={trigger} type="button" className="app-update-trigger" title="Check for application updates" aria-label="Check for Updates" disabled={busy} onClick={check}>{busy ? 'Checking updates…' : 'Check for Updates'}</button>
    <dialog ref={dialog} className="app-update-dialog" aria-label="Application updates" onCancel={event => { event.preventDefault(); close(); }}>
      <h2>Application updates</h2>
      {busy && <p role="status">Checking the configured release feed…</p>}
      {error && <p role="alert">{error}</p>}
      {result && <><p role="status">{{ up_to_date: 'Up to date', update_available: 'Update available', unable_to_check: 'Unable to check' }[result.status] || 'Update status unavailable'}</p>
        <dl><dt>Installed version</dt><dd>{result.current_version || 'Unknown'}</dd><dt>Release feed version</dt><dd>{result.latest_version || 'Unknown'}</dd></dl>
        <p>{result.detail}</p></>}
      <footer><button type="button" disabled={busy} onClick={check}>Check again</button><button type="button" onClick={close}>Close</button></footer>
    </dialog></>;
}
