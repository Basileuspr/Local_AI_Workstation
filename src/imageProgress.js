export function activeImageRequests(requests, jobs, finishedIds = []) {
  const finished = new Set(finishedIds);
  const active = jobs.filter(job => job.kind === "image" && ["queued", "running", "cancelling"].includes(job.status));
  const byId = new Map(requests.filter(request => !finished.has(request.id)).map(request => [request.id, request]));
  for (const job of active) {
    if (finished.has(job.request_id)) continue;
    const request = byId.get(job.request_id);
    byId.set(job.request_id, { id: job.request_id, prompt: job.label,
      status: job.stage === 'saving' ? 'saving' : job.status, position: job.position,
      ...request });
  }
  const priority = status => ({running:3,cancelling:3,saving:2,queued:1}[status] || 0);
  return [...byId.values()].sort((a, b) => priority(b.status) - priority(a.status));
}

export function imageRemainingSeconds(progress, elapsed) {
  if (!progress || !(progress.step > 0) || !(progress.total_steps > progress.step)) return null;
  if (Number.isFinite(progress.estimated_remaining_seconds)) {
    const sinceReport = Number.isFinite(elapsed) && Number.isFinite(progress.elapsed_seconds) ? Math.max(0, elapsed - progress.elapsed_seconds) : 0;
    return Math.max(0, progress.estimated_remaining_seconds - sinceReport);
  }
  // Compatibility with an already-running backend that has only total timing.
  if (!Number.isFinite(progress.elapsed_seconds) || progress.elapsed_seconds < 0) return null;
  return progress.elapsed_seconds / progress.step * (progress.total_steps - progress.step);
}

export function formatImageEstimate(seconds) {
  if (seconds < 1) return "Re-estimating remaining time…";
  const rounded = Math.ceil(seconds);
  return `Estimated ${rounded >= 60 ? `${Math.floor(rounded / 60)}m ` : ""}${rounded % 60}s remaining`;
}
