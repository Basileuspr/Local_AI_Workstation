import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { KNOWLEDGE_NODE_KINDS, knowledgeNodeDraft } from "../../src/knowledgeNodes";
import KnowledgeNodeComposer, { KnowledgeNodeForm } from "../../src/components/KnowledgeNodeComposer";

it("supports general node kinds and a title-only draft", () => {
  expect(KNOWLEDGE_NODE_KINDS.map(kind => kind.value)).toEqual(["note", "idea", "project", "place", "event", "reference"]);
  expect(knowledgeNodeDraft({ title: " Topic ", kind: "note", text: "" })).toEqual({ title: "Topic", kind: "note", text: "" });
  for (const draft of [{ title: " ", kind: "note", text: "" }, { title: "x", kind: "unknown", text: "" }, { title: "x", kind: "note", text: "x".repeat(100001) }]) expect(() => knowledgeNodeDraft(draft)).toThrow();
});

it("renders creation inside Knowledge with escaped content and keeps the character workflow optional", () => {
  const markup = renderToStaticMarkup(<KnowledgeNodeComposer open />);
  expect(markup).toContain("Start a node"); expect(markup).toContain("Create node");
  expect(markup).toContain("Node content"); expect(markup).toContain('value="place"');
  expect(markup).not.toContain("Choose a saved character");
  const form = renderToStaticMarkup(<KnowledgeNodeForm draft={{ title: "<script>Title</script>", kind: "note", text: "<img src=x>" }} submitLabel="Save content" />);
  expect(form).not.toContain("<script>"); expect(form).not.toContain("<img");
  expect(form).toContain("&lt;img");
});
