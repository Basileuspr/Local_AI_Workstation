import { createMessageId } from "./messageIds";
import { MAX_IMAGE_STEPS, MAX_IMAGE_GUIDANCE } from "./imageGenerationLimits";

export function imageRequest(settings, requestId) {
  return {
    request_id: requestId, model_id: settings.modelId, prompt: settings.prompt.trim(),
    negative_prompt: settings.negativePrompt, width: Number(settings.width), height: Number(settings.height),
    steps: Number(settings.steps), guidance_scale: Number(settings.guidanceScale),
    seed: settings.seed === "" ? null : Number(settings.seed), lora_id: settings.loraId || null,
    lora_scale: settings.loraId ? Number(settings.loraScale ?? 1) : 1, long_prompt: settings.longPrompt !== false,
  };
}

export function reconcileImageLora(settings, catalog) {
  // A completed catalog is authoritative. A failed/pending scan must not erase
  // a saved selection, and a missing base model still needs the user's choice.
  if (!settings.loraId || !Array.isArray(catalog.loras) || catalog.loraError
    || !catalog.models.some(model => model.id === settings.modelId)
    || catalog.loras.some(adapter => adapter.id === settings.loraId && adapter.base_model_id === settings.modelId)) return settings;
  return { ...settings, loraId: "" };
}

export function validateImageSelection(settings, catalog) {
  if (!settings.prompt.trim()) throw new Error("Type an image description first.");
  if (!catalog.models.some((model) => model.id === settings.modelId)) throw new Error("Select an installed image model.");
  if (settings.loraId && catalog.loraError) throw new Error("Optional LoRAs could not be loaded. Choose None (base model only), or refresh to try again.");
  if (settings.loraId && !(catalog.loras || []).some((adapter) => adapter.id === settings.loraId && adapter.base_model_id === settings.modelId)) {
    throw new Error("Select a LoRA compatible with this image model, or choose None.");
  }
  if (settings.loraId && (!Number.isFinite(Number(settings.loraScale ?? 1)) || Number(settings.loraScale ?? 1) < 0 || Number(settings.loraScale ?? 1) > 2)) {
    throw new Error("LoRA strength must be from 0 through 2.");
  }
  if (!catalog.runtime?.ready) throw new Error("Image generation is unavailable. Check the Generate tab for runtime details.");
  for (const key of ["width", "height"]) {
    const size = Number(settings[key]);
    if (!Number.isInteger(size) || size < 512 || size > 1536 || size % 8) throw new Error("Width and height must be 512–1536 pixels, in multiples of 8.");
  }
  for (const [key, label, min, max, integer] of [["steps", "Steps", 1, MAX_IMAGE_STEPS, true], ["guidanceScale", "Guidance", 1, MAX_IMAGE_GUIDANCE, false], ["seed", "Seed", 0, 2147483647, true]]) {
    if (key === "seed" && settings[key] === "") continue;
    const value = Number(settings[key]);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`${label} must be ${integer ? "a whole number " : ""}from ${min} through ${max}.`);
  }
}

// Both entry points persist against the original session using the append API.
export async function generateImageForSession({ api, settings, requestId, signal, sessionId, chatModel, requestLabel, onSubmitted, onCompleted }) {
  const checkCancelled = () => {
    if (signal.aborted) throw new DOMException("Image request cancelled", "AbortError");
  };
  checkCancelled();
  const target = sessionId || (await api.createSession()).id;
  if (!target) throw new Error("Could not create a chat for this image");
  checkCancelled();
  const submitted = await api.appendSessionMessages(target, [{
    id: createMessageId(), role: "user", content: `[Image generation] ${settings.prompt.trim()}${requestLabel ? `\n${requestLabel}` : ""}`,
  }], chatModel);
  onSubmitted?.(submitted);
  checkCancelled();
  const generated = await api.generateImage({ ...imageRequest(settings, requestId), session_id: target }, { signal });
  checkCancelled();
  const completed = await api.appendSessionMessages(target, [{
    id: createMessageId(), role: "assistant", content: `[Image generated: ${generated.filename}]`,
    generatedImages: [{ id: createMessageId(), src: generated.image_ref || generated.data_url, name: generated.filename, type: "image/png" }],
  }], chatModel);
  onCompleted?.(completed);
  return generated;
}
