import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ImageManagerTools from '../../src/components/ImageManagerTools';
import * as images from '../../src/imageManagerApi';
import { apiUrl } from '../../src/api';
import '../../src/styles.css';
import '../../src/components/ImageManager.css';

const report = message => { document.getElementById('fixture-errors').textContent += message + '\n'; };
window.addEventListener('error', event => report(event.message));
window.addEventListener('unhandledrejection', event => report(event.reason?.message || String(event.reason)));

function Dialog({ title, children, className, onClose }) {
  const ref = useRef(null);
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} className={`im-dialog ${className}`} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2>{title}</h2><button aria-label="Close dialog" onClick={onClose}>✕</button></header>{children}
  </dialog>;
}

// Only native folder selection is simulated. The real component, catalog scans
// and image exports use the disposable fixture backend.
const selected = [];
function Fixture() {
  const [state, setState] = useState({ folders: [], job: null }), [open, setOpen] = useState(true);
  async function refresh() { setState(await images.request()); }
  useEffect(() => { refresh(); const timer = setInterval(refresh, 500); return () => clearInterval(timer); }, []);
  async function choose(purpose) {
    const paths = await fetch(apiUrl('/fixture/folders')).then(response => response.json());
    const folder = await images.request('/folders', 'POST', { path: paths[purpose], purpose });
    await refresh(); return folder;
  }
  async function start(kind, payload) { const result = await images.task(kind, payload); await refresh(); return result; }
  return <main style={{ height: '100dvh', padding: 24 }}>
    <h1>Image Tools verification</h1><p>Temporary images, real exports; simulated native folder selection.</p>
    <button onClick={() => setOpen(true)}>Image tools</button>
    {open && <ImageManagerTools Dialog={Dialog} folders={state.folders} selected={selected} folderId="" outputId="" job={state.job} disabled={state.job?.status === 'running'}
      chooseSource={() => choose('source')} chooseOutput={() => choose('output')}
      scan={payload => start('scan', payload)} start={payload => start('image-tools', payload)} onClose={() => setOpen(false)}/>}
  </main>;
}
if (!window.workstationDesktop) window.workstationDesktop = { async revealManagedImage() { return { ok: true }; } };
createRoot(document.getElementById('root')).render(<Fixture/>);
