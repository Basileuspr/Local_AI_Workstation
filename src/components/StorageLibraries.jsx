import { useEffect, useState } from 'react';
import { loadStorageLibraries, addStorageLibrary, setDefaultStorageLibrary, chooseStorageParent, openStorageLibrary } from '../storageLibraries';
import { formatBytes } from '../systemSpecs';
import './StorageLibraries.css';

export default function StorageLibraries({ active = true, drives = [] }) {
  const [open, setOpen] = useState(false), [state, setState] = useState(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [parent, setParent] = useState(''), [name, setName] = useState('Local AI Workstation Library'), [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (!active || !open) return;
    let live = true;
    loadStorageLibraries().then(value => { if (live) { setState(value); setError(''); } }).catch(failure => { if (live) setError(failure.message); });
    return () => { live = false; };
  }, [active, open]);

  async function action(work) {
    setBusy(true); setError(''); setNotice('');
    try { await work(); setState(await loadStorageLibraries()); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function add(event) {
    event.preventDefault();
    await action(async () => {
      const library = await addStorageLibrary({ parent: parent.trim(), name: name.trim(), label: label.trim() });
      setAdding(false); setNotice(`Library ready: ${library.path}. Choose Use for new files to make it the default.`);
    });
  }
  const current = state?.libraries.find(item => item.default);
  return <details className="dashboard-card storage-libraries" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><strong>Storage libraries</strong><span>{current?.label || 'Folders for generated and imported files'}</span></summary>
    {open && <>

      {error && <p className="storage-error" role="alert">{error}</p>}
      {notice && <p className="dashboard-note" role="status">{notice}</p>}
      <div className="storage-actions"><button type="button" disabled={busy} onClick={() => setAdding(value => !value)}>{adding ? 'Close add form' : 'Add library'}</button>
        <button type="button" disabled={busy} onClick={() => action(async () => {})}>Refresh drives</button></div>
      {adding && <form className="storage-add" onSubmit={add}>
        {drives.length > 0 && <label>Drive<select aria-label="Library drive" value="" onChange={event => setParent(event.target.value)}><option value="">Choose a drive…</option>{drives.map(drive => <option key={drive.mountpoint} value={drive.mountpoint}>{drive.mountpoint} · {formatBytes(drive.free_bytes)} free</option>)}</select></label>}
        <label>Parent folder or drive<input aria-label="Library parent folder" value={parent} onChange={event => setParent(event.target.value)} placeholder="E:\" required disabled={busy} /></label>
        <button type="button" disabled={busy} onClick={() => action(async () => { const folder = await chooseStorageParent(); if (folder) setParent(folder); })}>Browse</button>
        <label>App folder name<input aria-label="Library folder name" value={name} onChange={event => setName(event.target.value)} required maxLength={80} disabled={busy} /></label>
        <label>Display name <small>Optional</small><input aria-label="Library display name" value={label} onChange={event => setLabel(event.target.value)} maxLength={120} disabled={busy} placeholder="Media drive" /></label>

        <button type="submit" disabled={busy || !parent.trim() || !name.trim()}>{busy ? 'Working…' : 'Create or attach library'}</button>
      </form>}
      <div className="storage-library-list">{state?.libraries.map(library => <article key={library.id}>
        <div><strong>{library.label}</strong><span className="storage-badge">{!library.available ? library.default ? 'Unavailable · default' : 'Unavailable' : library.default ? 'Default for new files' : 'Available'}</span>
          <code>{library.path}</code><small>{library.available ? `${formatBytes(library.free_bytes)} free on drive` : library.error}</small></div>
        <div className="storage-actions"><button type="button" disabled={busy || !library.available} onClick={() => action(() => openStorageLibrary(library.id))}>Open folder</button>
          {!library.default && <button type="button" disabled={busy || !library.available} onClick={() => action(async () => { await setDefaultStorageLibrary(library.id); setNotice(`New files will use ${library.label}. Earlier files stay in their current libraries.`); })}>Use for new files</button>}</div>
      </article>)}</div>
      {!state && !error && <p className="dashboard-note">Loading storage libraries…</p>}
      <details className="storage-help"><summary>What uses these libraries?</summary>



      </details>
    </>}
  </details>;
}
