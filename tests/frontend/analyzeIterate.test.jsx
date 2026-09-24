import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { parsePromptProposal, promptsMatch, readPromptProposal } from "../../src/promptIteration";
import { sceneDraftFromAnalysis } from "../../src/sceneIteration";
import { reducer } from "../../src/useStore";
import { streamChat } from "../../src/api";
import { importSource } from "../../src/imageWorkflowApi";
import { sourceFor } from "../../src/imageLibraryApi";
import ImageViewer from "../../src/components/ImageViewer";

afterEach(() => vi.unstubAllGlobals());
const proposal = { analysis: "Change only the viewpoint", prompt: "mira_token, side view", negative_prompt: "blur" };

it("reads a fragmented streamed revision through completion and rejects incomplete or cancelled output", async () => {
  const body = `data: ${JSON.stringify({ token: JSON.stringify(proposal), done: true })}\n\n`;
  const stream = chunks => new Response(new ReadableStream({ start(controller) {
    chunks.forEach(chunk => controller.enqueue(new TextEncoder().encode(chunk))); controller.close();
  } }));
  expect(await readPromptProposal(stream([body.slice(0, 15), body.slice(15, 52), body.slice(52)]))).toEqual({ analysis: proposal.analysis, prompt: proposal.prompt, negativePrompt: "blur" });
  await expect(readPromptProposal(stream([`data: ${JSON.stringify({ token: JSON.stringify(proposal) })}`]))).rejects.toThrow("before the revision was complete");
  await expect(readPromptProposal(stream(['data: {"cancelled":true,"done":true}\n\n']))).rejects.toMatchObject({ name: "AbortError" });
});

it("invalid model output cannot replace current prompts", () => {
  expect(() => parsePromptProposal("Try a side view")).toThrow("usable prompt revision");
  expect(() => parsePromptProposal('{"analysis":"", "prompt":""}')).toThrow("incomplete");
  expect(parsePromptProposal("```json\n" + JSON.stringify(proposal) + "\n```").prompt).toContain("mira_token");
  const settings = { prompt: "mira_token portrait", negativePrompt: "blur", modelId: "sdxl", loraId: "adapter", loraScale: 0, seed: 42, width: 1024, steps: 35 };
  const before = { imageSettings: settings, activeCustomProfileId: "", activeSidebarTab: "generate", conversationHistory: [{ id: "chat" }] };
  const after = reducer(before, { type: "SET_IMAGE_SETTINGS", payload: { prompt: proposal.prompt, negativePrompt: proposal.negative_prompt } });
  expect(after.imageSettings).toEqual({ ...settings, prompt: proposal.prompt });
  expect(after.conversationHistory).toBe(before.conversationHistory);
  expect(promptsMatch(after.imageSettings, settings)).toBe(false);
  expect(promptsMatch({ ...settings, seed: 123 }, settings)).toBe(true);
});

it("analyzes prompts without a chat session, knowledge retrieval or durable memory", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("data: {}\n\n")); vi.stubGlobal("fetch", fetch);
  await streamChat({ model: "local", messages: [], useMemory: false, useKnowledgeBase: false, requestId: "analysis" });
  const sent = JSON.parse(fetch.mock.calls[0][1].body);
  expect(sent).toMatchObject({ use_memory: false, use_knowledge_base: false, request_id: "analysis" });
  expect(sent.session_id).toBeUndefined();
});

it("imports typed library, chat and stitched references with revision checks", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }); vi.stubGlobal("fetch", fetch);
  const image = { id: "w:j:grid", name: "Stitched grid", layout: "grid", run: { workflow_id: "w", id: "j" } };
  await importSource({ id: "target", revision: 7 }, sourceFor(image));
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ revision: 7, source: { kind: "workflow", workflow_id: "w", job_id: "j", layout: "grid", name: image.name } });
  expect(sourceFor({ library: true, id: "saved", session_id: "origin" })).toEqual({ kind: "library", id: "saved" });
  expect(sourceFor({ id: "s:m:i", session_id: "s", message_id: "m", image_id: "i", name: "Chat" })).toMatchObject({ kind: "session", image_id: "i" });
});

it("opens an editable source scene without applying suggested future actions or disturbing Generate", () => {
  const asset = { id: "source", name: "Photo.png", width: 1536, height: 1024 };
  const workflow = { id: "w", revision: 4, assets: [asset], prompt_settings: { seed: -1 }, stages: [{ operation: "describe" }] };
  const analysis = { state: { current_action: "holding a cup" }, observations: "Seated figure", uncertainties: ["Hand obscured"], suggestions: ["Raise the cup"] };
  const draft = sceneDraftFromAnalysis(workflow, analysis, "sdxl");
  expect(draft.scene).toMatchObject({ state: analysis.state, source_asset_id: "source", model_id: "sdxl", width: 1024, height: 680, denoise: .25 });
  expect(draft.scene_notes).toContain("Possible next step (not applied): Raise the cup");
  expect(workflow.stages[0].operation).toBe("describe");
  const before = { imageSettings: { prompt: "Generate draft" }, activeSidebarTab: "images" };
  const after = reducer(before, { type: "OPEN_ITERATIVE_SCENE", payload: "w" });
  expect(after).toMatchObject({ activeSidebarTab: "workflows", sceneToOpen: "w", imageSettings: before.imageSettings });
  expect(reducer(after, { type: "ITERATIVE_SCENE_OPENED", payload: "older" })).toBe(after);
  expect(reducer(after, { type: "ITERATIVE_SCENE_OPENED", payload: "w" }).sceneToOpen).toBeNull();
});

it("exposes the library action only when a scene handoff is supplied", () => {
  const props = { images: [{ id: "i", name: "Scene", url: "/image" }], selectedId: "i" };
  expect(renderToStaticMarkup(<ImageViewer {...props} onAnalyze={() => {}} />)).toContain("Analyze &amp; Iterate");
  expect(renderToStaticMarkup(<ImageViewer {...props} />)).not.toContain("Analyze &amp; Iterate");
});
