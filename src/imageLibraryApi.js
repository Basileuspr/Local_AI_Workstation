import { apiUrl } from "./api";

export function changed() {
  window.dispatchEvent(new Event("image-library-changed"));
  // Notify other app windows without persisting images, PINs or access tokens.
  localStorage.setItem("image-library-revision", String(Date.now()));
}

export async function request(path = "", method = "GET", body, token) {
  const response = await fetch(apiUrl(`/image-library${path}`), {
    method, cache: "no-store", headers: {
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
export function upload(files) {
  const body = new FormData();
  Array.from(files || []).forEach(file => body.append("files", file));
  return request("/upload", "POST", body);
}
export const imageUrl = image => ({ ...image, url: apiUrl(image.url) });
export function sourceFor(image) {
  if (image.library) return { kind: "library", id: image.id };
  if (image.session_id) return { kind: "session", session_id: image.session_id, message_id: image.message_id, image_id: image.image_id, name: image.name };
  if (image.run) return { kind: "workflow", workflow_id: image.run.workflow_id, job_id: image.run.id,
    ...(image.layout ? { layout: image.layout } : { output_id: image.output_id || image.id.split(":").pop() }), name: image.name };
  return { kind: "library", id: image.id };
}
