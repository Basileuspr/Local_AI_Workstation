export const TIMER_STORAGE_KEY = "local-ai-workstation-timer-v1";
export const MAX_TIMER_DURATION = 24 * 60 * 60 * 1000;
export const DEFAULT_TIMER_DURATION = 5 * 60 * 1000;

export function timerDefaults() {
  return { status: "idle", durationMs: DEFAULT_TIMER_DURATION, remainingMs: DEFAULT_TIMER_DURATION,
    deadline: null, display: "hidden", sound: true, position: null };
}

export function normalizeTimer(saved) {
  const defaults = timerDefaults();
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return defaults;
  const durationMs = Number.isFinite(saved.durationMs) && saved.durationMs >= 1000
    ? Math.min(MAX_TIMER_DURATION, Math.round(saved.durationMs)) : defaults.durationMs;
  const remainingMs = Number.isFinite(saved.remainingMs) ? Math.max(0, Math.min(durationMs, saved.remainingMs)) : durationMs;
  let status = ["idle", "running", "paused", "finished"].includes(saved.status) ? saved.status : "idle";
  const deadline = Number.isFinite(saved.deadline) && saved.deadline > 0 && saved.deadline <= 8.64e15 ? saved.deadline : null;
  if (status === "running" && deadline === null) status = remainingMs > 0 ? "paused" : "finished";
  if (status === "paused" && remainingMs === 0) status = "finished";
  return { durationMs, remainingMs: status === "idle" ? durationMs : status === "finished" ? 0 : remainingMs,
    status, deadline: status === "running" ? deadline : null,
    display: ["panel", "compact", "hidden"].includes(saved.display) ? saved.display : "hidden",
    sound: saved.sound !== false,
    position: Number.isFinite(saved.position?.x) && Number.isFinite(saved.position?.y)
      ? { x: saved.position.x, y: saved.position.y } : null };
}

export function loadTimer(storage) {
  try { return normalizeTimer(JSON.parse((storage ?? globalThis.localStorage)?.getItem(TIMER_STORAGE_KEY) || "null")); }
  catch { return timerDefaults(); }
}
export function saveTimer(timer, storage) {
  try { (storage ?? globalThis.localStorage)?.setItem(TIMER_STORAGE_KEY, JSON.stringify(normalizeTimer(timer))); }
  catch { /* The timer still works if preference storage is unavailable. */ }
}

export function remainingTime(timer, now = Date.now()) {
  return timer.status === "running" ? Math.max(0, Math.min(timer.durationMs, timer.deadline - now)) : timer.remainingMs;
}
export function startTimer(timer, now = Date.now(), durationMs = timer.durationMs) {
  const remainingMs = timer.status === "paused" ? timer.remainingMs : durationMs;
  return { ...timer, durationMs, remainingMs, deadline: now + remainingMs, status: "running" };
}
export function pauseTimer(timer, now = Date.now()) {
  const remainingMs = remainingTime(timer, now);
  return { ...timer, remainingMs, deadline: null, status: remainingMs > 0 ? "paused" : "finished" };
}
export function resetTimer(timer) {
  return { ...timer, remainingMs: timer.durationMs, deadline: null, status: "idle" };
}
export function durationFromFields({ hours, minutes, seconds }) {
  const fields = [hours, minutes, seconds].map(value => value === "" ? 0 : Number(value));
  if (fields.some(value => !Number.isInteger(value) || value < 0) || fields[0] > 24 || fields[1] > 59 || fields[2] > 59) return null;
  const duration = (fields[0] * 3600 + fields[1] * 60 + fields[2]) * 1000;
  return duration >= 1000 && duration <= MAX_TIMER_DURATION ? duration : null;
}
export function durationFields(duration) {
  const seconds = Math.floor(duration / 1000);
  return { hours: String(Math.floor(seconds / 3600)), minutes: String(Math.floor(seconds / 60) % 60), seconds: String(seconds % 60) };
}
export function formatCountdown(duration) {
  const seconds = Math.ceil(Math.max(0, duration) / 1000);
  const parts = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
  return parts.slice(parts[0] ? 0 : 1).map(value => String(value).padStart(2, "0")).join(":");
}

export function clampTimerPosition(position, width, height, viewportWidth, viewportHeight) {
  return { x: Math.max(8, Math.min(position.x, viewportWidth - width - 8)),
    y: Math.max(8, Math.min(position.y, viewportHeight - height - 8)) };
}
