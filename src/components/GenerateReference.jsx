import { useEffect, useRef, useState } from 'react';
import { readReferenceImage, REFERENCE_PRESETS, refinementSteps } from '../generationReference';
import ImageViewer from './ImageViewer';
import ReferenceAnalysis from './ReferenceAnalysis';

export default function GenerateReference({ reference, onChange, strength, onStrength, fit, onFit, steps, onBusyChange, active = true, onSettings, prompt = '', onPrompt }) {
  const input = useRef(null), serial = useRef(0);
  const [error, setError] = useState(''), [reading, setReading] = useState(false);
  const [previewId, setPreviewId] = useState(null);
  useEffect(() => () => { serial.current++; }, []);
  useEffect(() => { if (!active) setPreviewId(null); }, [active]);
  const previewImages = reference ? [{ id: reference.url, url: reference.url, name: reference.file.name,
    caption: `Reference image · ${reference.width} × ${reference.height}` }] : [];
  async function choose(file) {
    if (!file) return;
    const ticket = ++serial.current;
    setPreviewId(null);
    setError(''); setReading(true); onBusyChange?.(true);
    try {
      const value = await readReferenceImage(file);
      if (ticket !== serial.current) { URL.revokeObjectURL(value.url); return; }
      onChange(value);
    } catch (failure) { if (ticket === serial.current) setError(failure.message); }
    finally { if (ticket === serial.current) { setReading(false); onBusyChange?.(false); } }
  }
  return <section className="generate-reference" aria-label="Reference image" tabIndex={0}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
    onDrop={event => { event.preventDefault(); void choose(event.dataTransfer.files[0]); }}
    onPaste={event => { const item = [...event.clipboardData.items].find(item => item.type.startsWith('image/')); if (item) { event.preventDefault(); void choose(item.getAsFile()); } }}>
    <strong>Reference image</strong>
    <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload image to Generate"
      onChange={event => { void choose(event.target.files[0]); event.target.value = ''; }} />
    <button type="button" onClick={() => input.current.click()}>{reading ? 'Reading image…' : reference ? 'Replace image' : 'Upload image'}</button>

    {reference && <>
      <button type="button" className="generate-reference-preview" aria-label="Enlarge reference image"
        title="Click to enlarge reference image" onClick={() => setPreviewId(reference.url)}>
        <img src={reference.url} alt="Reference for the next generation" />
        <span>Enlarge image</span>
      </button>
      <small>{reference.file.name} · {reference.width} × {reference.height}</small>
      <button type="button" onClick={() => { serial.current++; setReading(false); onBusyChange?.(false); setError(''); onChange(null); }}>Remove reference</button>
      <strong>Close variation</strong>
      {onSettings && <div className="reference-presets" role="group" aria-label="Likeness and emulation presets">
        {REFERENCE_PRESETS.map(preset => <button type="button" key={preset.id} onClick={() => {
          onStrength(preset.strength); onFit('edge'); onSettings({steps: preset.steps, guidanceScale: preset.guidanceScale});
        }}>{preset.label}</button>)}

      </div>}
      <label>Change amount · {Math.round(strength * 100)}%
        <input aria-label="Change amount" type="range" min="0.05" max="1" step="0.05" value={strength} onChange={event => onStrength(Number(event.target.value))} />
      </label>

      <label>Fit reference to output<select value={fit} onChange={event => onFit(event.target.value)}>
        <option value="contain">Fit whole image (white padding)</option><option value="edge">Fit whole image (extend edges)</option><option value="crop">Crop to fill (center crop)</option>
      </select></label>
      <small>{Math.floor(Number(steps) * strength)} denoising steps at the current settings. The original file stays unchanged.</small>
      {onSettings && Math.floor(Number(steps) * strength) < 20 && <button type="button" onClick={() => onSettings({steps: refinementSteps(strength)})}>Increase refinement steps</button>}

      {onPrompt && <ReferenceAnalysis key={reference.url} reference={reference} prompt={prompt} onPrompt={onPrompt} onBusyChange={onBusyChange}/>}
    </>}
    {error && <p role="alert">{error}</p>}
    <ImageViewer images={previewImages} selectedId={previewId} onSelect={setPreviewId}
      onClose={() => setPreviewId(null)} active={active} previewOnly />
  </section>;
}
