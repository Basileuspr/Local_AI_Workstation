import { apiUrl } from './api';

export const IMAGE_PAGE_SIZES = [24, 48, 96, 192, 500, 1000];
const PAGE_SIZE_KEY = 'local-ai-workstation-image-manager-page-size-v1';
export const imagePageSize = value => IMAGE_PAGE_SIZES.includes(Number(value)) ? Number(value) : 48;
export function loadImagePageSize() {
  try { return imagePageSize(localStorage.getItem(PAGE_SIZE_KEY)); } catch { return 48; }
}
export function saveImagePageSize(value) {
  try { localStorage.setItem(PAGE_SIZE_KEY, String(imagePageSize(value))); } catch {}
}
const DENSITY_KEY = 'local-ai-workstation-image-manager-density-v1';
export const imageDensity = value => ['comfortable', 'compact', 'extra-comfortable'].includes(value) ? value : 'comfortable';
export function loadImageDensity() {
  try { return imageDensity(localStorage.getItem(DENSITY_KEY)); } catch { return 'comfortable'; }
}
export function saveImageDensity(value) {
  try { localStorage.setItem(DENSITY_KEY, imageDensity(value)); } catch {}
}

export async function request(path = '/state', method = 'GET', body, signal) {
  const response = await fetch(apiUrl(`/image-manager${path}`), { method, cache: 'no-store', signal,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof value.detail === 'string' ? value.detail : `Image Manager request failed (${response.status}).`);
  return value;
}
export const imageUrl = (image, large = false) => apiUrl(`/image-manager/images/${image.id}/thumbnail?${new URLSearchParams({ large, v: (image.signature || []).join('-') })}`);
export const originalImage = image => ({ ...image, name: image.relative.split(/[\\/]/).pop(), url: apiUrl(`/image-manager/images/${image.id}/file`) });
export const task = (kind, body = {}) => request('/tasks', 'POST', { kind, ...body });
export const confirmationFor = plan => plan ? `${plan.mode.toUpperCase()} ${plan.entries.length}` : '';
export function updateImageFilters(current, key, value) {
  return { ...current, [key]: value, ...(key === 'tag' && value ? { hide_tagged: false } : {}),
    ...(key === 'hide_tagged' && value ? { tag: '', tagged_only: false } : {}),
    ...(key === 'tagged_only' && value ? { hide_tagged: false } : {}) };
}
export const imageVisibility = (filters, view) => view === 'hidden' ? 'hidden' : filters.tagged_only ? 'all' : 'visible';
export const imageSteps = { scan: 'Scan selected folders', duplicates: 'Find exact duplicates', plan: 'Prepare organization plan', 'duplicate-plan': 'Prepare duplicate-folder plan', report: 'Save catalog / results report' };
export function toggleImageSelection(selected, id) { return selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id].slice(0, 1000); }
export function bytesLabel(bytes) { return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GiB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`; }
