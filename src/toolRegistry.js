import { apiUrl } from "./api";

export const TOOL_EFFECT_LABELS = {
  compute: "Uses compute", writes_app_data: "Saves app data", writes_files: "Writes files",
  temporary_files: "Uses temporary files", network: "Uses network", cancels_work: "Cancels work",
  deletes_files: "Can delete files", system_changes: "Can change the system",
};

export function filterTools(tools, { query = "", category = "", interfaceType = "" } = {}) {
  const search = query.trim().toLocaleLowerCase();
  return tools.filter(tool => (!category || tool.category === category)
    && (!interfaceType || tool.interface === interfaceType)
    && (!search || [tool.id, tool.name, tool.description, tool.category, tool.workspace,
      ...(tool.requirements || [])].join(" ").toLocaleLowerCase().includes(search)));
}

export async function fetchToolRegistry({ signal, markdown = false } = {}) {
  const response = await fetch(apiUrl(markdown ? "/tools/registry.md" : "/tools/registry"), {
    cache: "no-store", signal: signal || AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Could not load the tool registry (${response.status}). Restart the app if it was just updated.`);
  if (markdown) return response.text();
  const registry = await response.json();
  if (registry.schema_version !== "1.0" || !Array.isArray(registry.tools)) {
    throw new Error("This tool registry format is not supported. Restart the updated app.");
  }
  return registry;
}
