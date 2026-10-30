import { useEffect, useRef, useState } from 'react';
import { useImageDestinations } from '../ImageDestinations';
import * as images from '../imageManagerApi';
import { ImageBrowseButton, imageBrowseDirection } from './ImageBrowseControls';
import { StitchFrameButton } from './ImageStitcher';
import ImageZoom from './ImageZoom';

export default function ImageManagerPreview({ image: initial, page, filters, view, pageSize, onPage, onClose, onStage, Dialog, stitcher }) {
  const [image, setImage] = useState(initial);
  const [position, setPosition] = useState(() => ({ offset: (page.offset || 0) + page.images.findIndex(item => item.id === initial.id), total: page.total }));
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const pending = useRef(null), destinations = useImageDestinations();
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    const index = page.images.findIndex(item => item.id === image.id);
    setPosition(current => ({ offset: index < 0 ? current.offset : (page.offset || 0) + index, total: page.total }));
  }, [page]);
  async function step(direction) {
    if (pending.current || busy || position.total < 2) return;
    const controller = new AbortController(); pending.current = controller;
    setLoading(true); setError('');
    try {
      const result = await images.request(`/images?${new URLSearchParams({ ...filters, visibility: images.imageVisibility(filters, view), anchor: image.id, step: direction, limit: 1 })}`, 'GET', undefined, controller.signal);
      if (controller.signal.aborted) return;
      if (!result.images.length) throw new Error('No images match these filters anymore. Close the preview and refresh the catalog.');
      setImage(result.images[0]); setPosition({ offset: result.offset, total: result.total }); setFailed(false); setRetry(0);
      onPage(Math.floor(result.offset / pageSize) * pageSize);
    } catch (error) { if (!controller.signal.aborted) setError(error.message); }
    finally { if (!controller.signal.aborted) { pending.current = null; setLoading(false); } }
  }
  async function perform(action) {
    setBusy(true); setError('');
    try { await action(); } catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  const disabled = loading || busy;
  return <Dialog title={image.relative} className="im-image-preview" onClose={onClose} onKeyDown={event => {
    const direction = imageBrowseDirection(event);
    if (direction) { event.preventDefault(); void step(direction); }
  }}>
    <p aria-live="polite">{position.offset + 1} of {position.total} matching images{loading ? ' · Loading…' : ''}</p>
    <div className="im-preview-stage" aria-busy={loading}>
      <ImageBrowseButton direction={-1} disabled={disabled || position.total < 2} onStep={step} />
      {failed ? <div role="alert"><p>This image could not be loaded. You can still browse the other images.</p><button onClick={() => { setFailed(false); setRetry(value => value + 1); }}>Reload image</button></div>
        : <ImageZoom key={`${image.id}:${retry}`} imageClassName="im-preview" src={images.originalImage(image).url} previewSrc={`${images.imageUrl(image, true)}&retry=${retry}`} width={image.width} height={image.height} alt={image.relative} onError={() => setFailed(true)} />}
      <ImageBrowseButton direction={1} disabled={disabled || position.total < 2} onStep={step} />
    </div>
    <p>{image.width} × {image.height} · {image.format} · {images.bytesLabel(image.bytes)} · {image.date_source}: {image.date.slice(0, 10)}</p>
    <p className="im-path">{image.folder_path} / {image.relative}</p>
    <div className="im-controls">
      <StitchFrameButton stitcher={stitcher} image={images.stitchImage(image)} always />
      <button disabled={stitcher.busy || stitcher.frames.length < 2} onClick={() => { onClose(); stitcher.setOpen(true); }}>Preview stitch</button>
      <button disabled={disabled} onClick={() => perform(async () => {
        const result = await window.workstationDesktop?.revealManagedImage(image.id);
        if (!result || result.error) throw new Error(result?.error || 'Show in folder requires the desktop app.');
      })}>Show in folder</button>
      <button disabled={disabled} onClick={() => perform(async () => { await destinations.take(images.originalImage(image), 'editor'); onClose(); })}>Edit image</button>
      <button disabled={disabled} onClick={() => perform(() => onStage(image))}>Add to chat draft</button>
      <button disabled={disabled} onClick={() => perform(async () => { await destinations.take(images.originalImage(image), 'folder'); onClose(); })}>Save copy to Gallery</button>
    </div>
    {error && <p role="alert" className="im-error">{error}</p>}
    <footer>← → Browse images · Esc to close</footer>
  </Dialog>;
}
