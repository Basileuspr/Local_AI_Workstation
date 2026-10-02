import { apiUrl } from './api';

export const folderReviewDefaults = { recursive: true, max_entries: 2000, max_bytes: 16 * 1024 * 1024, max_chars: 200000, batch_chars: 4000 };
export const folderReviewRunning = status => ['running', 'cancelling'].includes(status);
export function folderReviewModels(models = []) {
  return [...new Set(models.map(model => typeof model === 'string' ? model : model.name).filter(Boolean))];
}
export async function folderReviewRequest(path, { body, signal } = {}) {
  const response = await fetch(apiUrl('/folder-review' + path), {
    method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    signal: signal || AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(typeof data.detail === 'string' ? data.detail : 'Folder Review could not complete the request. Check the folder and limits.');
  return data;
}
export const folderReviewExport = id => apiUrl(`/folder-review/reviews/${encodeURIComponent(id)}/export`);
