import { useEffect, useState, useRef } from "react";
import ProtectedImage from "../ImagePrivacy";
import { imagePreviewUrl } from "../imageSources";
import "./ImageThumbnail.css";

export function ThumbnailRetryButton() {
  return <button type="button" onClick={() => window.dispatchEvent(new Event("image-thumbnails-retry"))}>Reload thumbnails</button>;
}

function Preview({ src, alt, className, onLoad, onError, ...props }) {
  const [state, setState] = useState("loading"), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const retry = () => { if (state === "error") { setState("loading"); setAttempt(value => value + 1); } };
    window.addEventListener("image-thumbnails-retry", retry);
    return () => window.removeEventListener("image-thumbnails-retry", retry);
  }, [state]);
  const url = imagePreviewUrl(src, { thumbnail: true, retry: attempt });
  return <span className={`image-thumbnail ${className || ""}`} data-preview-state={state}>
    {url && <ProtectedImage key={attempt} {...props} src={url} alt={alt} loading="lazy" decoding="async"
      onLoad={event => { if (event.currentTarget.naturalWidth) setState("ready"); else setState("error"); onLoad?.(event); }}
      onError={event => { setState("error"); onError?.(event); }} />}
    {state !== "ready" && <span className="thumbnail-status" aria-live="polite">{state === "error" || !url ? "Preview unavailable" : "Loading preview…"}</span>}
  </span>;
}

export default function ImageThumbnail(props) { return <Preview key={props.src} {...props} />; }

export function isImageFile(file) { return !!file && (/^image\//.test(file.type) || /\.(png|jpe?g|webp|gif|bmp|tiff?|avif)$/i.test(file.name || "")); }

export function FileImageThumbnail({ file, alt, ...props }) {
  const [source, setSource] = useState(null), [visible, setVisible] = useState(false);
  const slot = useRef(null);
  useEffect(() => {
    if (!isImageFile(file)) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "100px" });
    observer.observe(slot.current);
    return () => observer.disconnect();
  }, [file]);
  useEffect(() => {
    if (!visible || !isImageFile(file)) { setSource(null); return; }
    const url = URL.createObjectURL(file);
    setSource({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file, visible]);
  if (!isImageFile(file)) return null;
  return <span ref={slot} className="file-thumbnail-slot">{visible ? <ImageThumbnail {...props} src={source?.file === file ? source.url : ""} alt={alt || file.name} /> : <span className="thumbnail-status">Image preview</span>}</span>;
}
