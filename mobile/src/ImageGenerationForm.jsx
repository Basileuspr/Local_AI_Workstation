import React from "react";
import ImageSettingsControls from "../../src/components/ImageSettingsControls";
import { defaultImageSettings } from "../../src/imageGenerationDefaults";
import { imageRequest, validateImageSelection } from "../../src/chatImageGeneration";

export function mobileImageSubmission(settings, catalog) {
  validateImageSelection(settings, catalog);
  // Use the desktop serializer, excluding desktop-only filesystem destinations.
  const { request_id, model_id, output_dir, ...values } = imageRequest(settings);
  return { ...values, model: model_id };
}

export default function ImageGenerationForm({ settings, onChange, catalog, error, disabled, onSubmit, pendingImages = 0, activeChat = false, onOpenJobs }) {
  const model = catalog.models.find(item => item.id === settings.modelId);
  const compatible = catalog.loras.filter(item => item.base_model_id === settings.modelId);
  const selectedLora = compatible.find(item => item.id === settings.loraId);
  return <section><div className="section-heading"><div><span className="eyebrow">CREATE ON YOUR DESKTOP</span><h2>Generate an image</h2></div></div>
    <form className="panel generation" onSubmit={onSubmit}>
      <label>Image model<select aria-label="Image model" value={settings.modelId} onChange={event => onChange({ modelId: event.target.value, loraId: "" })}>
        <option value="">Select image model</option>{catalog.models.map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
      </select></label>
      {error && <p role="alert" className="error">{error}</p>}
      {model?.recommended_settings && <button type="button" onClick={() => onChange(model.recommended_settings)}>Use model recommended settings</button>}
      <label>Image LoRA (optional)<select aria-label="Image LoRA adapter" value={settings.loraId} disabled={!model || model.supports_lora_training === false} onChange={event => onChange({ loraId: event.target.value })}>
        <option value="">None (base model only)</option>{compatible.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      {catalog.loraError && <p role="status">{catalog.loraError}</p>}
      {settings.loraId && <label>LoRA strength<input aria-label="LoRA strength" type="number" min="0" max="2" step="0.05" value={settings.loraScale} onChange={event => onChange({ loraScale: event.target.value })} /></label>}
      {selectedLora?.trigger_word && <div className="muted"><p>LoRA trigger: {selectedLora.trigger_word}</p><button type="button" disabled={settings.prompt.includes(selectedLora.trigger_word)} onClick={() => onChange({ prompt: [selectedLora.trigger_word, settings.prompt].filter(Boolean).join(", ") })}>Add LoRA trigger to prompt</button></div>}
      <label>Prompt<textarea aria-label="Image prompt" rows={5} maxLength={12000} value={settings.prompt} onChange={event => onChange({ prompt: event.target.value })} placeholder="A quiet cabin beneath a sky full of stars…" /></label>
      <label>Negative Prompt<textarea aria-label="Negative prompt" rows={2} maxLength={12000} value={settings.negativePrompt} onChange={event => onChange({ negativePrompt: event.target.value })} placeholder="Optional" /></label>
      {model?.supports_long_prompt !== false && <label className="image-ratio-lock"><input type="checkbox" checked={settings.longPrompt !== false} onChange={event => onChange({ longPrompt: event.target.checked })} /><span>Use long-prompt encoding (up to 4 chunks)</span></label>}
      <h3>Generation Settings</h3>
      <ImageSettingsControls settings={settings} onChange={onChange} resolutionLimits={catalog.runtime?.resolution_limits} />
      <details><summary>About generation settings</summary><p className="muted">These are the same size, steps, guidance and seed controls used on the desktop. Higher guidance increases prompt influence, not quality. More steps and larger images take longer. A blank seed chooses a new random seed. Both prompts and your settings stay in place after each generation.</p></details>
      <button type="button" onClick={() => onChange({ ...defaultImageSettings, modelId: settings.modelId, prompt: settings.prompt, negativePrompt: settings.negativePrompt })}>Reset generation settings</button>
      <button className="primary" disabled={disabled || !model || !catalog.runtime?.ready || !settings.prompt.trim()}>{pendingImages ? "Queue another image ✧" : "Generate image ✧"}</button>
      {!!pendingImages && <div className="row"><p className="muted" role="status">{pendingImages} image{pendingImages === 1 ? "" : "s"} pending in this conversation.</p><button type="button" onClick={onOpenJobs}>View jobs</button></div>}
      {activeChat && <p className="muted" role="status">Wait for this conversation’s chat response before adding images.</p>}
      <p className="muted">Keep creating in this conversation while earlier images wait or generate. Images use the desktop queue and save to this conversation, Gallery, and desktop Generate output. You can leave this page while your desktop works.</p>
    </form></section>;
}
