import { createMessageId } from "./messageIds";

export function imageRequest(settings, requestId) {
  return {
    request_id: requestId, model_id: settings.modelId, prompt: settings.prompt.trim(),
    negative_prompt: settings.negativePrompt, width: Number(settings.width), height: Number(settings.height),
    steps: Number(settings.steps), guidance_scale: Number(settings.guidanceScale),
    seed: settings.seed === "" ? null : Number(settings.seed), lora_id: settings.loraId || null,
    lora_scale: Number(settings.loraScale ?? 1), long_prompt: settings.longPrompt !== false,
  };
}

export function validateImageSelection(settings, catalog) {
  if (!settings.prompt.trim()) throw new Error("Type an image description first.");
  if (!catalog.models.some((model) => model.id === settings.modelId)) throw new Error("Select an installed image model.");
  if (settings.loraId && !catalog.loras.some((adapter) => adapter.id === settings.loraId && adapter.base_model_id === settings.modelId)) {
    throw new Error("Select a LoRA compatible with this image model, or choose None.");
  }
  if (!catalog.runtime?.ready) throw new Error("Image generation is unavailable. Check the Generate tab for runtime details.");
  for (const key of ["width", "height"]) {
    const size = Number(settings[key]);
    if (!Number.isInteger(size) || size < 512 || size > 1536 || size % 8) throw new Error("Choose a supported aspect ratio in Generate.");
  }
  for (const [key, label, min, max, integer] of [["steps", "Steps", 1, 60, true], ["guidanceScale", "Guidance", 1, 20, false], ["seed", "Seed", 0, 2147483647, true]]) {
    if (key === "seed" && settings[key] === "") continue;
    const value = Number(settings[key]);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`${label} must be ${integer ? "a whole number " : ""}from ${min} through ${max}.`);
  }
}

// Both entry points persist against the original session using the append API.
export async function generateImageForSession({ api, settings, requestId, signal, sessionId, chatModel, onSubmitted, onCompleted }) {
  const checkCancelled = () => {
    if (signal.aborted) throw new DOMException("Image request cancelled", "AbortError");
  };
  checkCancelled();
  const target = sessionId || (await api.createSession()).id;
  if (!target) throw new Error("Could not create a chat for this image");
  checkCancelled();
  const submitted = await api.appendSessionMessages(target, [{
    id: createMessageId(), role: "user", content: `[Image generation] ${settings.prompt.trim()}`,
  }], chatModel);
  onSubmitted?.(submitted);
  checkCancelled();
  const generated = await api.generateImage(imageRequest(settings, requestId), { signal });
  checkCancelled();
  const completed = await api.appendSessionMessages(target, [{
    id: createMessageId(), role: "assistant", content: `[Image generated: ${generated.filename}]`,
    generatedImages: [{ id: createMessageId(), src: generated.image_ref || generated.data_url, name: generated.filename, type: "image/png" }],
  }], chatModel);
  onCompleted?.(completed);
  return generated;
}
