import {useState} from 'react';
import {gifFilename} from '../gifMaker';

export default function GifSaveActions({blob, url, name, initialSaved=null}) {
  const desktop = typeof window !== 'undefined' ? window.workstationDesktop : null;
  const supported = !!(desktop?.saveGif && desktop?.revealGif);
  const [saved, setSaved] = useState(initialSaved), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await desktop.saveGif({bytes: await blob.arrayBuffer(), name: gifFilename(name)});
      if (result.error) throw new Error(result.error);
      if (!result.canceled) setSaved(result);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function reveal() {
    if (!saved || busy) return;
    setBusy(true); setError('');
    try { const result = await desktop.revealGif(saved.id); if (result.error) throw new Error(result.error); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <div className="gif-save-actions">
    <div>{supported ? <button type="button" disabled={busy} onClick={save}>{busy ? 'Please wait…' : 'Save GIF'}</button> : <a href={url} download={gifFilename(name)}>Save GIF</a>}
      <button type="button" disabled={!supported || !saved || busy} title={!supported ? 'Open in the desktop app to reveal saved files.' : saved?.path || 'Save the GIF first.'} onClick={reveal}>Open file location</button></div>
    {saved && <small role="status">Saved to {saved.path}</small>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
