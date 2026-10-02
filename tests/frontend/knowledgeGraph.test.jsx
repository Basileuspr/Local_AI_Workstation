import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi, afterEach } from "vitest";
import { layoutKnowledgeGraph, fitKnowledgeGraph } from "../../src/knowledgeGraph";
import KnowledgeGraph from "../../src/components/KnowledgeGraph";
import { knowledgeGraphRequest } from "../../src/api";
import { nodeMatches, nodeRadius, nodeLabel, nodeOptions, nodeAppearancePreset, NODE_PRESETS } from "../../src/knowledgeNodeOptions";
import KnowledgeNodeEditor from "../../src/components/KnowledgeNodeEditor";
import KnowledgeNodeSymbol from "../../src/components/KnowledgeNodeSymbol";

afterEach(() => vi.unstubAllGlobals());
const nodes = [{ doc_id: "a", filename: "Plan.md", chunks: 4 }, { doc_id: "b", filename: "Budget.md", chunks: 3 }, { doc_id: "c", filename: "Other.txt", chunks: 1, position: { x: 10, y: 20 } }];
const edges = [{ source: "a", target: "b", kinds: ["wikilink"] }];

it("keeps saved positions and fits isolated and connected documents", () => {
  const positions = layoutKnowledgeGraph(nodes, edges);
  expect(positions.c).toEqual({ x: 10, y: 20 });
  expect(positions.a).not.toEqual(positions.b);
  const camera = fitKnowledgeGraph(positions);
  for (const point of Object.values(positions)) {
    expect(point.x * camera.zoom + camera.x).toBeGreaterThan(0);
    expect(point.y * camera.zoom + camera.y).toBeLessThan(800);
  }
  expect(fitKnowledgeGraph({})).toEqual({ x: 600, y: 400, zoom: 1 });
});

it("renders accessible nodes, actual edges and empty-state guidance", () => {
  const markup = renderToStaticMarkup(<KnowledgeGraph nodes={nodes} edges={edges} onSelect={() => {}} onPosition={() => {}} selectedId="a" />);
  expect(markup).toContain('aria-label="Open Plan.md"');
  expect(markup).toContain('aria-pressed="true"');
  expect(markup).toContain('class="wikilink"');
  expect(markup).toContain('role="button" tabindex="0"');
  expect(markup).toContain('aria-roledescription="Rotatable 3D graph"');
  expect(markup).toContain('aria-label="Rotate left"');
  expect(markup).toContain('data-world-z=');
  expect(renderToStaticMarkup(<KnowledgeGraph nodes={[]} edges={[]} />)).toContain("Add documents to start your vault");
});

it("does not render imported filenames as HTML", () => {
  const markup = renderToStaticMarkup(<KnowledgeGraph nodes={[{ doc_id: "bad", filename: '<img src=x onerror="alert(1)">', chunks: 1 }]} edges={[]} />);
  expect(markup).not.toContain("<img");
  expect(markup).toContain("&lt;img");
});

it("surfaces backend graph errors instead of treating them as an empty vault", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ detail: "Document no longer exists" }) }));
  await expect(knowledgeGraphRequest("/links", "POST", { source: "a", target: "b" })).rejects.toThrow("Document no longer exists");
});

it("renders custom shapes, labels, icons and locking while retaining accessible hidden labels", () => {
  const custom = { ...nodes[0], options: { label: "Research", shape: "hexagon", color: "#edc66b", icon: "star", size_mode: "fixed", size: 40, border: "dashed", locked: true, label_mode: "hidden" } };
  const markup = renderToStaticMarkup(<KnowledgeGraph nodes={[custom]} edges={[]} selectedId="a" />);
  expect(markup).toContain('<polygon class="vault-node-shape"');
  expect(markup).toContain("fill:#edc66b");
  expect(markup).toContain("stroke-dasharray:5 3");
  expect(markup).toContain("★");
  expect(markup).toContain('aria-label="Open Research (position locked)"');
  expect(markup).not.toContain('y="59"');
  expect(nodeRadius(custom)).toBe(40);
  expect(nodeRadius(nodes[0])).toBe(14);
});

it("searches saved display names, filenames, tags and notes and escapes all custom text", () => {
  const custom = { ...nodes[0], options: { label: "<script>Research</script>", tags: ["favorite"], note: "My planning reference" } };
  for (const query of ["research", "plan.md", " FAVORITE ", "reference"]) expect(nodeMatches(custom, query)).toBe(true);
  expect(nodeMatches(custom, "missing")).toBe(false);
  expect(nodeLabel(nodes[0])).toBe("Plan.md");
  const markup = renderToStaticMarkup(<KnowledgeGraph nodes={[custom]} edges={[]} />);
  expect(markup).not.toContain("<script>");
  expect(markup).toContain("&lt;script&gt;");
  const editor = renderToStaticMarkup(<KnowledgeNodeEditor node={custom} />);
  expect(editor).toContain("Customize node");
  expect(editor).toContain("Lock position");
  expect(editor).not.toContain("<script>");
});

it("provides a persistent symbol control outside the collapsed appearance editor", () => {
  expect(nodeOptions(nodes[0]).icon).toBe("document");
  expect(nodeOptions({ options: { icon: "none" } }).icon).toBe("none");
  for (const preset of NODE_PRESETS) {
    const result = { ...nodeOptions({ options: { icon: "book" } }), ...nodeAppearancePreset(preset) };
    expect(result.icon).toBe("book");
    expect(result.shape).toBe(preset.shape);
  }
  const symbol = renderToStaticMarkup(<KnowledgeNodeSymbol node={{ ...nodes[0], options: { icon: "star" } }} />);
  expect(symbol).toContain("Node symbol");
  expect(symbol).toContain('value="star" selected=""');
  expect(symbol).toContain("Saves automatically");
  const editor = renderToStaticMarkup(<KnowledgeNodeEditor node={nodes[0]} />);
  expect(editor).toContain('<details class="vault-node-editor">');
  expect(editor).not.toContain("Node symbol");
});
