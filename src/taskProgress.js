// Progress belongs to a task, not to the tab displaying it. Keep a bounded,
// in-memory snapshot so remounting a view does not restart its clock or bar.
export function createTaskProgressCache({ limit = 128, now = () => performance.now() } = {}) {
  const snapshots = new Map();
  let pollId = 0;

  function save(key, snapshot) {
    snapshots.delete(key);
    snapshots.set(key, snapshot);
    while (snapshots.size > limit) snapshots.delete(snapshots.keys().next().value);
    return snapshot;
  }

  return {
    read: key => snapshots.get(key) || null,
    beginPoll: () => ++pollId,
    record(key, progress, id) {
      const previous = snapshots.get(key);
      if (previous && previous.pollId > id) return previous;
      return save(key, { progress: progress || null, observedAt: now(), pollId: id, unavailable: false });
    },
    markUnavailable(key, id) {
      const previous = snapshots.get(key);
      if (previous && previous.pollId > id) return previous;
      return save(key, { ...previous, pollId: id, unavailable: true });
    },
  };
}

export function taskElapsedSeconds(snapshot, now = performance.now()) {
  const elapsed = snapshot?.progress?.elapsed_seconds;
  if (typeof elapsed !== "number" || !Number.isFinite(elapsed) || elapsed < 0) return null;
  // Interpolate the backend's monotonic clock between reports, including time
  // spent on other tabs. On failure, show only the last confirmed measurement.
  return elapsed + (snapshot.unavailable ? 0 : Math.max(0, now - snapshot.observedAt) / 1000);
}

export const taskProgressCache = createTaskProgressCache();
