import { apiUrl } from "./api";
import { appTabLabels } from "./navigation";

export const TOOL_EFFECT_LABELS = {
  compute: "Uses compute", writes_app_data: "Saves app data", writes_files: "Writes files",
  temporary_files: "Uses temporary files", network: "Uses network", cancels_work: "Cancels work",
  deletes_files: "Can delete files", system_changes: "Can change the system",
};

export const TOOL_AVAILABILITY_LABELS = { registered: "API registered", ui_only: "Interactive workspace", unavailable: "API unavailable" };

export function toolText(tool) {
  const lines = [tool.name, `ID: ${tool.id}`, "", tool.description, "",
    `Category: ${tool.category}`, `Workspace: ${appTabLabels[tool.workspace] || tool.workspace}`,
    `Access: ${tool.interface === "http" ? "Backend API" : "Interactive workspace"}`,
    `Availability: ${TOOL_AVAILABILITY_LABELS[tool.availability] || "Unknown status"}`,
    "Local LLM execution: not connected.", `Returns: ${tool.output_description}`,
    `Requirements: ${tool.requirements?.length ? tool.requirements.join("; ") : "Running local backend"}`,
    `Effects: ${tool.effects?.length ? tool.effects.map(effect => TOOL_EFFECT_LABELS[effect] || effect).join("; ") : "Reads app information"}`];
  if (tool.notes) lines.push(`Notes: ${tool.notes}`);
  if (tool.endpoint) {
    lines.push("", `Endpoint: ${tool.endpoint.method} ${tool.endpoint.path}`);
    if (tool.endpoint.content_type) lines.push(`Request content type: ${tool.endpoint.content_type}`);
    if (tool.input_schema) lines.push("Input schema:", JSON.stringify(tool.input_schema, null, 2));
  }
  return lines.join("\n") + "\n";
}

export function registryText(registry) {
  const lines = ["Local AI Workstation tool registry", `Schema version: ${registry.schema_version}`, "", registry.purpose, registry.scope, ""];
  if (registry.authentication) lines.push(`Authentication: ${registry.authentication.header || registry.authentication.type}. ${registry.authentication.description || ""}`, "");
  lines.push(...(registry.usage || []), "");
  return lines.filter(line => line != null).join("\n") + registry.tools.map(toolText).join("\n--------------------\n\n");
}

export function toolTextFilename(tool) {
  return `workstation-tool-${String(tool.id).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100)}.txt`;
}

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
