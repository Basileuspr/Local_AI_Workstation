import { apiUrl, getThinkingExportUrl } from "./api";

export async function loadThinkingTrace({ offset = 0, revision = "", signal } = {}) {
  const query = new URLSearchParams({ offset: String(offset), revision });
  const response = await fetch(apiUrl(`/thinking/trace?${query}`), { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load thinking trace (${response.status})`);
  return response.json();
}

export function mergeTracePage(previous, page) {
  return {
    content: page.offset === 0 || previous.revision !== page.revision
      ? page.content : previous.content + page.content,
    offset: page.next_offset,
    revision: page.revision,
  };
}

export async function exportThinkingTrace() {
  const response = await fetch(getThinkingExportUrl(), { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not export thinking trace (${response.status})`);
  const blob = await response.blob();
  if (!blob.size) throw new Error("No thinking trace has been recorded yet");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `thinking-trace-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
  document.body.appendChild(link);
  try { link.click(); }
  finally {
    link.remove();
    // Keep the URL alive long enough for the browser download to begin.
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}
