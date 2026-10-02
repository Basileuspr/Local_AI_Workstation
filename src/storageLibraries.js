import { apiUrl } from './api';

async function request(path = '', options = {}) {
  const response = await fetch(apiUrl(`/storage-libraries${path}`), { cache: 'no-store', ...options });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value.detail === 'string' ? value.detail : 'Storage request failed. Check the folder and try again.');
  return value;
}

export const loadStorageLibraries = () => request();
export const addStorageLibrary = values => request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
export const setDefaultStorageLibrary = id => request(`/default/${encodeURIComponent(id)}`, { method: 'PUT' });
export const libraryExportFolder = category => request(`/export-folder/${encodeURIComponent(category)}`, { method: 'POST' });

export async function chooseStorageParent() {
  const choose = window.workstationDesktop?.chooseStorageLibraryParent;
  if (!choose) throw new Error('Paste a full drive or folder path, or use Browse in the desktop app.');
  const result = await choose();
  if (result.error) throw new Error(result.error);
  return result.folder || '';
}

export async function openStorageLibrary(id) {
  const open = window.workstationDesktop?.openStorageLibrary;
  if (!open) throw new Error('Open folder is available in the desktop app.');
  const result = await open(id);
  if (result.error) throw new Error(result.error);
}
