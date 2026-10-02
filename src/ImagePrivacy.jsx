import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import * as library from "./imageLibraryApi";
import { useRotation } from "./mediaRotation";
import { createImagePrivacyLoader } from "./imagePrivacyLoader";
import { imagePreviewUrl } from "./imageSources";

const Context = createContext({ ready: true, hashes: [], revision: 0 });
export function useImagePrivacy() { return useContext(Context); }
export function ImagePrivacyProvider({ children }) {
  const [privacy, setPrivacy] = useState({ ready: false, hashes: [], revision: 0 });
  const loaderRef = useRef(null);
  const retry = useCallback(() => loaderRef.current?.refresh(), []);
  useEffect(() => {
    const loader = createImagePrivacyLoader({
      read: signal => library.request("/vault/status", "GET", undefined, undefined, { signal }),
      publish: next => setPrivacy(value => ({ ...value, ...next, revision: value.revision + (next.ready ? 1 : 0) })),
    });
    loaderRef.current = loader;
    const refresh = () => loader.refresh();
    const visible = () => { if (!document.hidden) refresh(); };
    const storage = event => { if (event.key === "image-library-revision") refresh(); };
    refresh();
    window.addEventListener("image-library-changed", refresh);
    window.addEventListener("storage", storage);
    window.addEventListener("online", refresh);
    window.addEventListener("image-thumbnails-retry", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => { loader.dispose(); loaderRef.current = null; window.removeEventListener("image-library-changed", refresh); window.removeEventListener("storage", storage); window.removeEventListener("online", refresh); window.removeEventListener("image-thumbnails-retry", refresh); document.removeEventListener("visibilitychange", visible); };
  }, []);
  return <Context.Provider value={{ ...privacy, retry }}>{children}</Context.Provider>;
}

export default function ProtectedImage({ src, alt, rotateView = true, ...props }) {
  const storedRotation = useRotation(src), rotation = rotateView ? storedRotation : 0;
  const imageRef = useRef(null);
  const privacy = useContext(Context);
  const inline = /^(data:|blob:)/.test(src || "");
  const [digest, setDigest] = useState(null);
  const [digestAttempt, setDigestAttempt] = useState(0);
  const errorCallback = useRef(props.onError);
  errorCallback.current = props.onError;
  useEffect(() => {
    if (!inline) return;
    const retry = () => setDigestAttempt(value => value + 1);
    window.addEventListener("image-thumbnails-retry", retry);
    return () => window.removeEventListener("image-thumbnails-retry", retry);
  }, [inline]);
  useEffect(() => {
    const node = imageRef.current;
    if (!node || !rotation) return;
    const fit = () => {
      const parent = node.parentElement;
      const scale = rotation % 180 && node.offsetWidth && node.offsetHeight ? Math.min(1, parent.clientWidth / node.offsetHeight, parent.clientHeight / node.offsetWidth) : 1;
      node.style.transform = `rotate(${rotation}deg) scale(${scale})`;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(node); observer.observe(node.parentElement); fit();
    return () => observer.disconnect();
  }, [src, rotation, privacy.ready, privacy.revision, digest]);
  useEffect(() => {
    if (!inline) return;
    let ignore = false;
    setDigest(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    fetch(src, { signal: controller.signal }).then(response => { if (!response.ok) throw new Error("Image unavailable"); return response.arrayBuffer(); }).then(bytes => crypto.subtle.digest("SHA-256", bytes))
      .then(hash => { if (!ignore) setDigest({ src, hash: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("") }); }).catch(() => { if (!ignore) { setDigest({ src, error: true }); errorCallback.current?.({ currentTarget: imageRef.current }); } }).finally(() => clearTimeout(timer));
    return () => { ignore = true; controller.abort(); clearTimeout(timer); };
  }, [src, inline, digestAttempt]);
  if (inline && digest?.src === src && digest.error) return <span className="image-privacy-placeholder" role="status">Preview unavailable · Reload thumbnails to retry</span>;
  if (!privacy.ready || (inline && digest?.src !== src)) return <span className="image-privacy-placeholder" role="status" aria-label={privacy.error || "Checking image access"}>{privacy.error ? "Image access unavailable · Reload thumbnails to retry" : "Checking image access…"}</span>;
  if (inline && privacy.hashes.includes(digest.hash)) return <span className="image-privacy-placeholder">🔒 Locked image</span>;
  const url = imagePreviewUrl(src, { privacy: privacy.revision });
  return <img key={url} ref={imageRef} {...props} style={{ ...props.style, transform: rotation ? `rotate(${rotation}deg)` : props.style?.transform }} src={url} alt={alt} />;
}
