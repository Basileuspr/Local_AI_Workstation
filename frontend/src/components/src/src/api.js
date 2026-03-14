const API_BASE = "http://localhost:8000";

export async function checkHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function loadModels() {
  try {
    const res = await fetch(`${API_BASE}/models`);
    const data = await res.json();
    return data.models || [];
  } catch {
    return [];
  }
}

export async function createSession() {
  const res = await fetch(`${API_BASE}/sessions/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  return await res.json();
}

export async function loadSession(sessionId) {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}`);
  return await res.json();
}

export async function saveSession(sessionId, messages, model) {
  await fetch(`${API_BASE}/sessions/${sessionId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, model }),
  });
}

export async function deleteSession(sessionId) {
  await fetch(`${API_BASE}/sessions/${sessionId}`, { method: "DELETE" });
}

export async function listSessions() {
  const res = await fetch(`${API_BASE}/sessions/list`);
  const data = await res.json();
  return data.sessions || [];
}

export async function listKnowledgeBase() {
  const res = await fetch(`${API_BASE}/files/knowledge-base/list`);
  const data = await res.json();
  return data.documents || [];
}

export async function addToKnowledgeBase(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/files/knowledge-base/add`, {
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
  await fetch(`${API_BASE}/files/knowledge-base/${docId}`, { method: "DELETE" });
}

export async function parseFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/files/parse`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Parse failed");
  }
  return await res.json();
}

export function streamChat({ model, messages, useKnowledgeBase, systemPrompt, options, signal }) {
  return fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      use_knowledge_base: useKnowledgeBase,
      system_prompt: systemPrompt,
      options,
    }),
    signal,
  });
}

export function getExportUrl(sessionId, format) {
  return `${API_BASE}/export/${sessionId}/${format}`;
}