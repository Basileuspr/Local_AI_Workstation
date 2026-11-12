import { useEffect, useState } from 'react';
import ImageStudio from './ImageStudio';
import LocalMediaGeneration from './LocalMediaGeneration';

export default function GenerationWorkspace({active = true, openGeneration}) {
  const [mode, setMode] = useState('images');
  useEffect(() => {if (openGeneration) setMode(openGeneration.mode);}, [openGeneration]);
  return <div className="generation-workspace">
    <div className="local-media-tabs" role="group" aria-label="Generation workspace">
      <button aria-pressed={mode === 'images'} onClick={() => setMode('images')}>Image generation</button>
      <button aria-pressed={mode === 'media'} onClick={() => setMode('media')}>Qwen images &amp; Wan video</button>
    </div>
    <div className="generation-workspace-panel" hidden={mode !== 'images'}><ImageStudio active={active && mode === 'images'}/></div>
    <div className="generation-workspace-panel generation-workspace-media" hidden={mode !== 'media'}><LocalMediaGeneration active={active && mode === 'media'}/></div>
  </div>;
}
