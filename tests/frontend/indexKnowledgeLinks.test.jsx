import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IndexEntryKnowledgeLinks } from "../../src/components/IndexKnowledgeLinks";
import { appTabLabels } from "../../src/navigation";
import { functionTargets } from "../../src/functionButtons";
import { indexKnowledgeLinksRequest } from "../../src/api";

afterEach(() => vi.unstubAllGlobals());
const entry = { id: "e", title: "A reference" };
const catalog = { loaded: true, links: [{ entry_id: "e", doc_id: "a", node_label: "Project hub" }],
  nodes: [{ doc_id: "a", label: "Project hub" }, { doc_id: "b", label: "Research" }] };

it("calls the workspace Index while retaining its existing navigation identity", () => {
  expect(appTabLabels.library).toBe("Index");
  expect(functionTargets.find(item => item.id === "library").name).toBe("Index");
});
it("shows connected nodes and offers only remaining destinations", () => {
  const html = renderToStaticMarkup(<IndexEntryKnowledgeLinks entry={entry} catalog={catalog} />);
  expect(html).toContain("Knowledge connections · 1");
  expect(html).toContain('aria-label="Unlink Project hub from A reference"');
  expect(html).toContain('<option value="b">Research</option>');
  expect(html).not.toContain('<option value="a">');
  expect(html).toContain("Its content stays in Index.");
});
it("explains an empty Knowledge vault and escapes saved labels", () => {
  const empty = renderToStaticMarkup(<IndexEntryKnowledgeLinks entry={entry} catalog={{ loaded: true, links: [], nodes: [] }} />);
  expect(empty).toContain("Open Knowledge");
  const unsafe = renderToStaticMarkup(<IndexEntryKnowledgeLinks entry={entry} catalog={{ ...catalog, links: [{ entry_id: "e", doc_id: "a", node_label: "<img src=x>" }] }} />);
  expect(unsafe).toContain("&lt;img src=x&gt;"); expect(unsafe).not.toContain("<img");
});
it("sends explicit IDs and propagates link errors", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetch);
  await indexKnowledgeLinksRequest({}, "POST", { entry_id: "e", doc_id: "a" });
  expect(fetch.mock.calls[0][0]).toContain("/prompt-index/knowledge-links");
  expect(fetch.mock.calls[0][1].body).toBe('{"entry_id":"e","doc_id":"a"}');
  await indexKnowledgeLinksRequest({ doc_id: "node & id" });
  expect(fetch.mock.calls[1][0]).toContain("doc_id=node+%26+id");
  fetch.mockResolvedValue({ ok: false, json: async () => ({ detail: "Knowledge node no longer exists" }) });
  await expect(indexKnowledgeLinksRequest({}, "POST", {})).rejects.toThrow("Knowledge node no longer exists");
});
