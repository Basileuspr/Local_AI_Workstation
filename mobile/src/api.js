import {clientVersion} from './clientVersion';
export const finished = status => ["completed", "failed", "cancelled", "interrupted"].includes(status);

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function request(path, { method = "GET", body, signal, timeout = 25000 } = {}) {
  if (!path.startsWith("/api/") || path.includes("..")) throw new Error("Invalid companion API path");
  const controller = new AbortController(); let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  try {
  const response = await fetch(path, {
    method, credentials: "same-origin", cache: "no-store", signal: controller.signal,
    headers: { "X-LAW-Mobile": "1", ...(clientVersion ? {'X-LAW-Client-Version': clientVersion} : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new window.Event('law-auth-lost'));
    const value = await response.json().catch(() => ({}));
    const detail = value.detail;
    throw new ApiError(typeof detail === "string" ? detail : detail?.message || `Request failed (${response.status})`, response.status);
  }
  return response.status === 204 ? null : await response.json();
  } catch (error) {
    if (timedOut) throw new ApiError("Desktop did not respond. Reconnect and retry the same submission if delivery is unconfirmed.", 0);
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

// The original ID and payload stay together through lost acknowledgments. A
// caller must resolve or explicitly discard this receipt before another send.
export function submission(payload, id = crypto.randomUUID()) {
  const body = structuredClone(payload);
  return { id, body, send: () => request(`/api/jobs/${id}`, { method: "PUT", body }) };
}

export function observeJob(id, onJob, onError, EventSourceClass = globalThis.EventSource) {
  let closed = false;
  const source = new EventSourceClass(`/api/jobs/${encodeURIComponent(id)}/events`);
  source.onmessage = event => {
    if (closed) return;
    try {
      const job = JSON.parse(event.data);
      onJob(job);
      if (finished(job.status)) { closed = true; source.close(); }
    } catch (error) { onError(error); }
  };
  source.onerror = () => { if (!closed) onError(new Error("Connection lost. Reconnecting to the same desktop job…")); };
  return () => { closed = true; source.close(); };
}

export function mediaUrl(value, download = false) {
  if (typeof value !== "string" || !/^\/api\/media\/(session|library)\/[A-Za-z0-9_\/-]+$/.test(value)) return "";
  return value + (download ? "?download=true" : "");
}

export async function prepareImageShare(item) {
  const url = mediaUrl(item.url, true);
  if (!url) throw new Error("This image is unavailable.");
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("The original image could not be retrieved. Reconnect and try again.");
  const blob = await response.blob();
  const file = new File([blob], item.name || "workstation-image.png", { type: blob.type });
  if (!navigator.canShare?.({ files: [file] })) throw new Error("File sharing is unavailable in this browser. Use Download original, then share from your phone's files.");
  return file;
}

export function sharePreparedImage(file) {
  // Called directly by a second tap, preserving browser user activation even
  // when downloading a large original took longer than the gesture timeout.
  return navigator.share({ files: [file], title: file.name });
}
