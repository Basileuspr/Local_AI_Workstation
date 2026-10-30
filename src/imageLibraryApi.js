import { apiUrl } from "./api";
import { imageSourceUrl } from "./imageSources";

export function changed() {
  window.dispatchEvent(new Event("image-library-changed"));
  // Notify other app windows without persisting images, PINs or access tokens.
  localStorage.setItem("image-library-revision", String(Date.now()));
}

export async function request(path = "", method = "GET", body, token, { signal } = {}) {
  const response = await fetch(apiUrl(`/image-library${path}`), {
    method, signal, cache: "no-store", headers: {
      ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }, ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(typeof data.detail === "string" ? data.detail : `Image request failed (${response.status})`), { status: response.status });
  return data;
}

export const list = () => request();
export const folder = (name, id) => request(id ? `/folders/${id}` : "/folders", id ? "PUT" : "POST", { name });
export const deleteFolder = id => request(`/folders/${id}`, "DELETE");
export const tag = (name, id) => request(id ? `/tags/${id}` : "/tags", id ? "PUT" : "POST", { name });
export const deleteTag = id => request(`/tags/${id}`, "DELETE");
export const edit = (id, values) => request(`/images/${id}`, "PATCH", values);
export const remove = id => request(`/images/${id}`, "DELETE");
export const importSource = (source, folderId) => request("/import", "POST", { ...source, folder_id: folderId || undefined });
export const previewStitch = (body, signal) => request('/stitch/preview', 'POST', body, undefined, { signal });
export const saveStitch = body => request('/stitch', 'POST', body);

export async function downloadImage(image) {
  if (globalThis.window?.workstationDesktop?.downloadLibraryImage) {
    const result = await window.workstationDesktop.downloadLibraryImage(image.id);
    if (!result?.saved && !result?.canceled) throw new Error(result?.error || 'Image could not be saved. Restart the desktop app and retry.');
    return result;
  }
  const url = new URL(imageSourceUrl(image.url));
  url.searchParams.set('download', 'true');
  const response = await fetch(url.href, { method: 'HEAD', cache: 'no-store' });
  if (!response.ok) throw new Error('This image is unavailable or locked.');
  const link = document.createElement('a');
  // The attachment response streams to the browser download manager, avoiding
  // a second whole-image Blob allocation for very large stitches.
  link.href = url.href; link.download = image.name || 'Stitched.png';
  document.body.appendChild(link);
  try { link.click(); }
  finally { link.remove(); }
  return { started: true };
}
export function upload(files) {
  const body = new FormData();
  Array.from(files || []).forEach(file => body.append("files", file));
  return request("/upload", "POST", body);
}
export const imageUrl = image => ({ ...image, url: imageSourceUrl(image.url) });
export function sourceFor(image) {
  if (image.managed) return { kind: "managed", id: image.id };
  if (image.library) return { kind: "library", id: image.id };
  if (image.session_id) return { kind: "session", session_id: image.session_id, message_id: image.message_id, image_id: image.image_id, name: image.name };
  if (image.run) return { kind: "workflow", workflow_id: image.run.workflow_id, job_id: image.run.id,
    ...(image.layout ? { layout: image.layout } : { output_id: image.output_id || image.id.split(":").pop() }), name: image.name };
  return { kind: "library", id: image.id };
}


export async function exportImages(ids) {
  if (globalThis.window?.workstationDesktop?.exportLibraryImages) {
    const result = await window.workstationDesktop.exportLibraryImages(ids);
    if (!result?.saved && !result?.canceled) throw Error(result?.error || 'Export failed.');
    return result;
  }
  const link = document.createElement('a');
  link.href = apiUrl('/image-library/export?' + new URLSearchParams({ ids: ids.join(',') }));
  link.download = 'review-images.zip'; document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); }
  return { started: true };
}
