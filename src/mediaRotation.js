import { useMemo, useSyncExternalStore } from "react";

const event = "image-view-rotation";
export function rotationKey(src = "") {
  if (/^(data:|blob:)/.test(src)) {
    let hash = 2166136261;
    for (let i = 0; i < src.length; i++) hash = Math.imul(hash ^ src.charCodeAt(i), 16777619);
    return `inline-${src.length}-${hash >>> 0}`;
  }
  try { return new URL(src, "http://local").pathname; } catch { return src; }
}
const read = key => { try { const value = Number(localStorage.getItem(`image-rotation:${key}`)); return [0, 90, 180, 270].includes(value) ? value : 0; } catch { return 0; } };
export function getRotation(src) { return read(rotationKey(src)); }
export function rotateImage(src, direction = 1) {
  localStorage.setItem(`image-rotation:${rotationKey(src)}`, String((getRotation(src) + direction * 90 + 360) % 360));
  window.dispatchEvent(new Event(event));
}
const subscribe = listener => { window.addEventListener(event, listener); window.addEventListener("storage", listener); return () => { window.removeEventListener(event, listener); window.removeEventListener("storage", listener); }; };
export function useRotation(src) { const key = useMemo(() => rotationKey(src), [src]); return useSyncExternalStore(subscribe, () => read(key), () => 0); }
