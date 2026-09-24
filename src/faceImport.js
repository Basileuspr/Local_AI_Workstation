const MAX_FILE_BYTES = 20 * 1024 ** 2;
const BATCH_BYTES = 16 * 1024 ** 2;
const BATCH_FILES = 100;
const TERMINAL = new Set(["complete", "error", "cancelled"]);

export function browserFaceSource(input) {
  const files = Array.from(input);
  let index = 0;
  return {
    total: files.length,
    async next() {
      const batch = [], errors = [];
      let bytes = 0, consumed = 0;
      while (index < files.length && consumed < BATCH_FILES) {
        const file = files[index];
        if (file.size > MAX_FILE_BYTES) errors.push({ source: file.name, error: "Images must be at most 20 MiB each." });
        else {
          if (batch.length && bytes + file.size > BATCH_BYTES) break;
          bytes += file.size; batch.push(file);
        }
        index++; consumed++;
      }
      return { files: batch, errors, consumed, done: index === files.length };
    },
    async release() {},
  };
}

export function desktopFaceSource(desktop, choice) {
  return {
    total: choice.total,
    async next() {
      const batch = await desktop.readFaceInputs(choice.ticket);
      if (batch.error) throw new Error(batch.error);
      return { ...batch, files: (batch.files || []).map(file => new File([file.bytes], file.name, { type: file.type, lastModified: file.lastModified })) };
    },
    release: () => desktop.releaseFaceInputs(choice.ticket),
  };
}

function pause(milliseconds, signal) {
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, milliseconds);
    signal?.addEventListener("abort", done, { once: true });
    if (signal?.aborted) done();
  });
}

// Wait for each worker to finish before reading/uploading the next batch.
// The import lives in FaceStudio, which remains mounted across app tabs.
export async function scanFaceBatches({ datasetId, source, api, signal, onProgress, pollInterval = 900, runName = "" }) {
  let processed = 0, found = 0, batchNumber = 0, errorCount = 0, currentRun = null;
  const errors = [];
  const collectErrors = (items = [], count = items.length) => { errors.push(...items.slice(0, 100 - errors.length)); errorCount += count; };
  const report = (status, message, run = null) => {
    const result = { status, message, total: source.total, processed: processed + (run?.processed || 0),
      faces: found + (run?.faces || 0), batch: batchNumber, error_count: errorCount + (run?.error_count ?? run?.errors?.length ?? 0), errors: [...errors, ...(run?.errors || [])].slice(0, 100) };
    onProgress(result);
    return result;
  };
  try {
    while (!signal?.aborted) {
      report("buffering", "Opening the next image batch…");
      if (signal?.aborted) break;
      const batch = await source.next();
      if (batch.canceled || signal?.aborted) break;
      collectErrors(batch.errors);
      processed += batch.consumed - batch.files.length;
      if (batch.files.length) {
        batchNumber++;
        report("uploading", `Sending batch ${batchNumber} (${batch.files.length} images)…`);
        // Do not abort this POST: receiving its run ID lets Stop cancel the
        // exact worker even if it was clicked while the upload was in flight.
        currentRun = await api.uploadImages(datasetId, batch.files, runName ? `${runName.slice(0, 95)} · batch ${batchNumber}` : "");
        let failures = 0;
        while (!TERMINAL.has(currentRun.status)) {
          if (signal?.aborted) {
            report("cancelling", "Stopping the current image; keeping faces already extracted…", currentRun);
            const stopped = (await api.stopRun(datasetId, currentRun.id)).run;
            if (stopped) currentRun = stopped;
            break;
          }
          report(currentRun.status, currentRun.message, currentRun);
          await pause(pollInterval, signal);
          if (signal?.aborted) continue;
          try {
            const next = (await api.getRun(datasetId)).run;
            if (!next || next.id !== currentRun.id) throw new Error("The active face scan changed. The remaining batches were stopped.");
            currentRun = next; failures = 0;
          } catch (error) {
            if (++failures >= 3) throw error;
            report("reconnecting", "Waiting to reconnect to the current face scan…", currentRun);
          }
        }
        processed += currentRun.processed || 0;
        found += currentRun.faces || 0;
        collectErrors(currentRun.errors, currentRun.error_count ?? currentRun.errors?.length ?? 0);
        const finished = currentRun;
        currentRun = null;
        if (finished.status === "error") throw new Error(finished.message || "The face scan failed.");
        if (finished.status === "cancelled" || signal?.aborted) break;
      }
      if (batch.done) return report("complete", `${found} faces from ${processed} images${errorCount ? `; ${errorCount} image(s) could not be scanned` : ""}.`);
    }
    return report("cancelled", `Stopped after ${processed} of ${source.total} images. Extracted faces were kept.`);
  } catch (error) {
    if (currentRun && !TERMINAL.has(currentRun.status)) {
      try { await api.stopRun(datasetId, currentRun.id); } catch { /* The UI refreshes worker status so Stop remains available. */ }
    }
    report("error", error.message, currentRun);
    throw error;
  } finally {
    await source.release();
  }
}
