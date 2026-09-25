import { useEffect, useRef, useState } from "react";
import ImageSettingsControls from "./ImageSettingsControls";
import { reconcileImageLora, validateImageSelection } from "../chatImageGeneration";
import "./ImageRequestEditor.css";

export default function ImageRequestEditor({ settings, models, loras, runtime, loraError, onSend, onClose }) {
  const dialog = useRef(null), sent = useRef(false);
  const [draft, setDraft] = useState(() => ({ ...settings }));
  const [error, setError] = useState("");
  useEffect(() => { dialog.current.showModal(); }, []);
  const change = updates => setDraft(current => ({ ...current, ...updates }));
  function send(event) {
    event.preventDefault();
    if (sent.current) return;
    try {
      const request = reconcileImageLora(draft, { models, loras, loraError });
      validateImageSelection(request, { models, loras, runtime, loraError });
      sent.current = true;
      onSend({ ...request });
    } catch (failure) { sent.current = false; setError(failure.message); }
  }
  return <dialog ref={dialog} className="image-request-editor" aria-labelledby="request-editor-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <form onSubmit={send}>
      <h2 id="request-editor-title">Edit Image Request Before Send</h2>
      <p>Review this request. Nothing is submitted until you select Send Request.</p>
      <label>Image model<select value={draft.modelId} onChange={event => change({ modelId: event.target.value, loraId: "" })}>
        <option value="">Select an image model</option>{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select></label>
      <label>LoRA adapter<select value={draft.loraId || ""} onChange={event => change({ loraId: event.target.value })}>
        <option value="">None (base model only)</option>{loras.filter(lora => lora.base_model_id === draft.modelId).map(lora => <option key={lora.id} value={lora.id}>{lora.name}</option>)}
      </select></label>
      {draft.loraId && <label>LoRA strength<input type="number" min="0" max="2" step="0.05" value={draft.loraScale ?? 1} onChange={event => change({ loraScale: event.target.value })} /></label>}
      <label>Prompt<textarea autoFocus required rows={5} value={draft.prompt} onChange={event => change({ prompt: event.target.value })} /></label>
      <label>Negative prompt<textarea rows={3} value={draft.negativePrompt} onChange={event => change({ negativePrompt: event.target.value })} /></label>
      <label className="request-long-prompt"><input type="checkbox" checked={draft.longPrompt !== false} onChange={event => change({ longPrompt: event.target.checked })} />Use long-prompt encoding</label>
      <ImageSettingsControls settings={draft} onChange={change} />
      {error && <p role="alert">{error}</p>}
      <div className="request-editor-actions"><button type="submit" disabled={!draft.modelId || !draft.prompt.trim()}>Send Request</button><button type="button" onClick={onClose}>Cancel</button></div>
    </form>
  </dialog>;
}
