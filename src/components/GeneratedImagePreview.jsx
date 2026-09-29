import ProtectedImage from "../ImagePrivacy";
import { useState } from "react";

export default function GeneratedImagePreview({ src, alt, className = "", onLoad, onOpen }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const imageSrc = attempt ? `${src}${src.includes('?') ? '&' : '?'}preview_retry=${attempt}` : src;
  function zoomAtPointer(event) {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    const frame = event.currentTarget, image = frame.querySelector("img");
    if (!image?.naturalWidth) return;
    const bounds = frame.getBoundingClientRect();
    const percent = (position, offset, size) => `${Math.max(0, Math.min(100, (position - offset) / size * 100))}%`;
    frame.style.setProperty("--zoom-x", percent(event.clientX - bounds.left, image.offsetLeft, image.offsetWidth));
    frame.style.setProperty("--zoom-y", percent(event.clientY - bounds.top, image.offsetTop, image.offsetHeight));
    frame.dataset.zoomed = "true";
  }
  if (failed) return <div className={`generated-image-preview ${className}`}>
    <div className="generated-image-preview-error" role="alert">
      <p>Preview could not load. Your saved image is still available.</p>
      <button type="button" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Retry preview</button>
    </div>
  </div>;
  const Frame = onOpen ? 'button' : 'div';
  return <Frame className={`generated-image-preview ${className}`} type={onOpen ? 'button' : undefined} tabIndex={0}
    onClick={onOpen} aria-label={onOpen ? `View ${alt}` : `${alt}. Hover or focus to zoom`} title={onOpen ? 'Click to enlarge · Hover to zoom' : 'Hover to zoom'}
    onPointerEnter={zoomAtPointer} onPointerMove={zoomAtPointer}
    onPointerLeave={event => { delete event.currentTarget.dataset.zoomed; }}>
    <ProtectedImage src={imageSrc} alt={alt} draggable={false} onLoad={onLoad} onError={() => setFailed(true)} />
  </Frame>;
}
