import React, { useEffect, useRef, useState } from "react";
import { mediaUrl, prepareImageShare, sharePreparedImage } from "./api";
import "./ImageViewer.css";

const fitted = () => ({ scale: 1, x: 0, y: 0 });
const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));

export function ZoomableImage({ src, alt }) {
  const viewport = useRef(null), image = useRef(null), pointers = useRef(new Map());
  const current = useRef(fitted());
  const [view, setView] = useState(fitted);

  function update(next) {
    const rect = viewport.current.getBoundingClientRect();
    const scale = Math.max(1, Math.min(8, next.scale));
    const width = image.current.naturalWidth || rect.width;
    const height = image.current.naturalHeight || rect.height;
    const fit = Math.min(rect.width / width, rect.height / height) || 1;
    current.current = {
      scale,
      x: clamp(next.x, Math.max(0, (width * fit * scale - rect.width) / 2)),
      y: clamp(next.y, Math.max(0, (height * fit * scale - rect.height) / 2)),
    };
    setView(current.current);
  }
  function reset() {
    pointers.current.clear();
    current.current = fitted();
    setView(current.current);
  }
  useEffect(() => {
    reset();
    const observer = new ResizeObserver(reset);
    observer.observe(viewport.current);
    return () => { observer.disconnect(); pointers.current.clear(); };
  }, [src]);

  function geometry() {
    const [first, second = first] = [...pointers.current.values()];
    const rect = viewport.current.getBoundingClientRect();
    return {
      x: (first.x + second.x) / 2 - rect.left - rect.width / 2,
      y: (first.y + second.y) / 2 - rect.top - rect.height / 2,
      distance: Math.hypot(first.x - second.x, first.y - second.y),
    };
  }
  function down(event) {
    if (event.button !== 0 || pointers.current.size >= 2) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event) {
    if (!pointers.current.has(event.pointerId)) return;
    const before = geometry();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const after = geometry(), previous = current.current;
    const scale = before.distance > 0 && after.distance > 0
      ? Math.max(1, Math.min(8, previous.scale * after.distance / before.distance))
      : previous.scale;
    const ratio = scale / previous.scale;
    // Keep the image point beneath the fingers fixed as their midpoint moves.
    update({ scale, x: after.x - (before.x - previous.x) * ratio, y: after.y - (before.y - previous.y) * ratio });
  }
  function up(event) { pointers.current.delete(event.pointerId); }
  function zoom(factor) { update({ ...current.current, scale: current.current.scale * factor }); }

  return <div className="image-zoom">
    <div ref={viewport} className="image-zoom-viewport" aria-label="Zoomable image"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}>
      <img ref={image} src={src} alt={alt} draggable={false} onLoad={reset}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
    </div>
    <div className="image-zoom-controls" role="group" aria-label="Image zoom controls">
      <button type="button" aria-label="Zoom out" disabled={view.scale <= 1} onClick={() => zoom(0.5)}>−</button>
      <output aria-label="Image zoom">{Math.round(view.scale * 100)}%</output>
      <button type="button" aria-label="Zoom in" disabled={view.scale >= 8} onClick={() => zoom(2)}>＋</button>
      <button type="button" onClick={reset}>Fit</button>
    </div>
    <p className="muted">Pinch to zoom · Drag to move</p>
  </div>;
}

export default function FullImage({ item, onClose }) {
  const dialog = useRef(null);
  const [file, setFile] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { dialog.current.showModal(); }, []);
  async function share() {
    setBusy(true); setError("");
    try { if (file) await sharePreparedImage(file); else setFile(await prepareImageShare(item)); }
    catch (failure) { if (failure.name !== "AbortError") setError(failure.message); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="viewer" aria-label={item.name} onCancel={onClose}>
    <div className="row"><h2>{item.name}</h2><button autoFocus onClick={onClose} aria-label="Close image">✕</button></div>
    <ZoomableImage key={item.url} src={mediaUrl(item.url)} alt={item.name} />
    <div className="row"><a className="button primary" href={mediaUrl(item.url, true)} download={item.name}>Download original</a><button disabled={busy} onClick={share}>{busy ? "Preparing…" : file ? "Share image" : "Prepare to share"}</button></div>
    {file && <p className="muted">Original ready. Tap Share image to choose an app.</p>}
    {error && <p role="alert" className="error">{error}</p>}
    <p className="muted">Original desktop file · full resolution</p>
  </dialog>;
}
