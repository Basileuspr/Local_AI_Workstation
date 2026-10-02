export function privacyHashes(value) {
  if (!Array.isArray(value?.locked_hashes) || value.locked_hashes.some(hash => typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash))) throw new Error("Invalid image access response");
  return [...new Set(value.locked_hashes)];
}

// One cancelable request for the entire app, with bounded recovery. Failure
// keeps pixels hidden, but no longer leaves an unexplained permanent blank.
export function createImagePrivacyLoader({ read, publish, timeout = 10000, retryDelays = [1000, 3000, 8000], schedule = setTimeout, unschedule = clearTimeout }) {
  let disposed = false, generation = 0, controller, timer, deadline;
  function clear() { controller?.abort(); unschedule(timer); unschedule(deadline); }
  async function load(attempt, current) {
    if (disposed || current !== generation) return;
    controller = new AbortController();
    const requestController = controller;
    try {
      const expiry = new Promise((_, reject) => { deadline = schedule(() => { requestController.abort(); reject(new Error("Image access request timed out")); }, timeout); });
      const hashes = privacyHashes(await Promise.race([read(requestController.signal), expiry]));
      if (disposed || current !== generation) return;
      publish({ ready: true, hashes, error: "" });
    } catch {
      if (disposed || current !== generation) return;
      publish({ ready: false, error: "Image access check unavailable. Retry to load previews." });
      if (attempt < retryDelays.length) timer = schedule(() => load(attempt + 1, current), retryDelays[attempt]);
    } finally { if (current === generation) unschedule(deadline); }
  }
  return {
    refresh() { if (disposed) return; clear(); const current = ++generation; publish({ ready: false, error: "" }); void load(0, current); },
    dispose() { disposed = true; generation++; clear(); },
  };
}
