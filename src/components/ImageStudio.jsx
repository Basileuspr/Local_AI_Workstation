import ImageBatchControls from './ImageBatchControls';
import ProtectedImage from "../ImagePrivacy";
import { useEffect, useState } from "react";
import { useDispatch, useRefs, useStore, profiles } from "../useStore.jsx";
import * as api from "../api";
import ImageRequests from "./ImageRequests";
import ImageSettingsControls from "./ImageSettingsControls";
import ImageGenerationHelp from "./ImageGenerationHelp";
import CustomProfileControls from "./CustomProfileControls";
import { useImageGeneration } from "../ImageGenerationContext";
import { useAnalyzeIterate } from "../AnalyzeIterateContext";
import ImageRequestEditor from "./ImageRequestEditor";
import { copyImage } from "../imageClipboard";

export default function ImageStudio({ active = true }) {
  const state = useStore();
  const iterate = useAnalyzeIterate();
  const dispatch = useDispatch();
  const refs = useRefs();
  const { models, loras, runtime, catalogError, loraError, isGenerating,
    result, setResult, generate, generateBatch, stop: handleStop } = useImageGeneration();
  const [promptTokens, setPromptTokens] = useState(null);
  const [editingRequest, setEditingRequest] = useState(false);
  const [copying, setCopying] = useState(false);
  const settings = state.imageSettings;
  const compatibleLoras = loras.filter(adapter => adapter.base_model_id === settings.modelId);
  const missingLora = settings.loraId && !compatibleLoras.some(adapter => adapter.id === settings.loraId);

  function setImageSettings(changes) {
    dispatch({ type: "SET_IMAGE_SETTINGS", payload: changes });
  }

  // Use the model's own tokenizer, not a character estimate, so the warning
  // accurately reflects what SDXL can actually encode.
  useEffect(() => {
    if (!active || !settings.modelId) {
      setPromptTokens(null);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const tokenStatus = await api.getImagePromptTokens({
          modelId: settings.modelId,
          prompt: settings.prompt,
          negativePrompt: settings.negativePrompt,
        });
        if (!cancelled) setPromptTokens(tokenStatus);
      } catch {
        if (!cancelled) setPromptTokens(null);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, settings.modelId, settings.prompt, settings.negativePrompt]);

  function handleGenerate(event) {
    event.preventDefault();
    void generate(settings);
  }

  function handleReset() {
    dispatch({ type: "RESET_IMAGE_SETTINGS" });
    refs.imagePromptTarget = null;
    setPromptTokens(null);
    setResult(null);
    dispatch({ type: "SHOW_TOAST", payload: { message: "Generate settings reset to defaults", type: "success" } });
  }

  return (
    <section id="image-studio">
      <header className="image-studio-header">
        <div>
          <p className="image-studio-eyebrow">Local Diffusers</p>
          <h1>Generate Image</h1>
        </div>
        <div className="image-studio-header-actions">
          <span className={`image-runtime ${runtime?.ready ? "ready" : "not-ready"}`}>
            {runtime?.ready ? runtime.device : "CUDA unavailable"}
          </span>
          <ImageGenerationHelp />
        </div>
      </header>
      {catalogError && <p role="alert">{catalogError}</p>}
      <form className="image-studio-layout" onSubmit={handleGenerate}>
        <div className="image-studio-controls">
          <label>Image Model
            <select value={settings.modelId} onChange={(event) => setImageSettings({ modelId: event.target.value, loraId: "" })} disabled={models.length === 0}>
              <option value="">{models.length === 0 ? "No supported image models installed" : "Select an image model"}</option>
              {models.map((model) => <option value={model.id} key={model.id}>{model.name} ({model.pipeline})</option>)}
            </select>
          </label>
          <label>LoRA Adapter (optional)
            <select value={settings.loraId || ""} onChange={(event) => setImageSettings({ loraId: event.target.value })}>
              <option value="">None (base model only)</option>
              {missingLora && <option value={settings.loraId}>Selected LoRA unavailable or incompatible</option>}
              {compatibleLoras.map((adapter) => <option value={adapter.id} key={adapter.id}>{adapter.name} ({adapter.id.slice(0, 8)})</option>)}
            </select>
          </label>
          <small>LoRAs are optional. Choose None to generate with the base image model.</small>
          {loraError && <p role="status">{loraError}</p>}
          {settings.loraId && <label>LoRA strength
            <input type="number" min="0" max="2" step="0.05" value={settings.loraScale ?? 1} onChange={(event) => setImageSettings({ loraScale: event.target.value })} />
          </label>}
          <label>Built-in chat profile (replaces chat settings and system prompt)
            <select value={state.activeProfile} onChange={(event) => dispatch({ type: "APPLY_PROFILE", payload: event.target.value })}>
              <option value="">No built-in profile selected</option>
              {Object.entries(profiles).map(([key, profile]) => <option value={key} key={key}>{profile.label}</option>)}
            </select>
          </label>
          <CustomProfileControls key={state.activeCustomProfileId} />
          <label>Prompt
            <textarea value={settings.prompt} onFocus={(event) => { refs.imagePromptTarget = event.target; }} onChange={(event) => setImageSettings({ prompt: event.target.value })} />
          </label>
          {promptTokens && <div className={`image-token-status ${promptTokens.prompt.chunks_required > 1 || promptTokens.negative_prompt.chunks_required > 1 ? "long" : ""}`}>
            <span>Prompt: {promptTokens.prompt.token_count} / {promptTokens.prompt.native_content_limit} native tokens</span>
            <span>Negative: {promptTokens.negative_prompt.token_count} / {promptTokens.negative_prompt.native_content_limit}</span>
            {(promptTokens.prompt.chunks_required > 1 || promptTokens.negative_prompt.chunks_required > 1) && (
              <span>{settings.longPrompt !== false ? `Long prompt: ${Math.max(promptTokens.prompt.chunks_required, promptTokens.negative_prompt.chunks_required)} chunks enabled` : "Will be truncated to the native token limit"}</span>
            )}
            {settings.longPrompt !== false && Math.max(promptTokens.prompt.chunks_required, promptTokens.negative_prompt.chunks_required) > promptTokens.long_prompt_max_chunks && <span className="token-error">Too long: max {promptTokens.long_prompt_max_tokens} content tokens.</span>}
          </div>}
          <label>Negative Prompt
            <textarea value={settings.negativePrompt} onFocus={(event) => { refs.imagePromptTarget = event.target; }} onChange={(event) => setImageSettings({ negativePrompt: event.target.value })} placeholder="Optional" />
          </label>
          <label className="image-long-prompt-toggle">
            <input type="checkbox" checked={settings.longPrompt !== false} onChange={(event) => setImageSettings({ longPrompt: event.target.checked })} />
            <span>Use long-prompt encoding (up to 4 chunks)</span>
          </label>
          <div className="image-settings-heading">Generation Settings</div>
          <ImageSettingsControls settings={settings} onChange={setImageSettings} />
          <ImageBatchControls settings={settings} onChange={setImageSettings} onSubmit={generateBatch} disabled={!settings.modelId || !settings.prompt.trim() || !runtime?.ready}/>
          <ImageRequests active={active} />
          <button className="analyze-iterate-button" type="button" disabled={!settings.prompt.trim() || !iterate} onClick={() => iterate.prompts()} title="Analyze and refine the current prompts for your next image">Analyze &amp; Iterate</button>
          <button className="image-generate-btn" type="submit" disabled={!settings.modelId || !settings.prompt.trim() || !runtime?.ready}>{isGenerating ? "Queue image" : "Generate"}</button>
          <button className="image-generate-btn" type="button" disabled={!settings.modelId || !runtime?.ready} onClick={() => setEditingRequest(true)}>Edit Image Request Before Send</button>
          {isGenerating && <button className="image-stop-btn" type="button" onClick={handleStop}>Stop all image requests</button>}
          <button className="image-reset-btn" type="button" onClick={handleReset} title="Clear prompts and selections, and restore generation defaults">RESET DEFAULT</button>
        </div>
        <div className="image-studio-result">
          {result && <button type="button" className="generate-copy" disabled={copying} onClick={async () => {
            setCopying(true);
            try { await copyImage(api.apiUrl(result.url)); dispatch({ type: "SHOW_TOAST", payload: { message: "Image copied to clipboard", type: "success" } }); }
            catch (error) { dispatch({ type: "SHOW_TOAST", payload: { message: error.message, type: "error" } }); }
            finally { setCopying(false); }
          }}>{copying ? "Copying…" : "Copy Image"}</button>}
          {result ? <><ProtectedImage src={api.apiUrl(result.url)} alt="Generated image" /><p>{result.filename} {result.generation_seconds != null ? `| generated in ${result.generation_seconds.toFixed(1)}s` : ""} {result.peak_vram_bytes ? `| peak ${(result.peak_vram_bytes / 1024 ** 3).toFixed(2)} GiB` : ""}</p></> : <p>Generated images will appear here and in the Images gallery.</p>}
        </div>
      </form>
      <button type="button" className="generate-shortcut" onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", payload: "chats" })}>Jump to Chat →</button>
      {editingRequest && <ImageRequestEditor settings={settings} models={models} loras={loras} runtime={runtime} loraError={loraError} onClose={() => setEditingRequest(false)} onSend={request => {
        setEditingRequest(false); setImageSettings(request); void generate(request);
      }} />}
    </section>
  );
}
