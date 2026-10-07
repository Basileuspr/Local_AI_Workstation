import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { filterTools, fetchToolRegistry, registryText, toolText, toolTextFilename } from "../../src/toolRegistry";
import ToolRegistry, { ToolRegistryDetails } from "../../src/components/ToolRegistry";
import {WorkspaceHelpContent} from '../../src/components/WorkspaceInfo';

const tools = [
  { id: "knowledge_search", name: "Search knowledge", description: "Find saved text.", category: "Knowledge", workspace: "knowledge", interface: "http", availability: "registered", requirements: ["Ollama embedding model"], effects: ["compute"], output_description: "Source chunks", endpoint: {method: "GET", path: "/files/knowledge-base/query"}, input_schema: {type: "object"} },
  { id: "image_editor_ui", name: "Edit an image", description: "Crop and rotate.", category: "Images", workspace: "image-editor", interface: "ui", availability: "ui_only", requirements: ["Interactive workspace"], effects: ["writes_files"], output_description: "An edited image", endpoint: null },
];

afterEach(() => vi.unstubAllGlobals());

describe("tool discovery", () => {
  it("copies one complete tool contract, preserving schema definitions and notes", () => {
    const schema = { type: "object", properties: { body: { $ref: "#/$defs/Request" } }, $defs: { Request: { type: "object", properties: { query: { type: "string" } } } } };
    const text = toolText({ ...tools[0], input_schema: schema, notes: "Keep source text & references.", endpoint: { ...tools[0].endpoint, content_type: "application/json" } });
    for (const value of [tools[0].name, tools[0].id, "API registered", "Knowledge", "Source chunks", "Ollama embedding model", "Uses compute", "application/json", "Keep source text & references.", JSON.stringify(schema, null, 2)]) expect(text).toContain(value);
    expect(text).not.toContain(tools[1].id);
    expect(toolText(tools[1])).toContain("Interactive workspace");
    expect(toolText(tools[1])).not.toContain("Endpoint:");
  });
  it("exports a plain-text full catalog regardless of the current filters", () => {
    const registry = { schema_version: "1.0", purpose: "Discover tools.", scope: "Curated capabilities.", authentication: {header: "X-LAW-Session", description: "A trusted host supplies the credential."}, usage: ["Discovery never executes tools."], tools };
    expect(filterTools(tools, { category: "Knowledge" })).toHaveLength(1);
    const text = registryText(registry);
    for (const value of ["Schema version: 1.0", registry.purpose, registry.scope, "X-LAW-Session", registry.usage[0], ...tools.map(tool => `ID: ${tool.id}`)]) expect(text).toContain(value);
    expect(text.startsWith("Local AI Workstation tool registry\n")).toBe(true);
    expect(text).not.toContain("```json");
  });
  it("names individual TXT exports by stable IDs without path characters", () => {
    expect(toolTextFilename(tools[0])).toBe("workstation-tool-knowledge_search.txt");
    expect(toolTextFilename({ id: '../path\\name:bad\n' })).not.toMatch(/[\/\\:\n]/);
  });
  it("combines filters and finds IDs, requirements and descriptions", () => {
    expect(filterTools(tools, {query: " EMBEDDING ", category: "Knowledge", interfaceType: "http"})).toEqual([tools[0]]);
    expect(filterTools(tools, {query: "image_editor_ui"})).toEqual([tools[1]]);
    expect(filterTools(tools, {query: "rotate", interfaceType: "http"})).toEqual([]);
    expect(filterTools(tools, {category: "missing"})).toEqual([]);
    expect(filterTools(tools)).toHaveLength(2);
  });
  it("labels schema availability without claiming LLM execution or model readiness", () => {
    const html = renderToStaticMarkup(<ToolRegistryDetails tool={tools[0]} />);
    for (const text of ["API registered", "Ollama embedding model", "Uses compute", "GET", "/files/knowledge-base/query", "Tool input schema"]) expect(html).toContain(text);
    expect(html).not.toContain("Run tool");
    const ui = renderToStaticMarkup(<ToolRegistryDetails tool={tools[1]} />);
    expect(ui).toContain("Interactive workspace");
    expect(ui).not.toContain("API and input schema");
    expect(renderToStaticMarkup(<ToolRegistryDetails />)).toContain("No tools match");
    const hidden = renderToStaticMarkup(<ToolRegistry active={false} />);
    expect(renderToStaticMarkup(<WorkspaceHelpContent tab="dashboard"/>)).toContain("Enable Local model tool use");
    expect(hidden).toContain("Open Dashboard to load");
  });
  it("loads JSON and Markdown and reports HTTP errors", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({schema_version: "1.0", tools})))
      .mockResolvedValueOnce(new Response("# Tools"))
      .mockResolvedValueOnce(new Response("", {status: 503}));
    vi.stubGlobal("fetch", fetch);
    expect((await fetchToolRegistry()).tools).toEqual(tools);
    expect(await fetchToolRegistry({markdown: true})).toBe("# Tools");
    await expect(fetchToolRegistry()).rejects.toThrow("503");
    expect(fetch.mock.calls[0][0]).toContain("/tools/registry");
    expect(fetch.mock.calls[1][0]).toContain("/tools/registry.md");
    expect(fetch.mock.calls.every(([, options]) => options.cache === "no-store")).toBe(true);
  });
  it("rejects incompatible data rather than crashing the Dashboard", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({schema_version: "2", tools: []}))));
    await expect(fetchToolRegistry()).rejects.toThrow("format is not supported");
  });
});
