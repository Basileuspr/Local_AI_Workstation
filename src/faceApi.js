import { apiUrl } from "./api";

async function request(path, options = {}) {
  const response = await fetch(apiUrl(`/faces${path}`), options);
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    if (!response.ok) throw new Error(`Face request failed (${response.status})`);
    return response;
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || "Face request failed");
  return data;
}

const json = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const listProviders = () => request("/providers");
export const installModels = () => request("/providers/install", { method: "POST" });

export const listDatasets = () => request("/datasets");
export const createDataset = (name) => request("/datasets", json({ name }));
export const getDataset = (id) => request(`/datasets/${id}`);
export const renameDataset = (id, name) => request(`/datasets/${id}`, { ...json({ name }), method: "PUT" });
export const deleteDataset = (id) => request(`/datasets/${id}`, { method: "DELETE" });
export const saveSettings = (id, settings) =>
  request(`/datasets/${id}/settings`, { ...json({ settings }), method: "PUT" });

export const extractFrom = (id, sources) => request(`/datasets/${id}/extract`, json({ sources }));
export const getRun = (id) => request(`/datasets/${id}/run`);
export const stopRun = (id, runId) => request(`/datasets/${id}/run/stop${runId ? `?run_id=${encodeURIComponent(runId)}` : ""}`, { method: "POST" });
export const recrop = (id, faceIds) => request(`/datasets/${id}/recrop`, json({ face_ids: faceIds || [] }));

export function uploadImages(id, files) {
  const body = new FormData();
  for (const file of files) body.append("files", file, file.name);
  return request(`/datasets/${id}/upload`, { method: "POST", body });
}

export const setFaceState = (id, faceIds, state) =>
  request(`/datasets/${id}/state`, json({ face_ids: faceIds, state }));
export const removeFaces = (id, faceIds) => request(`/datasets/${id}/remove`, json({ face_ids: faceIds }));
export const findSimilar = (id, faceId, threshold) =>
  request(`/datasets/${id}/similar/${faceId}?threshold=${encodeURIComponent(threshold)}`);
export const runCluster = (id) => request(`/datasets/${id}/cluster`, { method: "POST" });
export const findDuplicates = (id) => request(`/datasets/${id}/duplicates`, { method: "POST" });

// --- character face bank ---
export const listCharacters = () => request("/characters");
export const createCharacter = (body) => request("/characters", json(body));
export const getCharacter = (id) => request(`/characters/${id}`);
export const recompute = id => request(`/characters/${id}/recompute`, { method: "POST" });
export const editCharacter = (id, body) => request(`/characters/${id}`, { ...json(body), method: "PUT" });
export const deleteCharacter = (id) => request(`/characters/${id}`, { method: "DELETE" });
export const addMembers = (id, datasetId, faceIds) =>
  request(`/characters/${id}/members`, json({ dataset_id: datasetId, face_ids: faceIds }));
export const setMemberState = (id, faceIds, state) =>
  request(`/characters/${id}/members/state`, json({ face_ids: faceIds, state }));
export const removeMembers = (id, faceIds) =>
  request(`/characters/${id}/members/remove`, json({ face_ids: faceIds }));
export const moveMembers = (id, targetId, faceIds) =>
  request(`/characters/${id}/members/move`, json({ target_id: targetId, face_ids: faceIds }));
export const setReference = (id, faceId, role) =>
  request(`/characters/${id}/reference`, json({ face_id: faceId, role }));
export const identityBundle = (id) => request(`/characters/${id}/identity`);

/** Accepted members, most representative first; rejected and drifting kept separate. */
export function curationGroups(character) {
  const members = character?.members || [];
  const score = (member) => (member.similarity === null ? -2 : member.similarity);
  const accepted = members.filter((m) => m.state === "accepted").sort((a, b) => score(b) - score(a));
  return {
    accepted,
    rejected: members.filter((m) => m.state === "rejected"),
    drifting: accepted.filter((m) => m.drift),
    distribution: accepted.map((m) => m.similarity).filter((value) => typeof value === "number"),
  };
}

export const cropUrl = (datasetId, faceId, revision = 0) =>
  apiUrl(`/faces/datasets/${datasetId}/faces/${faceId}/crop?v=${revision}`);
export const exportUrl = (datasetId) => apiUrl(`/faces/datasets/${datasetId}/export`);

/** Sort and filter the contact sheet. Similarity is only offered once a reference exists. */
export function arrangeFaces(faces, { sort, order, filter, scores, threshold, search }) {
  const direction = order === "asc" ? 1 : -1;
  const value = (face) => {
    switch (sort) {
      case "similarity": return scores?.[face.id] ?? -2;
      case "filename": return face.source_name || "";
      case "confidence": return face.metrics.confidence;
      case "size": return Math.min(face.metrics.face_width, face.metrics.face_height);
      case "sharpness": return face.metrics.sharpness;
      case "cluster": return face.cluster ?? 9999;
      default: return face.created_at;
    }
  };
  const text = (search || "").trim().toLowerCase();
  return faces
    .filter((face) => {
      if (filter === "accepted" && face.state !== "accepted") return false;
      if (filter === "rejected" && face.state !== "rejected") return false;
      if (filter === "pending" && face.state !== "pending") return false;
      if (filter === "flagged" && !face.flags.length) return false;
      if (filter === "duplicates" && !face.duplicate_of) return false;
      if (filter === "outliers" && !face.outlier) return false;
      if (filter === "similar" && !(scores && scores[face.id] >= threshold)) return false;
      if (text && !(face.source_name || "").toLowerCase().includes(text)) return false;
      return true;
    })
    .sort((a, b) => {
      const left = value(a);
      const right = value(b);
      if (typeof left === "string") return left.localeCompare(right) * direction;
      return (left - right) * direction;
    });
}
