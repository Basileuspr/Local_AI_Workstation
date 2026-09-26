import { pickFolder } from './folder-picker.js';
/** Used by standalone and isolated desktop views; no Workstation media bridge. */
export function createLocalAdapter(base = '', token = document.querySelector('meta[name="organizer-token"]')?.content || '') {
  async function request(path, body) {
    const response = await fetch(`${base}/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-Organizer-Token': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The request failed. Try again.');
    return data;
  }
  return {
    captures: kind => request('captures', {kind}),
    revealCapture: captureId => request('open-folder', {captureId}),
    captureUrl: id => `${base}/api/capture-media?${new URLSearchParams({id,token})}`,
    state: () => request('state'),
    frameTimeline: id => request(`frame-timeline?${new URLSearchParams({id})}`),
    library: runId => request(`library?${new URLSearchParams({ runId })}`),
    rotate: (runId, recordId, direction) => request('rotate', { runId, recordId, direction }),
    tags: payload => request('tags', payload),
    operation: (kind, payload) => request(kind, payload),
    cancelFrames: jobId => request('cancel-frames', { jobId }),
    pickFolder: (kind, initial='') => pickFolder(request, kind, initial),
    openFolder: path => request('open-folder', { path }),
    reveal: (runId, recordId) => request('open-folder', { runId, recordId }),
    scan: options => request('scan', options),
    move: (runId, confirmation) => request('move', { runId, confirmation }),
    addCustomFolder: (path, name, mode) => request('custom-folders', { path, name, ...(mode?{mode}:{}) }),
    previewCustomMove: (runId, folderId, recordIds) => request('custom-preview', { runId, folderId, recordIds }),
    customMove: (runId, planId, confirmation) => request('custom-move', { runId, planId, confirmation }),
    mediaUrl: (runId, recordId) => `${base}/api/media?${new URLSearchParams({ runId, recordId, token })}`,
    thumbnailUrl: (runId, recordId, size = 'small') => `${base}/api/thumbnail?${new URLSearchParams({ runId, recordId, size, token })}`,
  };
}
