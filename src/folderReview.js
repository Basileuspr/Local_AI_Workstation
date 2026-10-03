import { apiUrl } from './api';

export const folderReviewDefaults = { recursive: true, max_entries: 2000, max_bytes: 16 * 1024 * 1024, max_chars: 200000, batch_chars: 4000 };
export const folderReviewRunning = status => ['running', 'cancelling'].includes(status);
export function folderReviewModels(models = []) {
  return [...new Set((Array.isArray(models) ? models : []).map(model => typeof model === 'string' ? model : model?.name).filter(name => typeof name === 'string' && name))];
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const warnings = value => value === undefined || (Array.isArray(value) && value.every(item => typeof item === 'string'));
const processing = value => value === undefined || (object(value) &&
  ['context_limit', 'text_batches_total', 'text_batches_completed', 'compactions', 'offload_preparations', 'provider_retries'].every(name => value[name] === undefined || count(value[name])) &&
  ['model_released', 'model_release_deferred'].every(name => value[name] === undefined || typeof value[name] === 'boolean') &&
  (value.model_release_error === undefined || typeof value.model_release_error === 'string'));
const review = value => object(value) && typeof value.id === 'string' && /^[a-f0-9]{32}$/.test(value.id) &&
  ['running', 'cancelling', 'completed', 'completed_with_gaps', 'cancelled', 'interrupted', 'failed'].includes(value.status) &&
  ['root', 'phase', 'started_at'].every(name => typeof value[name] === 'string') &&
  ['total', 'processed', 'batch', 'batches'].every(name => count(value[name])) &&
  ['current_path', 'error'].every(name => value[name] === undefined || typeof value[name] === 'string') && processing(value.processing) && warnings(value.data_warnings);

export function folderReviewResponse(path, data) {
  let valid = object(data);
  if (path === '/status') valid = valid && Array.isArray(data.reviews) && data.reviews.every(review) &&
    (data.active === null || (typeof data.active === 'string' && /^[a-f0-9]{32}$/.test(data.active)));
  else if (/\/files(?:\?|$)/.test(path)) valid = valid && count(data.total) && count(data.offset) && Array.isArray(data.items) && data.items.every(item =>
    object(item) && count(item.ordinal) && ['path', 'kind', 'status', 'analysis', 'error'].every(name => typeof item[name] === 'string') && object(item.metadata) && object(item.coverage) &&
    (item.coverage.reason === undefined || typeof item.coverage.reason === 'string') &&
    ['batches_total', 'batches_completed'].every(name => item.coverage[name] === undefined || count(item.coverage[name])) && warnings(item.data_warnings));
  else valid = valid && review(data) && (data.report === undefined || typeof data.report === 'string');
  if (!valid) throw Error('Folder Review returned an invalid response. Refresh results to recover the saved review.');
  return data;
}
export async function folderReviewRequest(path, { body, signal } = {}) {
  const response = await fetch(apiUrl('/folder-review' + path), {
    method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(typeof data.detail === 'string' ? data.detail : 'Folder Review could not complete the request. Check the folder and limits.');
  return folderReviewResponse(path, data);
}
export const folderReviewExport = id => apiUrl(`/folder-review/reviews/${encodeURIComponent(id)}/export`);
