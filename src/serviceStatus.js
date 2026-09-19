/**
 * Turns dependency status into something worth showing a person.
 *
 * The interface used to report only "almost ready", which is true of a machine
 * with no Ollama, no models, and a broken index alike. Each of those needs a
 * different action from the user, so each gets its own message and, where one
 * exists, the exact command that fixes it.
 *
 * Severity drives presentation: `blocked` means chat cannot work at all,
 * `degraded` means it works with something missing, `ready` means everything
 * checked is available.
 */

export const SEVERITY = {
  blocked: "blocked",
  degraded: "degraded",
  ready: "ready",
};

const EMPTY_STATUS = {
  backend: { ok: false },
  ollama: { reachable: false, error: null, detail: null, url: "" },
  models: { chat_count: 0, embedding_ready: false, embedding_model: "nomic-embed-text" },
  knowledge_base: { ok: true, documents: 0, error: null },
};

function merge(status) {
  const source = status || {};
  return {
    backend: { ...EMPTY_STATUS.backend, ...(source.backend || {}) },
    ollama: { ...EMPTY_STATUS.ollama, ...(source.ollama || {}) },
    models: { ...EMPTY_STATUS.models, ...(source.models || {}) },
    knowledge_base: { ...EMPTY_STATUS.knowledge_base, ...(source.knowledge_base || {}) },
  };
}

/**
 * The single most important problem to report, or null when nothing is wrong.
 *
 * Ordered by what blocks the user first: an unreachable backend hides
 * everything behind it, and a missing Ollama makes the model list meaningless.
 */
export function describeStatus(rawStatus) {
  const status = merge(rawStatus);

  if (!status.backend.ok) {
    return {
      severity: SEVERITY.blocked,
      code: "backend_unreachable",
      title: "Backend not running",
      detail:
        status.backend.error ||
        "The local API is not responding. Restarting the app usually fixes this.",
      action: null,
    };
  }

  if (!status.ollama.reachable) {
    const notRunning = status.ollama.error === "not_running";
    return {
      severity: SEVERITY.blocked,
      code: status.ollama.error || "ollama_unreachable",
      title: notRunning ? "Ollama is not running" : "Cannot reach Ollama",
      detail:
        status.ollama.detail ||
        `No response from ${status.ollama.url || "the configured Ollama address"}.`,
      action: notRunning ? "ollama serve" : null,
    };
  }

  if (status.models.chat_count === 0) {
    return {
      severity: SEVERITY.blocked,
      code: "no_chat_models",
      title: "No chat models installed",
      detail: "Ollama is running but has no models to talk to. Pull one to get started.",
      action: "ollama pull mistral",
    };
  }

  if (!status.models.embedding_ready) {
    return {
      severity: SEVERITY.degraded,
      code: "no_embedding_model",
      title: "Knowledge base unavailable",
      detail:
        `Chat works, but the embedding model "${status.models.embedding_model}" is not ` +
        "installed, so documents cannot be indexed or searched.",
      action: `ollama pull ${status.models.embedding_model}`,
    };
  }

  if (!status.knowledge_base.ok) {
    return {
      severity: SEVERITY.degraded,
      code: "knowledge_base_error",
      title: "Knowledge base cannot be read",
      detail:
        status.knowledge_base.error ||
        "The document index could not be opened. Chat still works without it.",
      action: null,
    };
  }

  return null;
}

/** Short label and CSS class for the header indicator. */
export function statusIndicator({ connected, isGenerating, problem, hasModel }) {
  if (!connected) return { className: "error", label: "not ready" };
  if (problem?.severity === SEVERITY.blocked) {
    return { className: "error", label: problem.title.toLowerCase() };
  }
  if (isGenerating) return { className: "busy", label: "responding" };
  if (problem?.severity === SEVERITY.degraded) {
    return { className: "warning", label: "limited" };
  }
  if (!hasModel) return { className: "loading", label: "almost ready" };
  return { className: "ready", label: "ready" };
}

/** Whether sending a message can possibly succeed right now. */
export function canChat(problem) {
  return problem?.severity !== SEVERITY.blocked;
}
