import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { KNOWLEDGE_NODE_KINDS, knowledgeNodeDraft, newKnowledgeNodeDraft } from "../../src/knowledgeNodes";
import { KnowledgeNodeForm, KnowledgeNodeContent } from "../../src/components/KnowledgeNodeComposer";

it("supports general node kinds and a title-only draft", () => {
  expect(KNOWLEDGE_NODE_KINDS.map(kind => kind.value)).toEqual(["note", "character", "idea", "project", "place", "event", "reference"]);
  expect(knowledgeNodeDraft({ title: " Topic ", kind: "note", text: "" })).toEqual({ title: "Topic", kind: "note", text: "" });
  for (const draft of [{ title: " ", kind: "note", text: "" }, { title: "x", kind: "unknown", text: "" }, { title: "x", kind: "note", text: "x".repeat(100001) }]) expect(() => knowledgeNodeDraft(draft)).toThrow();
});

it("renders editable details with escaped content and keeps the character workflow optional", () => {
  const markup = renderToStaticMarkup(<KnowledgeNodeForm draft={{title:'Untitled node',kind:'note',text:''}} submitLabel="Save content" />);
  expect(markup).toContain("Untitled node"); expect(markup).toContain("Save content");
  expect(markup).toContain("Node content"); expect(markup).toContain('value="place"');
  expect(markup).not.toContain("Choose a saved character");
  const form = renderToStaticMarkup(<KnowledgeNodeForm draft={{ title: "<script>Title</script>", kind: "note", text: "<img src=x>" }} submitLabel="Save content" />);
  expect(form).not.toContain("<script>"); expect(form).not.toContain("<img");
  expect(form).toContain("&lt;img");
});
it('starts an empty persisted node before choosing criteria and opens its detail editor', () => {
  expect(newKnowledgeNodeDraft()).toEqual({title:'Untitled node',kind:'note',text:''});
  expect(newKnowledgeNodeDraft([{node_title:'Untitled node'},{options:{label:'Untitled node 2'}}]).title).toBe('Untitled node 3');
  const markup=renderToStaticMarkup(<KnowledgeNodeContent node={{doc_id:'new'}} active initiallyOpen />);
  expect(markup).toContain('open=""'); expect(markup).toContain('Loading node content');
});
it('adapts to a character type and clears profile association when saving another type', () => {
  const id='a'.repeat(32), draft={title:'Mara',kind:'character',text:'Explorer',character_id:id};
  expect(knowledgeNodeDraft(draft)).toEqual(draft);
  expect(knowledgeNodeDraft({...draft,kind:'idea'})).toEqual({title:'Mara',kind:'idea',text:'Explorer'});
  expect(()=>knowledgeNodeDraft({...draft,character_id:'../bad'})).toThrow('saved character');
  expect(knowledgeNodeDraft({...draft,character_id:''}).kind).toBe('character');
  const markup=renderToStaticMarkup(<KnowledgeNodeForm draft={draft} submitLabel="Save content" />);
  expect(markup).toContain('Linked character profile'); expect(markup).toContain('Character notes');
  const other=renderToStaticMarkup(<KnowledgeNodeForm draft={{...draft,kind:'project'}} submitLabel="Save content" />);
  expect(other).not.toContain('Linked character profile'); expect(other).toContain('Goals, plans, tasks');
});
