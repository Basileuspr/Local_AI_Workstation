import ProtectedImage from "../ImagePrivacy";
import { useEffect, useRef, useState } from "react";
import { useRefs } from "../useStore";
import { useImageDestinations } from "../ImageDestinations";
import ImageItemActions from "./ImageItemActions";
import ImageSeedControls from "./ImageSeedControls";
import {useImageRemoval} from "./ImageRemovalControls";

export function adjacentImageId(images, selectedId, direction) {
  const index = images.findIndex(image => image.id === selectedId);
  if (index < 0 || !images.length) return null;
  return images[(index + direction + images.length) % images.length].id;
}

export default function ImageViewer({ images, selectedId, onSelect, onClose, onOpenSource, onAnalyze, active = true, actions, renderImage, onRemove, previewOnly = false }) {
  const dialog = useRef(null);
  const refs = useRefs();
  const destinations = useImageDestinations();
  const [sending, setSending] = useState(false), [actionError, setActionError] = useState("");
  const [failedId, setFailedId] = useState(null);
  const index = images.findIndex(image => image.id === selectedId);
  const image = images[index];
  const open = active && !!image;
  const removal = useImageRemoval(onRemove ? images : [], chosen => {
    onRemove(chosen);
    if (chosen.some(item => item.id === selectedId)) {
      const ids = new Set(chosen.map(item => item.id));
      const next = images.find(item => !ids.has(item.id));
      if (next) onSelect(next.id); else onClose();
    }
  }, {label:'viewer images', disabled:sending});
  useEffect(() => setActionError(""), [selectedId]);

  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    const node = dialog.current;
    node.showModal();
    if (refs) refs.imageViewerOpen = true;
    return () => {
      if (refs) refs.imageViewerOpen = false;
      node.close();
    };
  }, [open, refs]);

  function step(direction) { onSelect(adjacentImageId(images, selectedId, direction)); }
  async function take(destination) {
    setSending(true); setActionError("");
    try { await destinations.take(image, destination); onClose(); }
    catch (error) { setActionError(error.message); }
    finally { setSending(false); }
  }

  return <dialog ref={dialog} className="image-viewer" aria-label={previewOnly ? "Image preview" : "Image viewer"} onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    onKeyDown={event => {
      if (event.target.closest("input, textarea, select, [contenteditable=true]")) return;
      if (!previewOnly && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault(); step(event.key === "ArrowLeft" ? -1 : 1);
      }
    }}>
    {image && <>
      <header className="image-viewer-header">
        <div><h2>{image.name}</h2><p aria-live="polite">{!previewOnly && `${index + 1} of ${images.length}`}{image.caption ? `${previewOnly ? "" : " · "}${image.caption}` : ""}</p></div>
        <button type="button" autoFocus onClick={onClose} aria-label="Close image viewer">Close ×</button>
      </header>
      <div className="image-viewer-stage">
        {!previewOnly && <button type="button" className="image-viewer-arrow previous" aria-label="Previous image" disabled={images.length < 2} onClick={() => step(-1)}>‹</button>}
        {renderImage ? renderImage(image) : failedId === image.id ? <p role="alert">This image could not be loaded. You can still browse the other images.</p>
          : <ProtectedImage key={image.id} src={image.url} alt={image.name} rotateView={!previewOnly} onError={() => setFailedId(image.id)} />}
        {!previewOnly && <button type="button" className="image-viewer-arrow next" aria-label="Next image" disabled={images.length < 2} onClick={() => step(1)}>›</button>}
      </div>
      {!previewOnly && <>
        {destinations && <div className="image-destination-bar" aria-label="Use this image"><button disabled={sending} onClick={() => take("workflow")}>Start Workflow</button><button disabled={sending} onClick={() => take("editor")}>Edit Image</button><button disabled={sending} onClick={() => take("gif")}>GIF Maker</button>{sending && <span role="status">Opening image…</span>}</div>}
        <ImageItemActions image={image} chat={!!image.chat_session_id} onChatEdit={onClose} onGenerate={onClose} />
        <ImageSeedControls key={image.id} seed={image.seed} onReuse={onClose} />
      </>}
      {actionError && <p className="image-destination-error" role="alert">{actionError}</p>}
      <footer className="image-viewer-footer">
        {onRemove && <div>{removal.toolbar}{removal.controls(image, image.name)}</div>}
        <span>{previewOnly ? "Esc to close" : "← → Browse images · Esc to close"}</span>
        {onAnalyze && <button type="button" className="analyze-iterate-button" onClick={() => { onClose(); onAnalyze(image); }}>Analyze &amp; Iterate</button>}
        {onOpenSource && image.session_id && <button type="button" onClick={() => { onClose(); onOpenSource(image.session_id, image.message_id); }}>Go to source chat</button>}
        {actions?.(image)}
      </footer>
    </>}
  </dialog>;
}
