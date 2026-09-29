import {useState} from 'react';

export default function GifOutputFolder({value, onChange, disabled=false}) {
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  const picker = typeof window !== 'undefined' && window.workstationDesktop?.chooseGifOutputFolder;
  async function choose() {
    setBusy(true); setError('');
    try {
      const result = await picker();
      if (result.error) throw new Error(result.error);
      if (!result.canceled && result.id && result.folder) onChange(result);
    } catch (failure) {setError(failure.message?.includes('No handler registered') ? 'Quit the app from its system tray menu and reopen it to enable GIF Point output.' : failure.message);}
    finally {setBusy(false);}
  }
  return <div className="gif-output-folder">
    <div><button type="button" onClick={choose} disabled={disabled || busy || !picker} title={picker ? 'Automatically save new GIFs in this folder' : 'Folder selection is available in the desktop app'}>{busy ? 'Choosing…' : 'Point output'}</button>
      <span title={value?.folder || 'Choose a folder to save completed GIFs automatically'}>{value ? value.folder.replace(/[\\/]+$/,'').split(/[\\/]/).pop() || value.folder : 'Save manually'}</span>
      {value && <button type="button" disabled={disabled || busy} aria-label="Clear GIF output folder" title="Return to manual saving" onClick={()=>{onChange(null);setError('');}}>Clear</button>}
    </div>{error && <small role="alert">{error}</small>}
  </div>;
}
