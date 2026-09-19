import { describe, expect, it, vi, afterEach } from "vitest";
import { imageSourceOptions, newStage, parseSource, promptSettingsOnly, workflowUpdate } from "../../src/imageWorkflow";
import * as api from "../../src/imageWorkflowApi";

const workflow = {
  id: "workflow", revision: 3, name: "Scene", scene_notes: "Keep the coat",
  prompt_settings: { prompt: "rain", negative_prompt: "blur", seed: 8, steps: 25, guidance: 4, model: "must not leak" },
  assets: [{ id: "asset", name: "Coat.png" }],
  stages: [{ id: "text", operation: "describe" }, { id: "image", operation: "img2img" }, { id: "future", operation: "upscale" }],
};

afterEach(() => vi.unstubAllGlobals());

describe("image workflow contracts", () => {
  it("keeps prompt profiles to exactly five fields", () => {
    expect(promptSettingsOnly(workflow.prompt_settings)).toEqual({ prompt: "rain", negative_prompt: "blur", seed: 8, steps: 25, guidance: 4 });
    expect(Object.keys(promptSettingsOnly())).toHaveLength(5);
  });
  it("does not send server-owned assets, identity or lineage in draft saves", () => {
    expect(Object.keys(workflowUpdate(workflow))).toEqual(["revision", "name", "scene_notes", "prompt_settings", "stages"]);
  });
  it("offers owned assets and only earlier image outputs", () => {
    expect(imageSourceOptions(workflow, 2).map(option => option.value)).toEqual(["asset:asset", "stage:image"]);
    expect(parseSource("stage:image")).toEqual({ kind: "stage", id: "image" });
    expect(parseSource("")).toBeNull();
  });
  it("starts new stages from the last image output, not description text", () => {
    const result = newStage({ ...workflow, stages: workflow.stages.slice(0, 2).reverse() }, "upscale");
    expect(result.source).toEqual({ kind: "stage", id: "image" });
    expect(result.provider_slot).toBe("");
    expect(result.id).toMatch(/^[0-9a-f]{32}$/);
  });
  it("falls back to an uploaded source, or explicitly no source", () => {
    expect(newStage({ ...workflow, stages: [] }, "img2img").source).toEqual({ kind: "asset", id: "asset" });
    expect(newStage({ ...workflow, stages: [], assets: [] }, "img2img").source).toBeNull();
  });
  it("prepares a revision-bound snapshot without calling generation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "blocked" }) });
    vi.stubGlobal("fetch", fetchMock);
    await api.prepare(workflow);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/image-workflows\/workflow\/jobs$/);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ revision: 3 });
  });
  it("exposes backend validation and conflict errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ detail: [{ loc: ["body", "name"], msg: "Required" }] }) }));
    await expect(api.save(workflow)).rejects.toThrow("name: Required");
  });
});
