import ProtectedImage from "../ImagePrivacy";
import { useState } from "react";
import { imagePreviewUrl } from "../imageSources";

function Preview({ src, alt, className = "", onLoad, onOpen }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const imageSrc = imagePreviewUrl(src, { retry: attempt });
  if (failed) return <div className={`generated-image-preview ${className}`}>
    <div className="generated-image-preview-error" role="alert">
      <p>Preview could not load. Your saved image is still available.</p>
      <button type="button" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Retry preview</button>
    </div>
  </div>;
  const Frame = onOpen ? 'button' : 'div';
  return <Frame className={`generated-image-preview ${className}`} type={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined}
    onClick={onOpen} aria-label={onOpen ? `View ${alt}` : alt} title={onOpen ? 'Click to enlarge' : undefined}>
    <ProtectedImage key={attempt} src={imageSrc} alt={alt} draggable={false} onLoad={onLoad} onError={() => setFailed(true)} />
  </Frame>;
}
export default function GeneratedImagePreview(props) { return <Preview key={props.src} {...props} />; }
