import { useDispatch, useStore } from "../useStore";
import { useImageGeneration } from "../ImageGenerationContext";
import ImageRequests from "./ImageRequests";
import "./ChatImageControls.css";

export default function ChatImageControls({ active = true, onGenerate }) {
  const { imageSettings: settings } = useStore();
  const dispatch = useDispatch();
  const { models, loras, runtime, catalogError, refreshModels, isGenerating, stop } = useImageGeneration();
  const change = (payload) => dispatch({ type: "SET_IMAGE_SETTINGS", payload });
  const compatible = loras.filter((adapter) => adapter.base_model_id === settings.modelId);
  const missingModel = settings.modelId && !models.some((model) => model.id === settings.modelId);
  const missingLora = settings.loraId && !compatible.some((adapter) => adapter.id === settings.loraId);
  return <div className="chat-image-controls">
    <details className="chat-image-disclosure">
    <summary>Image generation{isGenerating && <span role="status"> · Images running / queued</span>}</summary>
    <div className="chat-image-expanded">
    <div className="chat-image-toolbar">
      <label>Image model
        <select aria-label="Chat image model" value={settings.modelId}
          onChange={(event) => change({ modelId: event.target.value, loraId: "" })}>
          <option value="">Select image model</option>
          {missingModel && <option value={settings.modelId}>Selected model unavailable</option>}
          {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
      </label>
      <label>Image LoRA
        <select aria-label="Chat image LoRA" value={settings.loraId || ""} disabled={!settings.modelId}
          onChange={(event) => change({ loraId: event.target.value })}>
          <option value="">None (base model)</option>
          {missingLora && <option value={settings.loraId}>Selected LoRA unavailable or incompatible</option>}
          {compatible.map((adapter) => <option key={adapter.id} value={adapter.id}>{adapter.name}</option>)}
        </select>
      </label>
      {settings.loraId && <label className="chat-image-strength">Strength
        <input aria-label="Chat image LoRA strength" type="number" min="0" max="2" step="0.05" value={settings.loraScale ?? 1}
          onChange={(event) => change({ loraScale: event.target.value })} />
      </label>}
      <button type="button" onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", payload: "generate" })}>Image settings</button>
      <button type="button" aria-label="Refresh image models and LoRAs" onClick={refreshModels}>↻</button>
      <button type="button" className="chat-image-generate" onClick={onGenerate}
        disabled={!settings.modelId || missingModel || missingLora || !runtime?.ready || !!catalogError}
        title="Generate an image from the text in the message box">{isGenerating ? "Queue image" : "Generate image"}</button>
    </div>
    <p className="chat-image-hint">Generate image uses your message text and Generate settings. Send / Enter sends a text chat. Image LoRAs affect pictures.</p>
    {catalogError && <p className="chat-image-error" role="alert">{catalogError}</p>}
    {!catalogError && !models.length && <p className="chat-image-hint">No image models found. Add a model in Generate to use image LoRAs.</p>}
    {!catalogError && models.length > 0 && !runtime?.ready && <p className="chat-image-error">Image runtime unavailable. Check Image settings.</p>}
    <ImageRequests active={active} />
    </div>
    </details>
    {isGenerating && <button type="button" className="chat-image-stop chat-image-compact-stop" onClick={stop}>Stop all images</button>}
  </div>;
}
