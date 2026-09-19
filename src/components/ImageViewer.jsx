import ProtectedImage from "../ImagePrivacy";
import { useEffect, useRef, useState } from "react";
import { useRefs } from "../useStore";

export function adjacentImageId(images, selectedId, direction) {
  const index = images.findIndex(image => image.id === selectedId);
  if (index < 0 || !images.length) return null;
  return images[(index + direction + images.length) % images.length].id;
}

export default function ImageViewer({ images, selectedId, onSelect, onClose, onOpenSource, active = true, actions, renderImage }) {
  const dialog = useRef(null);
  const refs = useRefs();
  const [failedId, setFailedId] = useState(null);
  const index = images.findIndex(image => image.id === selectedId);
  const image = images[index];
  const open = active && !!image;

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

  return <dialog ref={dialog} className="image-viewer" aria-label="Image viewer" onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    onKeyDown={event => {
      if (event.target.closest("input, textarea, select, [contenteditable=true]")) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault(); step(event.key === "ArrowLeft" ? -1 : 1);
      }
    }}>
    {image && <>
      <header className="image-viewer-header">
        <div><h2>{image.name}</h2><p aria-live="polite">{index + 1} of {images.length}{image.caption ? ` · ${image.caption}` : ""}</p></div>
        <button type="button" autoFocus onClick={onClose} aria-label="Close image viewer">Close ×</button>
      </header>
      <div className="image-viewer-stage">
        <button type="button" className="image-viewer-arrow previous" aria-label="Previous image" disabled={images.length < 2} onClick={() => step(-1)}>‹</button>
        {renderImage ? renderImage(image) : failedId === image.id ? <p role="alert">This image could not be loaded. You can still browse the other images.</p>
          : <ProtectedImage key={image.id} src={image.url} alt={image.name} onError={() => setFailedId(image.id)} />}
        <button type="button" className="image-viewer-arrow next" aria-label="Next image" disabled={images.length < 2} onClick={() => step(1)}>›</button>
      </div>
      <footer className="image-viewer-footer">
        <span>← → Browse images · Esc to close</span>
        {onOpenSource && image.session_id && <button type="button" onClick={() => { onClose(); onOpenSource(image.session_id, image.message_id); }}>Go to source chat</button>}
        {actions?.(image)}
      </footer>
    </>}
  </dialog>;
}
