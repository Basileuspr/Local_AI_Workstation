import { useEffect, useRef, useState } from "react";
import { appTabLabels } from "../navigation";
import { downloadBlob } from "../downloadBlob";
import { fetchToolRegistry, filterTools, registryText, toolText, toolTextFilename, TOOL_AVAILABILITY_LABELS, TOOL_EFFECT_LABELS } from "../toolRegistry";
import "./ToolRegistry.css";

const availabilityLabels = TOOL_AVAILABILITY_LABELS;

export function ToolRegistryDetails({ tool, onDownloadText, exporting }) {
  if (!tool) return <p className="tool-registry-empty">No tools match these filters.</p>;
  return <article className="tool-registry-detail" aria-label={`${tool.name} details`}>
    <div className="tool-registry-meta"><span>{tool.category}</span><span>{availabilityLabels[tool.availability] || "Unknown status"}</span></div>
    <h3>{tool.name}</h3><code className="tool-registry-id">{tool.id}</code>
    {onDownloadText && <button className="tool-registry-item-download" type="button" disabled={exporting} onClick={() => onDownloadText(tool)} aria-label={`Download TXT for ${tool.name}`}>Download item TXT</button>}
    <p>{tool.description}</p>
    <dl>
      <dt>Workspace</dt><dd>{appTabLabels[tool.workspace] || tool.workspace}</dd>
      <dt>Returns</dt><dd>{tool.output_description}</dd>
      <dt>Requirements</dt><dd>{tool.requirements.length ? tool.requirements.join(" · ") : "Running local backend"}</dd>
      <dt>Effects</dt><dd>{tool.effects.length ? tool.effects.map(effect => TOOL_EFFECT_LABELS[effect] || effect).join(" · ") : "Reads app information"}</dd>
      <dt>Local model execution</dt><dd>{tool.execution?.reason || 'Use its workspace.'}</dd>
    </dl>
    {tool.notes && <p className="tool-registry-note">{tool.notes}</p>}
    {tool.endpoint && <details className="tool-registry-contract"><summary>API and input schema</summary>
      <p><code>{tool.endpoint.method} {tool.endpoint.path}</code></p>
      {tool.endpoint.content_type && <p>Request: <code>{tool.endpoint.content_type}</code></p>}
      <pre tabIndex={0} aria-label="Tool input schema">{JSON.stringify(tool.input_schema, null, 2)}</pre>
    </details>}
  </article>;
}

export default function ToolRegistry({ active = true }) {
  const [registry, setRegistry] = useState(null), [loading, setLoading] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [reload, setReload] = useState(0);
  const [query, setQuery] = useState(""), [category, setCategory] = useState(""), [interfaceType, setInterfaceType] = useState("");
  const [selected, setSelected] = useState(""), [exporting, setExporting] = useState(false);
  const exportLock = useRef(false);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let current = true;
    setLoading(true); setError("");
    fetchToolRegistry({ signal: controller.signal }).then(value => {
      if (current) setRegistry(value);
    }).catch(failure => {
      if (current) setError(failure.name === "AbortError" ? "The tool registry request timed out. Try Refresh." : failure.message);
    }).finally(() => { clearTimeout(timeout); if (current) setLoading(false); });
    return () => { current = false; clearTimeout(timeout); controller.abort(); };
  }, [active, reload]);

  async function exportRegistry(kind, tool = null) {
    if (!registry || exportLock.current) return;
    exportLock.current = true; setExporting(true); setNotice("");
    try {
      if (tool) {
        if (kind === "copy") {
          await navigator.clipboard.writeText(toolText(tool));
          setNotice(`Copied ${tool.name}.`);
        } else {
          downloadBlob(new Blob([toolText(tool)], { type: "text/plain;charset=utf-8" }), toolTextFilename(tool));
          setNotice(`TXT download prepared for ${tool.name}.`);
        }
      } else if (kind === "txt") {
        downloadBlob(new Blob([registryText(registry)], { type: "text/plain;charset=utf-8" }), "workstation-tool-registry.txt");
        setNotice("Full TXT catalog download prepared.");
      } else if (kind === "json") {
        downloadBlob(new Blob([JSON.stringify(registry, null, 2) + "\n"], { type: "application/json" }), "workstation-tool-registry.json");
        setNotice("Full JSON registry download prepared.");
      } else {
        const markdown = await fetchToolRegistry({ markdown: true });
        if (kind === "copy") {
          await navigator.clipboard.writeText(markdown);
          setNotice("Full tool catalog copied for the local LLM.");
        } else {
          downloadBlob(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), "workstation-tool-registry.md");
          setNotice("Full Markdown catalog download prepared.");
        }
      }
    } catch (failure) {
      setNotice(kind === "copy" ? `Could not copy ${tool ? tool.name : "the catalog"}. Try ${tool ? "Download item TXT" : "Download TXT"}. ${failure.message}` : failure.message);
    } finally { exportLock.current = false; setExporting(false); }
  }

  const tools = registry?.tools || [];
  const categories = [...new Set(tools.map(tool => tool.category))].sort();
  const matches = filterTools(tools, { query, category, interfaceType });
  const selectedTool = matches.find(tool => tool.id === selected) || matches[0];
  return <section className="dashboard-card tool-registry" aria-labelledby="tool-registry-heading">
    <header className="tool-registry-header">
      <div><h2 id="tool-registry-heading">Tool registry</h2></div>
      <button type="button" onClick={() => setReload(value => value + 1)} disabled={loading || !active}>{loading ? "Loading…" : "Refresh"}</button>
    </header>

    {error && <p className="tool-registry-error" role="alert">{error}{registry ? " Showing the last loaded catalog." : ""}</p>}
    {!registry && !error && <p role="status">{active ? "Loading tool catalog…" : "Open Dashboard to load the tool catalog."}</p>}
    {registry && <>
      <div className="tool-registry-filters">
        <label>Search tools<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, purpose or requirement…" /></label>
        <label>Category<select value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Access<select value={interfaceType} onChange={event => setInterfaceType(event.target.value)}><option value="">All tools</option><option value="http">Backend API</option><option value="ui">Interactive workspace</option></select></label>
      </div>
      <p className="tool-registry-count" role="status">{matches.length} of {tools.length} tools · Schema {registry.schema_version}</p>
      <div className="tool-registry-browser">
        <ul className="tool-registry-list" aria-label="Registered tools">{matches.map(tool => <li key={tool.id}>
          <button className="tool-registry-select" type="button" aria-pressed={selectedTool?.id === tool.id} onClick={() => setSelected(tool.id)}>
            <strong>{tool.name}</strong><span>{tool.category} · {availabilityLabels[tool.availability] || "Unknown status"}</span>
          </button>
          <button className="tool-registry-copy" type="button" disabled={exporting} aria-label={`Copy ${tool.name}`} onClick={() => exportRegistry("copy", tool)}>Copy</button>
        </li>)}</ul>
        <ToolRegistryDetails tool={selectedTool} exporting={exporting} onDownloadText={tool => exportRegistry("txt", tool)} />
      </div>
      <div className="tool-registry-exports" aria-label="Export full tool registry">
        <button type="button" disabled={exporting} onClick={() => exportRegistry("copy")}>Copy catalog for LLM</button>
        <button type="button" disabled={exporting} onClick={() => exportRegistry("json")}>Download JSON</button>
        <button type="button" disabled={exporting} onClick={() => exportRegistry("markdown")}>Download Markdown</button>
        <button type="button" disabled={exporting} onClick={() => exportRegistry("txt")}>Download TXT</button>
      </div>

      <p className="tool-registry-feedback" role="status">{exporting ? "Preparing export…" : notice}</p>
    </>}
  </section>;
}
