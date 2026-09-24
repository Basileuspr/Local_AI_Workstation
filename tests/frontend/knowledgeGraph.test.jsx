import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi, afterEach } from "vitest";
import { layoutKnowledgeGraph, fitKnowledgeGraph } from "../../src/knowledgeGraph";
import KnowledgeGraph from "../../src/components/KnowledgeGraph";
import { knowledgeGraphRequest } from "../../src/api";

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
