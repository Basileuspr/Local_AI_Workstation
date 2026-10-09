import { useEffect, useRef, useState } from 'react';
import { dragBox } from '../characterParts';

export default function ImageCropOverlay({ imageRef, box, onChange, disabled }) {
  const overlay = useRef(null), drag = useRef(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  useEffect(() => {
    const image = imageRef.current, svg = overlay.current, stage = image.parentElement;
    const measure = () => {
      const imageRect = image.getBoundingClientRect(), stageRect = stage.getBoundingClientRect();
      const scale = Math.min(imageRect.width / image.naturalWidth, imageRect.height / image.naturalHeight);
      const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
      if (!width || !height) return;
      Object.assign(svg.style, {
        left: `${imageRect.left - stageRect.left + stage.scrollLeft - stage.clientLeft + (imageRect.width - width) / 2}px`,
        top: `${imageRect.top - stageRect.top + stage.scrollTop - stage.clientTop + (imageRect.height - height) / 2}px`,
        width: `${width}px`, height: `${height}px`,
      });
      setSize({ width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(image); observer.observe(stage);
    image.addEventListener('load', measure);
    return () => { observer.disconnect(); image.removeEventListener('load', measure); };
  }, [imageRef]);
  function point(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
  }
  function move(event) {
    if (!drag.current || disabled) return;
    const { start, before, handle } = drag.current, next = point(event);
    if (handle === 'move') {
      const dx = Math.max(-before[0], Math.min(1 - before[2], next[0] - start[0]));
      const dy = Math.max(-before[1], Math.min(1 - before[3], next[1] - start[1]));
      onChange([before[0] + dx, before[1] + dy, before[2] + dx, before[3] + dy]);
    } else {
      const anchor = handle ? [before[handle.includes('w') ? 2 : 0], before[handle.includes('n') ? 3 : 1]] : start;
      onChange(dragBox(anchor, next));
    }
  }
  const [left, top, right, bottom] = box;
  const handleWidth = 14 / size.width, handleHeight = 14 / size.height;
  return <svg ref={overlay} className="ie-crop-overlay" viewBox="0 0 1 1" preserveAspectRatio="none" role="img" aria-label="Crop selection. Drag to draw, move the selection, or resize its corners. Use the crop pixel fields for keyboard editing."
    onPointerDown={event => {
      if (disabled || event.button !== 0) return;
      event.preventDefault();
      drag.current = { start: point(event), before: box, handle: event.target.dataset.handle };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={move}
    onPointerUp={event => { if (!drag.current) return; move(event); drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { if (drag.current) onChange(drag.current.before); drag.current = null; }}>
    <rect width="1" height="1" fill="transparent" />
    <path d={`M0 0H1V1H0Z M${left} ${top}V${bottom}H${right}V${top}Z`} fill="#0008" fillRule="evenodd" pointerEvents="none" />
    <rect data-handle="move" className="ie-crop-selection" x={left} y={top} width={right - left} height={bottom - top} vectorEffect="non-scaling-stroke" />
    {[[left, top, 'nw'], [right, top, 'ne'], [left, bottom, 'sw'], [right, bottom, 'se']].map(([x, y, handle]) => <rect key={handle} data-handle={handle} className={`ie-crop-handle ie-crop-${handle}`} x={x - handleWidth / 2} y={y - handleHeight / 2} width={handleWidth} height={handleHeight} vectorEffect="non-scaling-stroke" />)}
  </svg>;
}
