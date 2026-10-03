import {apiUrl} from './api';
import {downloadBlob} from './downloadBlob';

export async function downloadConvertedImage(artifact, env = globalThis) {
  if (!artifact?.id || !/^[a-f0-9]{32}$/.test(artifact.id) || !artifact.name) throw Error('This converted image is unavailable. Convert it again.');
  if (env.workstationDesktop?.saveConvertedImage) {
    const result = await env.workstationDesktop.saveConvertedImage(artifact.id);
    if (result?.error) throw Error(result.error);
    if (!result?.saved && !result?.canceled) throw Error('The desktop did not confirm the image save. Restart it and try again.');
    return result;
  }
  // A fetch keeps the authenticated backend request inside the app. Navigating
  // an anchor to its different origin can be rejected by the desktop guards.
  const response = await env.fetch(apiUrl(`/workspaces/converted/${artifact.id}`));
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw Error(typeof detail.detail === 'string' ? detail.detail : `Could not download the converted image (${response.status}).`);
  }
  const blob = await response.blob();
  if (!blob.size) throw Error('The converted image is empty. Convert it again.');
  downloadBlob(new Blob([blob], {type:'application/octet-stream'}), artifact.name);
  return {started:true};
}
