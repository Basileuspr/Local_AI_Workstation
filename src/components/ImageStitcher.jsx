import { useEffect, useRef, useState } from 'react';
import { useImagePrivacy } from '../ImagePrivacy';
import ImageThumbnail from './ImageThumbnail';
import * as api from '../imageLibraryApi';
import { stitchKey } from '../imageStitcher';
import './ImageStitcher.css';
import ImageZoom from './ImageZoom';
import ImageFileActions from './ImageFileActions';
import { imageSourceUrl } from '../imageSources';

export function StitchFrameButton({ stitcher, image, always = false }) {
  if (!stitcher || (!always && !stitcher.enabled)) return null;
  const number = stitcher.number(image);
  return <button type="button" className="stitch-frame-toggle" aria-pressed={!!number} disabled={stitcher.busy}
    aria-label={number ? `Remove frame ${number}: ${image.name} from stitcher` : `Add ${image.name} to stitcher`}
    onClick={() => stitcher.toggle(image)}>{number ? `Frame ${number} · Remove` : '＋ Add to stitcher'}</button>;
}

function FrameOrder({ stitcher }) {
  return <ol className="stitch-frame-list" aria-label="Stitch frame order">
    {stitcher.frames.map((image, index) => <li key={stitchKey(image)}>
      <ImageThumbnail src={image.url} alt={image.name} rotateView={false} />
      <span className="stitch-frame-name" title={image.name}><b>{index + 1}.</b> {image.name}</span>
      <div><button type="button" disabled={stitcher.busy || index === 0} aria-label={`Move frame ${index + 1} earlier`} onClick={() => stitcher.move(image, -1)}>←</button>
        <button type="button" disabled={stitcher.busy || index === stitcher.frames.length - 1} aria-label={`Move frame ${index + 1} later`} onClick={() => stitcher.move(image, 1)}>→</button>
        <button type="button" disabled={stitcher.busy} aria-label={`Remove frame ${index + 1}`} onClick={() => stitcher.remove(image)}>×</button></div>
    </li>)}
  </ol>;
}

export default function ImageStitcher({ stitcher, active }) {
  const dialog = useRef(null), lock = useRef(false);
  const privacy = useImagePrivacy();
  const [options, setOptions] = useState({ layout: 'row', columns: 0, tile_size: 1024, gap: 0, background: 'dark' });
  const [result, setResult] = useState(null), [saved, setSaved] = useState(null), [failure, setFailure] = useState(null);
  const [retry, setRetry] = useState(0);
  const body = JSON.stringify({ ...options, sources: stitcher.frames.map(api.sourceFor) });
  const key = `${body}:${privacy.ready}:${privacy.revision}:${retry}`;
  const preview = result?.key === key ? result.value : null;
  const savedImage = saved?.body === body ? saved.image : null;
  const locked = (preview && privacy.hashes.includes(preview.sha256)) || (savedImage && privacy.hashes.includes(savedImage.sha256));
  const error = locked ? 'This stitched image is locked. Restore it in Locked Images before using it.' : failure?.key === key ? failure.message : '';
  const open = active && stitcher.open;
  const enough = stitcher.frames.length >= 2;
  useEffect(() => {
    if (open) dialog.current?.showModal(); else dialog.current?.close();
  }, [open]);
  useEffect(() => {
    if (!open || !enough || !privacy.ready || savedImage) return;
    const controller = new AbortController();
    let ignore = false;
    setResult(null);
    const timer = setTimeout(async () => {
      try {
        const value = await api.previewStitch(JSON.parse(body), controller.signal);
        // Hash the bytes already returned by the API. The desktop CSP allows
        // inline image display, but intentionally disallows fetching data/blob URLs.
        if (!value.preview.startsWith('data:image/png;base64,')) throw new Error('Invalid stitch preview.');
        const bytes = Uint8Array.from(atob(value.preview.split(',')[1]), char => char.charCodeAt(0));
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        const sha256 = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        if (!ignore) { setResult({ key, value: { ...value, sha256 } }); setFailure(null); }
      } catch (error) { if (!ignore) setFailure({ key, message: error.message }); }
    }, 350);
    return () => { ignore = true; clearTimeout(timer); controller.abort(); };
  }, [body, key, open, enough, privacy.ready, savedImage]);

  async function save() {
    if (lock.current || !preview || !enough || error) return;
    lock.current = true; stitcher.setBusy(true); setFailure(null);
    try {
      const image = await api.saveStitch(JSON.parse(body));
      setSaved({ body, image }); api.changed();
    } catch (error) { setFailure({ key, message: error.message }); }
    finally { lock.current = false; stitcher.setBusy(false); }
  }
  function option(name, value) { setOptions(current => ({ ...current, [name]: value })); }
  return <>
    {stitcher.enabled && <section className="image-stitcher-tray" aria-label="Image stitcher selections">
      <header><strong>Stitcher · {stitcher.frames.length} frames</strong>
        <button type="button" disabled={stitcher.busy || !enough} onClick={() => stitcher.setOpen(true)}>Preview stitch</button>
        <button type="button" disabled={stitcher.busy || !enough} onClick={stitcher.reverse}>Reverse order</button>
        <button type="button" disabled={stitcher.busy || !stitcher.frames.length} onClick={stitcher.clear}>Clear frames</button>
        <button type="button" disabled={stitcher.busy} onClick={() => stitcher.setEnabled(false)}>Collapse stitcher</button></header>
      <p>Add the frames that fit your scene; skip any attempts you don’t want. Numbers show the final order. Picks stay while you browse pages, search, and switch collections.</p>
      {stitcher.error && <p role="alert">{stitcher.error}</p>}
      {!!stitcher.frames.length && <FrameOrder stitcher={stitcher} />}
    </section>}
    {open && <dialog ref={dialog} className="image-stitcher-dialog" aria-label="Image stitcher" onCancel={() => stitcher.setOpen(false)} onClose={() => { if (active) stitcher.setOpen(false); }}>
      {open && <>
        <header><h2>Stitch your frames</h2><button type="button" autoFocus onClick={() => stitcher.setOpen(false)}>Keep browsing</button></header>
        <FrameOrder stitcher={stitcher} />
        <fieldset disabled={stitcher.busy} className="stitch-options"><legend>Layout</legend>
          <label>Arrangement<select aria-label="Stitch layout" value={options.layout} onChange={event => option('layout', event.target.value)}>
            <option value="row">Horizontal strip</option><option value="column">Vertical strip</option><option value="grid">Grid</option></select></label>
          {options.layout === 'grid' && <label>Columns · 0 = auto<input type="number" min="0" step="1" aria-label="Stitch columns" value={options.columns} onChange={event => option('columns', Number(event.target.value))} /></label>}
          <label>Frame size · 0 = original<input type="number" min="0" step="1" aria-label="Stitch frame size" value={options.tile_size} onChange={event => option('tile_size', Number(event.target.value))} /></label>
          <label>Spacing (px)<input type="number" min="0" step="1" aria-label="Stitch spacing" value={options.gap} onChange={event => option('gap', Number(event.target.value))} /></label>
          <label>Background<select aria-label="Stitch background" value={options.background} onChange={event => option('background', event.target.value)}>
            <option value="dark">Dark</option><option value="white">White</option><option value="transparent">Transparent</option></select></label>
        </fieldset>
        <p>Frames fit inside equal cells without cropping or stretching. Grid order reads left to right, then down. Larger selections take longer and use temporary disk space; the saved image keeps your chosen size. Originals are preserved.</p>
        {!enough ? <p role="status">Choose at least two frames to stitch.</p> : !privacy.ready ? <p role="status">Checking image access…</p> : !savedImage && !preview && !error && <p role="status">Preparing preview…</p>}
        {error && <p role="alert">{error} <button type="button" disabled={stitcher.busy} onClick={() => setRetry(value => value + 1)}>Retry preview</button></p>}
        {enough && (preview || savedImage) && !locked && privacy.ready && <figure className="stitch-preview">{savedImage
          ? <ImageZoom key={savedImage.id} src={imageSourceUrl(savedImage.url)} previewSrc={imageSourceUrl(savedImage.preview_url)} width={savedImage.width} height={savedImage.height} alt="Saved stitched image" />
          : <img src={preview.preview} alt="Stitched image preview" onError={() => setFailure({ key, message: 'Could not display the preview. Try again before saving.' })} />}
          <figcaption>{(savedImage || preview).width} × {(savedImage || preview).height} px · {stitcher.frames.length} frames · {savedImage ? 'Zoom loads the full-resolution original' : 'Preview scaled for display'}</figcaption></figure>}
        <footer><button type="button" disabled={stitcher.busy || !enough || !preview || !!error} onClick={save}>{stitcher.busy ? 'Working…' : 'Save stitched image'}</button>
          {savedImage && <><span role="status">Saved in Saved Images: {savedImage.name}</span><ImageFileActions key={savedImage.id} image={savedImage} disabled={stitcher.busy} /></>}
        </footer>
      </>}
    </dialog>}
  </>;
}
