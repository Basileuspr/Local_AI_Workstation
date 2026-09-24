import { describe, expect, it, vi } from "vitest";
import { defaultImageSettings } from "../../src/preferences";
import { generateImageForSession, imageRequest, reconcileImageLora, validateImageSelection } from "../../src/chatImageGeneration";

const settings = { ...defaultImageSettings, modelId: "image-model", loraId: "image-lora", loraScale: "0.65", prompt: "  A forest  ", negativePrompt: "text", seed: "0" };
function setup() {
  const api = {
    createSession: vi.fn().mockResolvedValue({ id: "new-chat" }),
    appendSessionMessages: vi.fn(async (id, messages) => ({ id, messages })),
    generateImage: vi.fn().mockResolvedValue({ filename: "forest.png", image_ref: "blob:forest" }),
  };
  const controller = new AbortController();
  return { api, controller, args: { api, settings, sessionId: "source-chat", chatModel: "text-model", requestId: "image-request", signal: controller.signal } };
}

describe("images submitted from chat or Generate", () => {
  it.each([[61, 20.1], [200, 30]])("submits %i steps and %f guidance without clamping", async (steps, guidanceScale) => {
    const draft = { ...settings, steps: String(steps), guidanceScale: String(guidanceScale) };
    const catalog = { models: [{ id: "image-model" }], loras: [{ id: "image-lora", base_model_id: "image-model" }], runtime: { ready: true } };
    expect(() => validateImageSelection(draft, catalog)).not.toThrow();
    const { api, args } = setup();
    await generateImageForSession({ ...args, settings: draft });
    expect(api.generateImage.mock.calls[0][0]).toMatchObject({ steps, guidance_scale: guidanceScale, seed: 0, lora_scale: 0.65 });
  });
  it.each([["steps", 201], ["steps", 200.5], ["guidanceScale", 30.1], ["guidanceScale", Infinity]])("rejects invalid %s = %s before submission", (key, value) => {
    const catalog = { models: [{ id: "image-model" }], loras: [], runtime: { ready: true } };
    expect(() => validateImageSelection({ ...settings, loraId: "", [key]: value }, catalog)).toThrow("through");
  });
  it("submits base-model images with no adapters and ignores unused saved LoRA strength", async () => {
    const base = { ...settings, loraId: "", loraScale: "invalid old value" };
    const catalog = { models: [{ id: "image-model" }], loras: [], runtime: { ready: true } };
    expect(() => validateImageSelection(base, catalog)).not.toThrow();
    const { api, args } = setup();
    await generateImageForSession({ ...args, settings: base });
    expect(api.generateImage.mock.calls[0][0]).toMatchObject({ model_id: "image-model", lora_id: null, lora_scale: 1 });
    expect(api.appendSessionMessages).toHaveBeenCalledTimes(2);
  });
  it("recovers an unavailable saved adapter without requiring another LoRA", () => {
    const catalog = { models: [{ id: "image-model" }], loras: [], runtime: { ready: true } };
    const recovered = reconcileImageLora(settings, catalog);
    expect(recovered).toEqual({ ...settings, loraId: "" });
    expect(settings.loraId).toBe("image-lora");
    expect(() => validateImageSelection(recovered, catalog)).not.toThrow();
    expect(reconcileImageLora(settings, { ...catalog, loras: [{ id: "image-lora", base_model_id: "other" }] }).loraId).toBe("");
    expect(reconcileImageLora(settings, { ...catalog, loras: [{ id: "image-lora", base_model_id: "image-model" }] })).toBe(settings);
  });
  it("retains saved adapters during pending or failed discovery while allowing explicit base-model generation", () => {
    const catalog = { models: [{ id: "image-model" }], loras: [], runtime: { ready: true }, loraError: "Cannot read adapters" };
    expect(reconcileImageLora(settings, { models: [], loras: [] })).toBe(settings);
    expect(reconcileImageLora(settings, catalog)).toBe(settings);
    expect(() => validateImageSelection(settings, catalog)).toThrow("Choose None");
    expect(() => validateImageSelection({ ...settings, loraId: "" }, catalog)).not.toThrow();
  });
  it("uses the image model, compatible LoRA strength and Generate settings", () => {
    expect(imageRequest(settings, "request")).toMatchObject({ model_id: "image-model", lora_id: "image-lora", lora_scale: 0.65, seed: 0, prompt: "A forest", negative_prompt: "text", width: 1024 });
    expect(imageRequest({ ...settings, seed: "", loraId: "" }, "request")).toMatchObject({ seed: null, lora_id: null });
    const catalog = { models: [{ id: "image-model" }], loras: [{ id: "image-lora", base_model_id: "other-model" }], runtime: { ready: true } };
    expect(() => validateImageSelection(settings, catalog)).toThrow("compatible");
    expect(() => validateImageSelection({ ...settings, loraId: "" }, catalog)).not.toThrow();
    expect(() => validateImageSelection({ ...settings, modelId: "text-model" }, catalog)).toThrow("image model");
    expect(() => validateImageSelection({ ...settings, prompt: " " }, catalog)).toThrow("description");
  });
  it("keeps results in the submitting chat when navigation changes during inference", async () => {
    const { api, args } = setup();
    let finish;
    api.generateImage.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const submitted = vi.fn();
    const run = generateImageForSession({ ...args, onSubmitted: submitted });
    await vi.waitFor(() => expect(submitted).toHaveBeenCalled());
    args.sessionId = "another-chat";
    finish({ filename: "forest.png", image_ref: "blob:forest" });
    await run;
    expect(api.createSession).not.toHaveBeenCalled();
    expect(api.appendSessionMessages.mock.calls.map((call) => call[0])).toEqual(["source-chat", "source-chat"]);
    expect(api.appendSessionMessages.mock.calls[1][1][0].generatedImages[0].src).toBe("blob:forest");
    expect(api.generateImage.mock.calls[0][0].model_id).toBe("image-model");
  });
  it("does not start image inference when stopped during session preparation", async () => {
    const { api, controller, args } = setup();
    api.createSession.mockImplementation(async () => { controller.abort(); return { id: "new-chat" }; });
    await expect(generateImageForSession({ ...args, sessionId: null })).rejects.toMatchObject({ name: "AbortError" });
    expect(api.appendSessionMessages).not.toHaveBeenCalled();
    expect(api.generateImage).not.toHaveBeenCalled();
  });
  it("does not resurrect a deleted chat or call inference if saving its prompt fails", async () => {
    const { api, args } = setup();
    api.appendSessionMessages.mockRejectedValue(new Error("Chat no longer exists"));
    await expect(generateImageForSession(args)).rejects.toThrow("no longer exists");
    expect(api.createSession).not.toHaveBeenCalled();
    expect(api.generateImage).not.toHaveBeenCalled();
  });
  it("does not append an image after cancellation even if a provider returns late", async () => {
    const { api, controller, args } = setup();
    api.generateImage.mockImplementation(async () => { controller.abort(); return { filename: "late.png" }; });
    await expect(generateImageForSession(args)).rejects.toMatchObject({ name: "AbortError" });
    expect(api.appendSessionMessages).toHaveBeenCalledTimes(1);
  });
  it("creates one source chat and keeps a durable submitted prompt on provider failure", async () => {
    const { api, args } = setup();
    api.generateImage.mockRejectedValue(new Error("Out of memory"));
    await expect(generateImageForSession({ ...args, sessionId: null })).rejects.toThrow("Out of memory");
    expect(api.createSession).toHaveBeenCalledTimes(1);
    expect(api.appendSessionMessages).toHaveBeenCalledTimes(1);
    expect(api.appendSessionMessages.mock.calls[0][0]).toBe("new-chat");
  });
});
