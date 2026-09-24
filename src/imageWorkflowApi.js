import { apiUrl } from "./api";
import { workflowUpdate } from "./imageWorkflow";

async function request(path = "", method = "GET", body, token) {
  const response = await fetch(apiUrl(`/image-workflows${path}`), {
    method,
    ...(body instanceof FormData ? { body } : body !== undefined ? {
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map(item => `${item.loc?.slice(1).join(".")}: ${item.msg}`).join("; ")
      : data.detail;
    throw Object.assign(new Error(detail || `Workflow request failed (${response.status})`), { status: response.status });
  }
  return data;
}

const path = id => `/${encodeURIComponent(id)}`;
export const catalog = () => request("/capabilities");
export const list = () => request();
export const remove = (workflows, token) => request("/delete", "POST", { workflows: workflows.map(({id, revision}) => ({id, revision})) }, token);
export const create = (mode = "stages") => request("", "POST", { name: mode === "scene" ? "Untitled iterative scene" : "Untitled image workflow", mode });
export const sceneFrames = id => request(`${path(id)}/scene/frames`);
export const sceneFrame = (workflow, frame, action) => request(`${path(workflow.id)}/scene/frame`, "POST", { revision: workflow.revision, frame, action });
export const sceneIdentity = (workflow, characterId) => request(`${path(workflow.id)}/scene/identity`, "POST", { revision: workflow.revision, character_id: characterId });
export const importSource = (workflow, source) => request(`${path(workflow.id)}/source`, "POST", { revision: workflow.revision, source });
export const patchScene = (workflow, changes, remove_objects = []) => request(`${path(workflow.id)}/scene`, "PATCH", { revision: workflow.revision, changes, remove_objects });
export const get = id => request(path(id));
export const save = workflow => request(path(workflow.id), "PUT", workflowUpdate(workflow));
export const validate = workflow => request(`${path(workflow.id)}/preflight`, "POST", { revision: workflow.revision });
export const prepare = workflow => request(`${path(workflow.id)}/jobs`, "POST", { revision: workflow.revision });
export const branch = workflow => request(`${path(workflow.id)}/branch`, "POST", { revision: workflow.revision });
export const jobs = id => request(`${path(id)}/jobs`);
export const job = (id, jobId) => request(`${path(id)}/jobs/${encodeURIComponent(jobId)}`);
export const execute = workflow => request(`${path(workflow.id)}/execute`, "POST", { revision: workflow.revision });
export const runState = (id, jobId) => request(`${path(id)}/jobs/${encodeURIComponent(jobId)}/run`);
export const stop = (id, jobId) => request(`${path(id)}/jobs/${encodeURIComponent(jobId)}/stop`, "POST");
export const keepOutput = (workflow, jobId, outputId) => request(`${path(workflow.id)}/jobs/${encodeURIComponent(jobId)}/accept`, "POST", { revision: workflow.revision, output_id: outputId });
export const outputUrl = (id, jobId, outputId) => apiUrl(`/image-workflows${path(id)}/jobs/${encodeURIComponent(jobId)}/outputs/${encodeURIComponent(outputId)}`);
export const assetUrl = (id, assetId) => apiUrl(`/image-workflows${path(id)}/assets/${encodeURIComponent(assetId)}`);
const runPath = (id, jobId) => `${path(id)}/jobs/${encodeURIComponent(jobId)}`;
export const images = () => request("/images");
export const stitch = (id, jobId, layout) => request(`${runPath(id, jobId)}/stitched/${encodeURIComponent(layout)}`, "POST");
export const stitchedUrl = (id, jobId, layout) => apiUrl(`/image-workflows${runPath(id, jobId)}/stitched/${encodeURIComponent(layout)}`);
export const keepStitched = (workflow, jobId, layout) => request(`${runPath(workflow.id, jobId)}/stitched/${encodeURIComponent(layout)}/accept`, "POST", { revision: workflow.revision });

async function download(url, fallbackName) {
  const response = await fetch(url);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || `Download failed (${response.status})`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || fallbackName;
  document.body.appendChild(link);
  try { link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(objectUrl), 60000); }
}

export const downloadImages = (id, jobId) => download(apiUrl(`/image-workflows${runPath(id, jobId)}/download`), "workflow-images.zip");
export const downloadStitched = (id, jobId, layout) => {
  const url = stitchedUrl(id, jobId, layout);
  return download(`${url}${url.includes("?") ? "&" : "?"}download=true`, `workflow-${layout}.png`);
};
export function upload(workflow, file) {
  const body = new FormData();
  body.append("revision", workflow.revision);
  body.append("file", file);
  return request(`${path(workflow.id)}/assets`, "POST", body);
}

export async function uploadMany(workflow, files, onSaved = () => {}) {
  const selected = Array.from(files || []);
  let current = workflow;
  let added = 0;
  let duplicates = 0;
  const failed = [];
  for (let index = 0; index < selected.length; index++) {
    const file = selected[index];
    try {
      const next = await upload(current, file);
      const count = next.assets.length - current.assets.length;
      added += count;
      if (!count) duplicates++;
      current = next;
      onSaved(current);
    } catch (error) {
      failed.push(`${file.name}: ${error.message}`);
      // A stale revision or lost connection needs a reload before more writes.
      if (!error.status || error.status === 409) {
        if (index + 1 < selected.length) failed.push(`${selected.length - index - 1} remaining file(s) not uploaded. Reload this workflow before retrying.`);
        break;
      }
    }
  }
  return { workflow: current, added, duplicates, failed };
}
