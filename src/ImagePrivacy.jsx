import { createContext, useContext, useEffect, useRef, useState } from "react";
import * as library from "./imageLibraryApi";
import { useRotation } from "./mediaRotation";

const Context = createContext({ ready: true, hashes: [], revision: 0 });
export function useImagePrivacy() { return useContext(Context); }
export function ImagePrivacyProvider({ children }) {
  const [privacy, setPrivacy] = useState({ ready: false, hashes: [], revision: 0 });
  useEffect(() => {
    let alive = true, serial = 0;
    const refresh = async () => {
      const current = ++serial;
      // Immediately hide already decoded pixels while changing privacy state.
      setPrivacy(value => ({ ...value, ready: false }));
      try {
        const data = await library.request("/vault/status");
        if (alive && current === serial) setPrivacy(value => ({ ready: true, hashes: data.locked_hashes, revision: value.revision + 1 }));
      } catch { /* Fail closed if the privacy policy cannot be read. */ }
    };
    const storage = event => { if (event.key === "image-library-revision") refresh(); };
    refresh();
    window.addEventListener("image-library-changed", refresh);
    window.addEventListener("storage", storage);
    return () => { alive = false; window.removeEventListener("image-library-changed", refresh); window.removeEventListener("storage", storage); };
  }, []);
  return <Context.Provider value={privacy}>{children}</Context.Provider>;
}

export default function ProtectedImage({ src, alt, rotateView = true, ...props }) {
  const storedRotation = useRotation(src), rotation = rotateView ? storedRotation : 0;
  const imageRef = useRef(null);
  const privacy = useContext(Context);
  const inline = /^(data:|blob:)/.test(src || "");
  const [digest, setDigest] = useState(null);
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
    fetch(src).then(response => response.arrayBuffer()).then(bytes => crypto.subtle.digest("SHA-256", bytes))
      .then(hash => { if (!ignore) setDigest({ src, hash: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("") }); }).catch(() => {});
    return () => { ignore = true; };
  }, [src, inline]);
  if (!privacy.ready || (inline && digest?.src !== src)) return <span className="image-privacy-placeholder" aria-label="Loading image privacy state" />;
  if (inline && privacy.hashes.includes(digest.hash)) return <span className="image-privacy-placeholder">🔒 Locked image</span>;
  const url = !inline && privacy.revision ? `${src}${src.includes("?") ? "&" : "?"}privacy=${privacy.revision}` : src;
  return <img key={url} ref={imageRef} {...props} style={{ ...props.style, transform: rotation ? `rotate(${rotation}deg)` : props.style?.transform }} src={url} alt={alt} />;
}
