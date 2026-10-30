import { useRef, useState } from 'react';
import { downloadImage } from '../imageLibraryApi';

export default function ImageFileActions({ image, disabled = false }) {
  const [busy, setBusy] = useState(false), lock = useRef(false);
  const [result, setResult] = useState(null), [error, setError] = useState('');
  if (!/\/image-library\/images\/[a-f0-9]{32}\/content(?:[?#]|$)/.test(image.url || '')) return null;
  async function act(operation) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { const value = await operation(); if (value?.error) throw Error(value.error); return value; }
    catch (failure) { setError(failure.message); }
    finally { lock.current = false; setBusy(false); }
  }
  const desktop = globalThis.window?.workstationDesktop;
  return <div className="image-file-actions" aria-label="Save image outside the app">
    <button type="button" disabled={disabled || busy} onClick={() => act(async () => { const saved = await downloadImage(image); if (!saved.canceled) setResult(saved); })}>{busy ? 'Working…' : 'Save image as…'}</button>
    {desktop?.revealLibraryImage && <button type="button" disabled={disabled || busy} onClick={() => act(() => desktop.revealLibraryImage(image.id))}>Show original in folder</button>}
    {result?.saved && <><span role="status">Saved: {result.path}</span>
      <button type="button" disabled={disabled || busy} onClick={() => act(() => desktop.openSavedLibraryImage(result.receipt, 'open'))}>Open saved copy</button>
      <button type="button" disabled={disabled || busy} onClick={() => act(() => desktop.openSavedLibraryImage(result.receipt, 'reveal'))}>Show saved copy in folder</button></>}
    {result?.started && <span role="status">Download sent to your browser.</span>}
    {error && <span role="alert">{error}</span>}
  </div>;
}
