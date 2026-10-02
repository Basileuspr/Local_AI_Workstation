export const pendingJob = job => ["queued", "running", "cancelling", "saving"].includes(job?.status);
export const pendingQueue = data => Boolean(data?.jobs?.some(pendingJob));
export const pendingImages = data => Boolean(data?.tasks?.some(pendingJob));
export const busyRuntime = data => Boolean(data?.gpu_owner || data?.active_chat_requests || data?.image?.generating || data?.workflow?.running);
const backoff = failures => Math.min(30000, 2000 * 2 ** Math.min(4, Math.max(0, failures - 1)));
export function inventoryDelay(kind, data, { failures = 0, idleCount = 1 } = {}) {
  if (failures) return backoff(failures);
  if ((kind === "queue" ? pendingQueue : pendingImages)(data)) return kind === "queue" ? 750 : 1000;
  const steps = kind === "queue" ? [2000, 5000, 10000, 30000] : [1000, 5000, 10000, 30000];
  return steps[Math.min(3, Math.max(0, idleCount - 1))];
}
export function runtimeDelay(data, { failures = 0, hidden = false } = {}) {
  return failures ? backoff(failures) : busyRuntime(data) ? 3000 : hidden ? 30000 : 15000;
}
export function serviceDelay(data, { hidden = false, failures = 0 } = {}) {
  return failures ? backoff(failures) : !data?.backend?.ok || !data?.ollama?.reachable ? 5000 : hidden ? 60000 : 30000;
}
