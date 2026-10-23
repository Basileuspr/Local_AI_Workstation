import { NO_IMAGE_FOLDER } from './imageManagerApi';

export const IMAGE_MANAGER_VIEW_KEY = 'local-ai-workstation-image-manager-view-v1';
export const emptyImageFilters = { search: '', folder_id: NO_IMAGE_FOLDER, tag: '', format: '', month: '', favorite: false, hide_tagged: false, tagged_only: false, duplicates: false, digest: '', sort: 'date' };
const views = ['library', 'duplicates', 'hidden', 'organize', 'functions', 'history', 'trash'];
const folderId = value => typeof value === 'string' && value.length <= 128;

// Only restore browsing and scan inputs. Image selections, dialogs and file
// operations still require a fresh, explicit choice after reloading.
export function imageManagerView(value) {
  const filters = { ...emptyImageFilters }, saved = value?.filters;
  for (const [key, limit] of Object.entries({ search: 200, folder_id: 128, tag: 120, format: 32, month: 7, digest: 64 })) {
    if (typeof saved?.[key] === 'string' && saved[key].length <= limit) filters[key] = saved[key];
  }
  for (const key of ['favorite', 'hide_tagged', 'tagged_only', 'duplicates']) filters[key] = saved?.[key] === true;
  if (['date', 'name', 'size', 'dimensions'].includes(saved?.sort)) filters.sort = saved.sort;
  return {
    filters, view: views.includes(value?.view) ? value.view : 'library',
    offset: Number.isSafeInteger(value?.offset) && value.offset >= 0 ? value.offset : 0,
    sourceIds: Array.isArray(value?.sourceIds) ? [...new Set(value.sourceIds.filter(id => folderId(id) && id && id !== NO_IMAGE_FOLDER))].slice(0, 100) : [],
    outputId: folderId(value?.outputId) ? value.outputId : '', recursive: value?.recursive !== false,
  };
}

export function loadImageManagerView() {
  try { return imageManagerView(JSON.parse(sessionStorage.getItem(IMAGE_MANAGER_VIEW_KEY))); }
  catch { return imageManagerView(); }
}

export function saveImageManagerView(value) {
  // Session storage survives refresh, but a new app window starts unpointed.
  try { sessionStorage.setItem(IMAGE_MANAGER_VIEW_KEY, JSON.stringify(imageManagerView(value))); } catch {}
}
