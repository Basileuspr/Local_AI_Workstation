import { useEffect, useState } from 'react';

const names = { compatible: 'Windows compatibility', hardware: 'Hardware accelerated', software: 'Software rendering' };

export default function WindowRenderingSettings() {
  const desktop = typeof window !== 'undefined' ? window.workstationDesktop : null;
  const [status, setStatus] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (!desktop?.renderingStatus) return;
    let stopped = false;
    desktop.renderingStatus().then(value => { if (!stopped) setStatus(value); })
      .catch(() => { if (!stopped) setError('Could not read window rendering settings.'); });
    return () => { stopped = true; };
  }, [desktop]);
  if (!desktop?.renderingStatus || !desktop?.setRenderingMode) return null;
  async function change(mode) {
    setBusy(true); setError('');
    try {
      const next = await desktop.setRenderingMode(mode);
      if (!next) throw new Error('Window rendering settings are unavailable.');
      setStatus(next); setError(next.error || '');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <section className="window-rendering-settings" aria-label="Window rendering settings">
    <h3>Window rendering</h3>
    <label>Rendering mode<select disabled={!status || busy} value={status?.savedMode || 'compatible'} onChange={event => change(event.target.value)}>
      {Object.entries(names).filter(([id]) => id !== 'compatible' || !status || status.platform === 'win32').map(([id, name]) => <option key={id} value={id}>{name}{id === 'compatible' ? ' (default)' : ''}</option>)}
    </select></label>

    {status && <p role="status">Active: {names[status.activeMode]}.
      {status.restartRequired && ' Saved for next launch. Finish your work, Quit from the system tray, then reopen to apply.'}
      {status.forcedSoftware && ' This launch was started with software rendering forced.'}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
