import { API_BASE, API_TOKEN } from "./config";

export { API_BASE, API_TOKEN };

/**
 * Every backend URL in the app is built here, so attaching the session
 * credential once covers fetch calls, <img src>, download links and event
 * streams alike -- the surfaces that cannot carry a request header.
 */
export const apiUrl = (path) => {
  const url = `${API_BASE}${path}`;
  if (!API_TOKEN) return url;
  return `${url}${url.includes("?") ? "&" : "?"}law_token=${encodeURIComponent(API_TOKEN)}`;
};

/** Where the backend serves one stored image from a session. */
export function getSessionImageUrl(sessionId, messageId, imageId) {
  return apiUrl(`/sessions/${sessionId}/images/by-id/${encodeURIComponent(
    messageId
  )}/${encodeURIComponent(imageId)}`);
}

export async function checkHealth() {
  try {
    const res = await fetch(apiUrl(`/runtime/status`));
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Load chat models.
 *
 * Returns the backend's own explanation alongside the list. This used to
 * discard `data.error`, so a machine with no Ollama showed an empty dropdown
 * and no reason -- the backend knew exactly what was wrong and nobody asked.
 */
export async function loadModels() {
  try {
    const res = await fetch(apiUrl(`/models`), { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Model discovery failed (${res.status})`);
    const data = await res.json();
    return { models: data.models || [], error: data.error || null };
  } catch (err) {
    return { models: [], error: err?.message || "Could not reach the backend" };
  }
}

/**
 * Full dependency readiness: Ollama, models, embeddings, knowledge base.
 *
 * `checkHealth` only proves the backend process is alive, which is the least
 * useful thing to know when the app appears broken.
 */
export async function fetchStatus() {
  try {
    const res = await fetch(apiUrl(`/status`), { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Status request failed (${res.status})`);
    return await res.json();
  } catch (err) {
    return {
      backend: { ok: false, error: err?.message || "Backend unreachable" },
      ollama: { reachable: false, error: "backend_unreachable", detail: null },
      models: { chat_count: 0, embedding_ready: false },
      knowledge_base: { ok: false, documents: 0, error: null },
    };
  }
}

export async function createSession() {
  const res = await fetch(apiUrl(`/sessions/new`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  return await res.json();
}

export async function loadSession(sessionId) {
  const res = await fetch(apiUrl(`/sessions/${sessionId}`));
  return await res.json();
}

export async function saveSession(
  sessionId,
  messages,
  model,
  { memorySummary, summarizedMessageCount, title } = {}
) {
  const res = await fetch(apiUrl(`/sessions/${sessionId}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      model,
      title,
      memory_summary: memorySummary,
      summarized_message_count: summarizedMessageCount,
    }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || "Could not save the chat");
  }
  return await res.json();
}

export async function deleteSession(sessionId) {
  const res = await fetch(apiUrl(`/sessions/${sessionId}`), { method: "DELETE" });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || "Could not delete the chat");
  }
}

/** Sessions that were deleted but are still recoverable. */
export async function listDeletedSessions() {
  const res = await fetch(apiUrl(`/sessions/trash`));
  if (!res.ok) throw new Error("Could not load Recently deleted");
  const data = await res.json();
  return data.sessions || [];
}

export async function restoreDeletedSession(file) {
  const res = await fetch(apiUrl(`/sessions/trash/restore`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || "Could not restore the chat");
  }
  return await res.json();
}

export async function permanentlyDeleteSession(file) {
  const res = await fetch(apiUrl(`/sessions/trash/${encodeURIComponent(file)}`), { method: "DELETE" });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || "Could not permanently delete the chat");
  }
}

export async function appendSessionMessages(sessionId, messages, model, { memorySummary, summarizedMessageCount } = {}) {
  const response = await fetch(apiUrl(`/sessions/${encodeURIComponent(sessionId)}/messages/append`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, model, memory_summary: memorySummary, summarized_message_count: summarizedMessageCount }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || "Could not save the queued result to its chat");
  }
  return response.json();
}

export async function fetchRuntimeStatus() {
  const res = await fetch(apiUrl(`/runtime/status`));
  if (!res.ok) throw new Error(`Runtime status failed (${res.status})`);
  return await res.json();
}

export async function resetRuntime() {
  const res = await fetch(apiUrl(`/runtime/reset`), { method: "POST" });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || "Could not reset local runtimes");
  }
  return await res.json();
}

export async function listSessions() {
  const res = await fetch(apiUrl(`/sessions/list`));
  const data = await res.json();
  return data.sessions || [];
}

export async function listSessionImages(hidden = false) {
  const res = await fetch(apiUrl(`/sessions/images${hidden ? "?hidden=true" : ""}`));
  if (!res.ok) {
    throw new Error("Could not load chat images");
  }
  const data = await res.json();
  return (data.images || []).map((image) => ({
    ...image,
    url: apiUrl(`${image.url}`),
  }));
}

export async function removeSessionImage(sessionId, imageId) {
  const res = await fetch(apiUrl(`/sessions/${sessionId}/gallery-images/${imageId}`), {
    method: "DELETE",
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || "Could not remove image from gallery");
  }
}

export async function permanentlyDeleteSessionImage(sessionId, imageId) {
  const res = await fetch(apiUrl(`/sessions/${sessionId}/images/${encodeURIComponent(imageId)}`), {
    method: "DELETE",
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || "Could not permanently delete the image");
  }
}

export async function listKnowledgeBase() {
  const res = await fetch(apiUrl(`/files/knowledge-base/list`));
  const data = await res.json();
  return data.documents || [];
}

export async function knowledgeGraphRequest(path = "", method = "GET", body, graph = true) {
  const res = await fetch(apiUrl(`/files/knowledge-base${graph ? "/graph" : ""}${path}`), {
    method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Could not load or update Knowledge");
  return data;
}

export async function addToKnowledgeBase(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(apiUrl(`/files/knowledge-base/add`), {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Upload failed");
  }
  return await res.json();
}

export async function removeFromKnowledgeBase(docId) {
  const res = await fetch(apiUrl(`/files/knowledge-base/${encodeURIComponent(docId)}`), { method: "DELETE" });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || "Could not remove document from Knowledge");
  }
}

export async function parseFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(apiUrl(`/files/parse`), {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Parse failed");
  }
  return await res.json();
}

export async function streamChat({
  replyMessageId,
  documentFormat,
  model,
  messages,
  useKnowledgeBase,
  knowledgeDocIds,
  canvasContext,
  useMemory = true,
  systemPrompt,
  options,
  sessionId,
  requestId,
  username = "local-user",
  signal,
}) {
  const res = await fetch(apiUrl(`/chat`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      use_knowledge_base: useKnowledgeBase,
      knowledge_doc_ids: knowledgeDocIds,
      canvas_context: canvasContext,
      use_memory: useMemory,
      system_prompt: systemPrompt,
      options,
      session_id: sessionId,
      request_id: requestId,
      username,
      reply_message_id: replyMessageId,
      document_format: documentFormat,
    }),
    signal,
  });

  if (!res.ok) {
    let detail = `Backend request failed (${res.status})`;
    try {
      const data = await res.json();
      detail = data.detail || data.error || detail;
      if (Array.isArray(detail)) {
        detail = detail.map((item) => item.msg || String(item)).join("; ");
      }
    } catch {}
    throw new Error(detail);
  }
  if (!res.body) {
    throw new Error("Backend returned an empty response stream");
  }
  return res;
}

export async function stopChat(requestId) {
  if (!requestId) return;
  await fetch(apiUrl(`/chat/stop/${encodeURIComponent(requestId)}`), {
    method: "POST",
  });
}

export function getExportUrl(sessionId, format) {
  return apiUrl(`/export/${sessionId}/${format}`);
}

export function getThinkingExportUrl() {
  return apiUrl(`/thinking/export`);
}

export async function compactMemory({ model, previousSummary, messages, targetTokens, requestId, sessionId, signal }) {
  const res = await fetch(apiUrl(`/memory/compact`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      previous_summary: previousSummary,
      session_id: sessionId,
      messages,
      target_tokens: targetTokens,
      request_id: requestId,
    }),
    signal,
  });
  if (!res.ok) {
    throw new Error("Memory compaction failed");
  }
  return await res.json();
}

export async function saveDurableMemory({ memoryText, memoryType = "general", importance = 3 }) {
  const res = await fetch(apiUrl(`/memory`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "local-user",
      memory_text: memoryText,
      memory_type: memoryType,
      importance,
    }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || "Could not save durable memory");
  }
  return await res.json();
}

export async function openThinkingTerminal() {
  const res = await fetch(apiUrl(`/thinking/open-terminal`), {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error("Could not open thinking terminal");
  }
  return await res.json();
}

async function promptIndexRequest(path = "", options) {
  const res = await fetch(apiUrl(`/prompt-index${path}`), options);
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || "Could not update Prompt Index");
  }
  return await res.json();
}

export async function listPromptIndexEntries() {
  const data = await promptIndexRequest();
  return data.entries || [];
}

export async function loadPromptIndexState() {
  return promptIndexRequest("/state");
}

export async function savePromptIndexDraft(draft) {
  return promptIndexRequest("/draft", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
}

export async function clearPromptIndexDraft() {
  return promptIndexRequest("/draft", { method: "DELETE" });
}

export async function createPromptIndexEntry(entry) {
  return promptIndexRequest("", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
}

export async function updatePromptIndexEntry(entryId, entry) {
  return promptIndexRequest(`/${entryId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
}

export async function deletePromptIndexEntry(entryId) {
  return promptIndexRequest(`/${entryId}`, { method: "DELETE" });
}

export async function loadImageGenerationModels() {
  const res = await fetch(apiUrl(`/image-generation/models`));
  if (!res.ok) throw new Error("Could not load image-generation models");
  return await res.json();
}

export async function generateImage(options, { signal } = {}) {
  const res = await fetch(apiUrl(`/image-generation/generate`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
    signal,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    const failure = new Error(error.detail || "Image generation failed");
    if (res.status === 499) failure.name = "AbortError";
    throw failure;
  }
  return await res.json();
}

export async function stopImageGeneration(requestId) {
  if (!requestId) return { stopped: false };
  const res = await fetch(apiUrl(`/image-generation/stop/${encodeURIComponent(requestId)}`), {
    method: "POST",
  });
  if (!res.ok) throw new Error("Could not stop image generation");
  return await res.json();
}

export async function getImagePromptTokens({ modelId, prompt, negativePrompt }) {
  const res = await fetch(apiUrl(`/image-generation/prompt-tokens`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model_id: modelId, prompt, negative_prompt: negativePrompt || "" }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || "Could not count image prompt tokens");
  }
  return await res.json();
}

async function loraRequest(path = "", options) {
  const res = await fetch(apiUrl(`/lora${path}`), options);
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || "LoRA request failed");
  }
  return await res.json();
}

export async function listLoraProjects() {
  const data = await loraRequest("/projects");
  return data.projects || [];
}

export async function loraHardware() {
  return loraRequest("/hardware");
}

export async function listLoraVisionModels() {
  const data = await loraRequest("/vision-models");
  return data.models || [];
}

export async function getLoraProject(projectId) {
  return loraRequest(`/projects/${encodeURIComponent(projectId)}`);
}

export async function createLoraProject(project) {
  return loraRequest("/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project),
  });
}

export async function updateLoraProject(projectId, project) {
  return loraRequest(`/projects/${encodeURIComponent(projectId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project),
  });
}

export async function uploadLoraImages(projectId, files) {
  const formData = new FormData();
  Array.from(files).forEach((file) => formData.append("files", file));
  return loraRequest(`/projects/${encodeURIComponent(projectId)}/images`, { method: "POST", body: formData });
}

export function getLoraImageUrl(projectId, imageId) {
  return apiUrl(`/lora/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(imageId)}`);
}

export async function updateLoraCaption(projectId, imageId, caption) {
  return loraRequest(`/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(imageId)}/caption`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caption }),
  });
}

export async function removeLoraImage(projectId, imageId) {
  return loraRequest(`/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(imageId)}`, { method: "DELETE" });
}

export async function clearLoraImages(projectId) {
  return loraRequest(`/projects/${encodeURIComponent(projectId)}/images`, { method: "DELETE" });
}

export async function analyzeLoraDataset(projectId, analysis, signal) {
  return loraRequest(`/projects/${encodeURIComponent(projectId)}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(analysis),
    signal,
  });
}

export async function stopLoraAnalysis(requestId) {
  return loraRequest(`/analysis/stop/${encodeURIComponent(requestId)}`, { method: "POST" });
}

export async function applyLoraCaptionSuggestions(projectId) {
  return loraRequest(`/projects/${encodeURIComponent(projectId)}/analysis/apply-captions`, { method: "POST" });
}

export async function getLoraPreflight(projectId) {
  return loraRequest(`/projects/${encodeURIComponent(projectId)}/preflight`);
}

export async function startLoraTraining(projectId) {
  return loraRequest(`/projects/${encodeURIComponent(projectId)}/train`, { method: "POST" });
}

export async function analyzeAndTrainLora(projectId) {
  return loraRequest(`/projects/${encodeURIComponent(projectId)}/analyze-and-train`, { method: "POST" });
}

export async function getLoraTraining(projectId) {
  return loraRequest(`/projects/${encodeURIComponent(projectId)}/training`);
}

export async function cancelLoraTraining(projectId) {
  return loraRequest(`/projects/${encodeURIComponent(projectId)}/cancel`, { method: "POST" });
}

export async function listLoraAdapters() {
  const data = await loraRequest("/adapters");
  return data.adapters || [];
}

export async function restoreSessionImage(sessionId, imageId) {
  const response = await fetch(apiUrl(`/sessions/${sessionId}/gallery-images/${encodeURIComponent(imageId)}/restore`), { method: "POST" });
  if (!response.ok) throw new Error((await response.json()).detail || "Could not restore image");
}
