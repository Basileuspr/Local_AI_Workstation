import {apiUrl} from './api';
export const RESOURCE_KINDS = {image:'Library image',parts:'Character parts dataset',lora_project:'LoRA project',lora_adapter:'Trained LoRA',knowledge:'Knowledge document',character:'Related character',file:'Saved file'};
async function request(path,options) {
  const response = await fetch(apiUrl(`/faces${path}`),options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : `Character reference request failed (${response.status}).`);
  }
  return response.json();
}
const json = (method,body) => ({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
export const resourceCatalog = kind => request(`/character-resources/catalog/${encodeURIComponent(kind)}`);
export const linkResource = (id,kind,target_id,note='') => request(`/characters/${id}/resources`,json('POST',{kind,target_id,note}));
export const editResource = (id,link,note) => request(`/characters/${id}/resources/${link}`,json('PUT',{note}));
export const unlinkResource = (id,link) => request(`/characters/${id}/resources/${link}`,{method:'DELETE'});
export function attachCharacterFile(id,file,note='') {
  if (!file?.size || file.size > 128*1024*1024) throw new Error('Choose a nonempty file up to 128 MiB.');
  const body = new FormData();body.append('file',file,file.name || 'Audio.wav');body.append('note',note);
  return request(`/characters/${id}/files`,{method:'POST',body});
}
export const characterFileUrl = (id,download=false) => apiUrl(`/faces/character-resources/files/${id}${download ? '?download=true' : ''}`);
