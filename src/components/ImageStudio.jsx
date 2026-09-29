import ImageBatchControls from './ImageBatchControls';
import ImageBatchOutput from './ImageBatchOutput';
import GeneratedImagePreview from "./GeneratedImagePreview";
import ImageViewer from "./ImageViewer";
import { useEffect, useState } from "react";
import { useDispatch, useRefs, useStore, profiles } from "../useStore.jsx";
import * as api from "../api";
import ImageGenerationStatus from "./ImageGenerationStatus";
import ImageSettingsControls from "./ImageSettingsControls";
import ImageGenerationHelp from "./ImageGenerationHelp";
import CustomProfileControls from "./CustomProfileControls";
import { useImageGeneration } from "../ImageGenerationContext";
import { useAnalyzeIterate } from "../AnalyzeIterateContext";
import ImageRequestEditor from "./ImageRequestEditor";
import { copyImage } from "../imageClipboard";
import { useImageDestinations } from "../ImageDestinations";
import ImageSeedControls from "./ImageSeedControls";
import ImageOutputFolder from "./ImageOutputFolder";
import SaveImagePrompts from "./SaveImagePrompts";
import { generationViewerImages } from "../generationHistory";
import "./ImageStudio.css";

export default function ImageStudio({ active = true }) {
  const state = useStore();
  const iterate = useAnalyzeIterate();
  const dispatch = useDispatch();
  const refs = useRefs();
  const destinations = useImageDestinations();
  const { models, loras, runtime, catalogError, connectionError, loraError, isGenerating,
    result, setResult, batch, requests, generate, generateBatch, removeImages, stop: handleStop } = useImageGeneration();
  const [promptTokens, setPromptTokens] = useState(null);
  const [editingRequest, setEditingRequest] = useState(false);
  const [copying, setCopying] = useState(false);
  const [openingEditor, setOpeningEditor] = useState(false);
  const [editError, setEditError] = useState("");
  const [imageSize, setImageSize] = useState(null);
  const [selectedImageId, setSelectedImageId] = useState(null);
  const viewerImages = generationViewerImages(batch ? batch.slots.filter(slot => slot.image).map(slot => slot.image) : result ? [result] : [], api.apiUrl);
  const previewImage = result ? {
    id: result.url, url: api.apiUrl(result.url), name: result.filename || "Generated image", seed: result.seed,
  } : null;
  const size = imageSize?.url === result?.url ? imageSize : null;
  const settings = state.imageSettings;
  const compatibleLoras = loras.filter(adapter => adapter.base_model_id === settings.modelId);
  const missingLora = settings.loraId && !compatibleLoras.some(adapter => adapter.id === settings.loraId);

  function setImageSettings(changes) {
    dispatch({ type: "SET_IMAGE_SETTINGS", payload: changes });
  }

  useEffect(() => {
    setEditError("");
  }, [result]);

  async function handleEdit(image = previewImage) {
    if (!image || !destinations || openingEditor) return;
    setOpeningEditor(true);
    setEditError("");
    try { await destinations.take(image, "editor"); }
    catch (error) { setEditError(error.message); }
    finally { setOpeningEditor(false); }
  }

  async function handleCopy(image) {
    setCopying(true);
    try { await copyImage(image.url); dispatch({ type: "SHOW_TOAST", payload: { message: "Image copied to clipboard", type: "success" } }); }
    catch (error) { dispatch({ type: "SHOW_TOAST", payload: { message: error.message, type: "error" } }); }
    finally { setCopying(false); }
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
      {connectionError && <p role="status">{connectionError}</p>}
      <div className="image-studio-layout">
        <form className="image-studio-controls" aria-label="Image generation controls" onSubmit={handleGenerate}>
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
          <SaveImagePrompts />
          <label className="image-long-prompt-toggle">
            <input type="checkbox" checked={settings.longPrompt !== false} onChange={(event) => setImageSettings({ longPrompt: event.target.checked })} />
            <span>Use long-prompt encoding (up to 4 chunks)</span>
          </label>
          <div className="image-settings-heading">Generation Settings</div>
          <ImageSettingsControls settings={settings} onChange={setImageSettings} resolutionLimits={runtime?.resolution_limits} />
          <ImageBatchControls settings={settings} onChange={setImageSettings} onSubmit={generateBatch} disabled={!settings.modelId || !settings.prompt.trim() || !runtime?.ready}/>
          <ImageOutputFolder value={settings.outputDir} onChange={outputDir => setImageSettings({ outputDir })} />
          <button className="analyze-iterate-button" type="button" disabled={!settings.prompt.trim() || !iterate} onClick={() => iterate.prompts()} title="Analyze and refine the current prompts for your next image">Analyze &amp; Iterate</button>
          <button className="image-generate-btn" type="submit" disabled={!settings.modelId || !settings.prompt.trim() || !runtime?.ready}>{isGenerating ? "Queue image" : "Generate"}</button>
          <button className="image-generate-btn" type="button" disabled={!settings.modelId || !runtime?.ready} onClick={() => setEditingRequest(true)}>Edit Image Request Before Send</button>
          {isGenerating && <button className="image-stop-btn" type="button" onClick={handleStop}>Stop all image requests</button>}
          <button className="image-reset-btn" type="button" onClick={handleReset} title="Clear prompts and selections, and restore generation defaults">RESET DEFAULT</button>
          <button type="button" className="generate-shortcut" onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", payload: "chats" })}>Jump to Chat →</button>
        </form>
        <div className="image-studio-output">
          <ImageGenerationStatus active={active} />
          <div className={`image-studio-result${batch ? " has-batch" : ""}`} aria-label="Generated image preview">
          {batch ? <ImageBatchOutput batch={batch} requests={requests}
            onRemove={removeImages}
            onOpen={image => setSelectedImageId(image.url)}
            onEdit={image => handleEdit(generationViewerImages([image], api.apiUrl)[0])}
            onCopy={image => handleCopy(generationViewerImages([image], api.apiUrl)[0])}
            editDisabled={!destinations || openingEditor} copying={copying} /> : result ? <>
            <GeneratedImagePreview key={previewImage.url} className="image-studio-preview" src={previewImage.url} alt="Generated image"
              onOpen={() => setSelectedImageId(result.url)}
              onLoad={event => setImageSize({ url: result.url, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
            <div className="image-studio-result-actions">
              <button type="button" className="image-generate-btn" disabled={!destinations || openingEditor} onClick={() => handleEdit()}>{openingEditor ? "Opening image…" : "Edit Image"}</button>
              <button type="button" className="generate-copy" disabled={copying} onClick={() => handleCopy(previewImage)}>{copying ? "Copying…" : "Copy Image"}</button>
              <button type="button" onClick={() => removeImages([result])}>Remove image</button>
            </div>
            <ImageSeedControls seed={result.seed} showMissing />
            {editError && <p role="alert">{editError}</p>}
            {result.output_warning && <p role="alert">{result.output_warning}</p>}
            <p>{result.filename} {size ? `| ${size.width} × ${size.height} pixels` : ""} {result.generation_seconds != null ? `| generated in ${result.generation_seconds.toFixed(1)}s` : ""} {result.peak_vram_bytes ? `| peak ${(result.peak_vram_bytes / 1024 ** 3).toFixed(2)} GiB` : ""}</p>
            <p>Click to enlarge. Hover to zoom.</p>
          </> : <p className="image-studio-empty">Generated images will appear here and in the Images gallery.</p>}
          {batch && editError && <p role="alert">{editError}</p>}
          </div>
        </div>
      </div>
      <ImageViewer images={viewerImages} selectedId={selectedImageId} onSelect={setSelectedImageId} onClose={() => setSelectedImageId(null)} active={active} onRemove={images => removeImages(images.map(image => ({url:image.id})))} />
      {editingRequest && <ImageRequestEditor settings={settings} models={models} loras={loras} runtime={runtime} loraError={loraError} onClose={() => setEditingRequest(false)} onSend={request => {
        setEditingRequest(false); setImageSettings(request); void generate(request);
      }} />}
    </section>
  );
}
