import { apiUrl } from "./api";
import { selectionPayload } from "./characterParts";
import { downloadBlob } from "./downloadBlob";

export async function request(path, method = "GET", body) {
  const response = await fetch(apiUrl(`/character-parts${path}`), { method, cache: "no-store",
    ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body),
      headers: body instanceof FormData ? {} : { "Content-Type": "application/json" } } : {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(typeof data.detail === "string" ? data.detail
    : Array.isArray(data.detail) ? data.detail.map(item => item.msg).join("; ") : `Character request failed (${response.status})`), { status: response.status });
  return data;
}
export const catalog = () => request("/catalog");
export const list = () => request("/datasets");
export const get = id => request(`/datasets/${id}`);
export const create = name => request("/datasets", "POST", { name });
export const importSources = (id, sources) => request(`/datasets/${id}/import`, "POST", { sources });
export function upload(id, files) {
  const body = new FormData();
  files.forEach(file => body.append("files", file));
  return request(`/datasets/${id}/upload`, "POST", body);
}
export const save = (dataset, value) => request(`/datasets/${dataset.id}/selections${value.id ? `/${value.id}` : ""}`,
  value.id ? "PUT" : "POST", { revision: dataset.revision, selection: selectionPayload(value) });
export const saveCaption = (dataset, sourceId, caption) => request(`/datasets/${dataset.id}/sources/${sourceId}`, "PUT", { revision: dataset.revision, caption });
export const decide = (dataset, ids, state) => request(`/datasets/${dataset.id}/state`, "POST", { revision: dataset.revision, ids, state });
export const analyze = (id, body) => request(`/datasets/${id}/analyze`, "POST", body);
export const run = id => request(`/datasets/${id}/run`);
export const stop = (id, runId) => request(`/datasets/${id}/run/stop?run_id=${encodeURIComponent(runId)}`, "POST");
export const sourceUrl = (id, sourceId, thumbnail = false) => apiUrl(`/character-parts/datasets/${id}/sources/${sourceId}/image?thumbnail=${thumbnail}`);
export const cropUrl = (id, selectionId, revision) => apiUrl(`/character-parts/datasets/${id}/selections/${selectionId}/crop?v=${revision}`);
export const exportUrl = id => apiUrl(`/character-parts/datasets/${id}/export`);

export async function exportMedia(dataset, scope, ids = []) {
  const response = await fetch(apiUrl(`/character-parts/datasets/${dataset.id}/export`), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision: dataset.revision, scope, ids }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw Object.assign(new Error(typeof data.detail === "string" ? data.detail : `Export failed (${response.status})`), { status: response.status });
  }
  downloadBlob(await response.blob(), `character-${scope}-media.zip`);
}
