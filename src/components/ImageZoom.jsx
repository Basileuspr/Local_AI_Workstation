import { useEffect, useRef, useState } from 'react';
import ProtectedImage from '../ImagePrivacy';
import { useRotation } from '../mediaRotation';
import { fitScale, clampPan, zoomAt } from '../imageZoom';
import './ImageZoom.css';

// Keep the preview for initial fit; zoom requests the original, never enlarged
// thumbnail pixels. The surrounding viewer keys this component by image ID.
export default function ImageZoom({ src, previewSrc, width, height, alt, rotateView = true, onError, imageClassName }) {
  const viewport = useRef(null), drag = useRef(null), wheel = useRef(null);
  const storedRotation = useRotation(src), rotation = rotateView ? storedRotation : 0;
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState({ width: width || 0, height: height || 0 });
  const [zoom, setZoom] = useState(null), [pan, setPan] = useState({ x: 0, y: 0 });
  const [original, setOriginal] = useState(!previewSrc), [loaded, setLoaded] = useState(false);
  const fit = fitScale(natural.width, natural.height, box, rotation), scale = zoom ?? fit;
  const bounded = clampPan(pan, natural.width, natural.height, box, scale, rotation);
  const source = original ? src : previewSrc;
  function change(value, point) {
    const next = Math.max(Math.min(fit, .01), Math.min(32, value));
    if (next > fit || next >= 1) { setOriginal(true); if (!original) setLoaded(false); }
    setPan(clampPan(zoomAt(bounded, scale, next, point), natural.width, natural.height, box, next, rotation));
    setZoom(next);
  }
  function reset() { setZoom(null); setPan({ x: 0, y: 0 }); }
  wheel.current = event => {
    event.preventDefault();
    const rect = viewport.current.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
    change(scale * Math.exp(-Math.max(-200, Math.min(200, delta)) * .006), { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 });
  };
  useEffect(() => {
    const node = viewport.current;
    const measure = () => setBox({ width: node.clientWidth, height: node.clientHeight });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(node); window.addEventListener('resize', measure); measure();
    const listener = event => wheel.current(event);
    node.addEventListener('wheel', listener, { passive: false });
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); node.removeEventListener('wheel', listener); };
  }, []);
  return <div className="image-zoom" onKeyDown={event => {
    if (event.target.matches('input,select,textarea')) return;
    if (['+', '=', '-', '0', '1'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === '0') reset(); else change(event.key === '1' ? 1 : scale * (event.key === '-' ? 1 / 1.4 : 1.4));
    } else if (event.target === viewport.current && scale > fit && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      setPan(clampPan({ x: bounded.x + (event.key === 'ArrowLeft' ? 80 : event.key === 'ArrowRight' ? -80 : 0), y: bounded.y + (event.key === 'ArrowUp' ? 80 : event.key === 'ArrowDown' ? -80 : 0) }, natural.width, natural.height, box, scale, rotation));
    }
  }}>
    <div className="image-zoom-toolbar" aria-label="Image zoom controls">
      <button type="button" aria-label="Zoom out" onClick={() => change(scale / 1.4)}>−</button>
      <output aria-label="Image zoom">{(scale * 100).toFixed(scale < .1 ? 1 : 0)}%</output>
      <button type="button" aria-label="Zoom in" onClick={() => change(scale * 1.4)}>+</button>
      <button type="button" onClick={reset}>Fit</button>
      <button type="button" onClick={() => change(1)}>100%</button>
      <span>Scroll to zoom · Drag to pan</span>
      {original && !loaded && <span role="status">Loading original…</span>}
    </div>
    <div ref={viewport} className="image-zoom-viewport" tabIndex={0} aria-label="Zoomable image. Use plus and minus to zoom, 0 to fit, 1 for actual size."
      onDoubleClick={() => zoom === null ? change(1) : reset()}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, pan: bounded };
      }}
      onPointerMove={event => {
        const start = drag.current; if (!start || start.id !== event.pointerId) return;
        setPan(clampPan({ x: start.pan.x + event.clientX - start.x, y: start.pan.y + event.clientY - start.y }, natural.width, natural.height, box, scale, rotation));
      }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
      <ProtectedImage src={source} alt={alt} className={imageClassName} rotateView={false} draggable={false} onError={onError}
        onLoad={event => {
          const node = event.currentTarget;
          if (original || !natural.width) setNatural({ width: node.naturalWidth, height: node.naturalHeight });
          setLoaded(true);
        }} style={{ width: natural.width || 'auto', height: natural.height || 'auto', transform: `translate(-50%, -50%) translate(${bounded.x}px, ${bounded.y}px) rotate(${rotation}deg) scale(${scale})` }} />
    </div>
  </div>;
}
