import { apiUrl } from './api';

export const harnesses = [
  { id: 'coding', name: 'Coding', description: 'Plan source edits, run project checks, and review the diff.' },
  { id: 'research', name: 'Research & Knowledge', description: 'Research public sources, check citations, and save selected evidence.' },
  { id: 'media', name: 'Media Librarian', description: 'Review metadata suggestions and organize registered media.' },
];
export const harnessName = id => harnesses.find(item => item.id === id)?.name || id;
export const activeCoordinatorRun = run => ['queued', 'running', 'applying'].includes(run?.status);
export function loadCoordinatorDraft(key, defaults) {
  try {
    const saved = JSON.parse(localStorage.getItem(`law-coordinator-${key}-v1`));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return defaults;
    return Object.fromEntries(Object.entries(defaults).map(([name, fallback]) => [name,
      Array.isArray(fallback) ? (Array.isArray(saved[name]) && saved[name].every(item => typeof item === 'string') ? saved[name].slice(0, 24) : fallback)
        : typeof saved[name] === typeof fallback ? saved[name] : fallback]));
  }
  catch { return defaults; }
}
export function saveCoordinatorDraft(key, value) {
  try { localStorage.setItem(`law-coordinator-${key}-v1`, JSON.stringify(value)); return true; }
  catch { return false; }
}
export async function coordinatorRequest(path, body, signal) {
  const response = await fetch(apiUrl(path), { signal, ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw Error(typeof value.detail === 'string' ? value.detail : 'Coordinator request failed. Review the selected inputs.');
  return value;
}
export const sourceUrl = value => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; } };
