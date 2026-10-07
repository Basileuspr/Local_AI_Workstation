// Observation requests only. Disposing a subscription never stops backend work.
export function createPollingObserver({ read, interval, active = () => false, timeout = 12000,
  setTimer = setTimeout, clearTimer = clearTimeout, document: page = globalThis.document,
  window: host = globalThis.window } = {}) {
  const listeners = new Set();
  let timer, controller, running = false, dirty = false, epoch = 0;
  let value, etag, hasValue = false, failures = 0, idleCount = 0;
  const context = () => ({ failures, idleCount, hidden: Boolean(page?.hidden) });
  function schedule(delay) {
    clearTimer(timer);
    if (listeners.size && delay !== null) timer = setTimer(run, Math.max(0, delay));
  }
  function emit(kind, data) {
    for (const listener of listeners) {
      try { listener[kind]?.(data); }
      catch (error) { host?.reportError?.(error); }
    }
  }
  async function run() {
    if (!listeners.size || running || interval(value, context()) === null) return;
    clearTimer(timer); running = true; dirty = false;
    const started = epoch;
    controller = new AbortController();
    const deadline = setTimer(() => controller.abort(), timeout);
    try {
      const next = await read({ signal: controller.signal, value, etag });
      if (!listeners.size || started !== epoch || dirty) return;
      if (!next.unchanged) { value = next.value; etag = next.etag; hasValue = true; }
      failures = 0; idleCount = active(value) ? 0 : idleCount + 1;
      // Active clocks and reconnect notices must refresh even on a 304.
      if (!next.unchanged || active(value)) emit("data", value);
      else emit("recovered", value);
    } catch (error) {
      if (listeners.size && started === epoch && !dirty) { failures++; emit("error", error); }
    } finally {
      clearTimer(deadline); controller = null; running = false;
      if (listeners.size) schedule(dirty ? 0 : interval(value, context()));
    }
  }
  function invalidate() {
    idleCount = 0; etag = undefined;
    if (running) dirty = true;
    else schedule(0);
  }
  function visibility() {
    if (!page?.hidden) invalidate();
    else if (!running) schedule(interval(value, context()));
  }
  return {
    invalidate,
    getSnapshot: () => hasValue ? value : undefined,
    subscribe(listener) {
      const first = !listeners.size;
      listeners.add(listener);
      if (hasValue) listener.data?.(value);
      if (first) {
        page?.addEventListener("visibilitychange", visibility);
        host?.addEventListener("online", invalidate);
        host?.addEventListener("focus", invalidate);
        invalidate();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          epoch++; dirty = false; clearTimer(timer); controller?.abort();
          page?.removeEventListener("visibilitychange", visibility);
          host?.removeEventListener("online", invalidate);
          host?.removeEventListener("focus", invalidate);
        }
      };
    },
    get subscriberCount() { return listeners.size; },
  };
}

export async function readPollingJson(url, { signal, value, etag } = {}) {
  const response = await fetch(url, { signal, cache: "no-store", headers: etag ? { "If-None-Match": etag } : {} });
  if (response.status === 304 && value !== undefined) return { unchanged: true };
  if (!response.ok) throw new Error(`Could not refresh status (${response.status}).`);
  return { value: await response.json(), etag: response.headers?.get("etag") || undefined };
}

const observers = new Map();
export function sharedPollingObserver(key, options) {
  if (!observers.has(key)) observers.set(key, createPollingObserver(options));
  // Bound detached per-task observers; never evict a live subscription.
  if (observers.size > 128) for (const [name, observer] of observers) {
    if (name !== key && !observer.subscriberCount) observers.delete(name);
    if (observers.size <= 128) break;
  }
  return observers.get(key);
}
export function invalidatePolling(...prefixes) {
  for (const [key, observer] of observers) if (prefixes.some(prefix => key === prefix || key.startsWith(prefix + ":"))) observer.invalidate();
}

export async function fetchWorkload(url, options) {
  invalidatePolling("queue", "image-tasks", "runtime", "status");
  try { return await fetch(url, options); }
  finally { invalidatePolling("queue", "image-tasks", "runtime", "status"); }
}
