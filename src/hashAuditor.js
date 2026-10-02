import { apiUrl } from "./api";

export const matchModes = [
  { id: "hash", label: "Exact SHA-256 matches" },
  { id: "name_size", label: "Same name + size" },
  { id: "size_modified", label: "Same size + modified time" },
  { id: "name_size_modified", label: "Same name + size + modified time" },
];

export function folderPaths(text) {
  return [...new Set(text.split(/\r?\n/).map(path => path.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean))];
}

export function formatAuditBytes(value) {
  if (value == null) return "Unknown size";
  const size = Number(value);
  if (!size) return "0 B";
  const unit = Math.min(4, Math.floor(Math.log(size) / Math.log(1024)));
  return `${(size / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: unit ? 2 : 0 })} ${["B", "KiB", "MiB", "GiB", "TiB"][unit]}`;
}

export function auditDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

async function request(path, options = {}) {
  const response = await fetch(apiUrl(`/hash-auditor${path}`), { signal: AbortSignal.timeout(60000), ...options });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.detail === "string" ? data.detail : `Hash Auditor request failed (${response.status})`);
  }
  return response.json();
}

export const startAudit = (roots, excludes) => request("/scans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roots, excludes }) });
export const cancelAudit = id => request(`/scans/${encodeURIComponent(id)}/cancel`, { method: "POST" });
export const auditGroups = (mode, offset = 0, signal) => request(`/groups?${new URLSearchParams({ mode, offset, limit: 20 })}`, signal ? { signal } : {});
export const auditGroupFiles = (mode, key, offset) => request(`/group-files?${new URLSearchParams({ mode, key, offset, limit: 100 })}`);
export const auditInventory = (search = "", offset = 0, signal) => request(`/files?${new URLSearchParams({ search, offset, limit: 100 })}`, signal ? { signal } : {});
export const auditIssues = (id, offset = 0) => request(`/scans/${encodeURIComponent(id)}/issues?${new URLSearchParams({ offset, limit: 100 })}`);
export const auditExportUrl = (scope, mode = "hash") => apiUrl(`/hash-auditor/export?${new URLSearchParams({ scope, mode })}`);

export async function exportAudit(scope, mode = "hash") {
  if (window.workstationDesktop?.exportHashAudit) {
    const result = await window.workstationDesktop.exportHashAudit(scope, mode);
    if (result.error) throw new Error(result.error);
    return;
  }
  const response = await fetch(auditExportUrl(scope, mode), { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not export the audit (${response.status})`);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url; link.download = `hash-audit-${scope}.csv`;
  document.body.appendChild(link);
  try { link.click(); }
  finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000); }
}

export async function chooseAuditFolders() {
  if (!window.workstationDesktop?.chooseHashAuditFolders) throw new Error("Browse is available in the desktop app. Paste an absolute folder path below.");
  const result = await window.workstationDesktop.chooseHashAuditFolders();
  if (result.error) throw new Error(result.error);
  return result.paths || [];
}
