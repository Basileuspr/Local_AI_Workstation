import ImageBatchControls from './ImageBatchControls';
import ImageBatchOutput from './ImageBatchOutput';
import GeneratedImagePreview from "./GeneratedImagePreview";
import ImageViewer from "./ImageViewer";
import { useEffect, useState } from "react";
import { useDispatch, useRefs, useStore, profiles } from "../useStore.jsx";
import * as api from "../api";
import { imageSourceUrl } from "../imageSources";
import ImageGenerationStatus from "./ImageGenerationStatus";
import ImageSettingsControls from "./ImageSettingsControls";
import CustomProfileControls from "./CustomProfileControls";
import { useImageGeneration } from "../ImageGenerationContext";
import { useAnalyzeIterate } from "../AnalyzeIterateContext";
import ImageRequestEditor from "./ImageRequestEditor";
import { copyImage } from "../imageClipboard";
import { useImageDestinations } from "../ImageDestinations";
import ImageSeedControls from "./ImageSeedControls";
import ImageOutputFolder from "./ImageOutputFolder";
import SaveImagePrompts from "./SaveImagePrompts";
import GenerateReference from './GenerateReference';
import { readReferenceImage, referenceComparison } from '../generationReference';
import { generationViewerImages } from "../generationHistory";
import "./ImageStudio.css";

export default function ImageStudio({ active = true }) {
  const state = useStore();
  const iterate = useAnalyzeIterate();
  const dispatch = useDispatch();
  const refs = useRefs();
  const destinations = useImageDestinations();
  const { models, loras, runtime, catalogError, connectionError, loraError, isGenerating,
    result, setResult, batch, requests, generate, generateBatch, removeImages, stop: handleStop, clear: clearGeneration,
    referenceImage, setReferenceImage, referenceStrength, setReferenceStrength, referenceFit, setReferenceFit, isSubmitting } = useImageGeneration();
  const [promptTokens, setPromptTokens] = useState(null);
  const [editingRequest, setEditingRequest] = useState(false);
  const [copying, setCopying] = useState(false);
  const [openingEditor, setOpeningEditor] = useState(false);
  const [editError, setEditError] = useState("");
  const [imageSize, setImageSize] = useState(null);
  const [selectedImageId, setSelectedImageId] = useState(null);
  const [readingReference, setReadingReference] = useState(false);
  const [clearVersion, setClearVersion] = useState(0);
  const submittingReference = isSubmitting || readingReference || openingEditor;
  const viewerImages = generationViewerImages(batch ? batch.slots.filter(slot => slot.image).map(slot => slot.image) : result ? [result] : [], api.apiUrl);
  const previewImage = result ? {
    id: result.url, url: imageSourceUrl(result.url), name: result.filename || "Generated image", seed: result.seed,
  } : null;
  const size = imageSize?.url === result?.url ? imageSize : null;
  const settings = state.imageSettings;
  const selectedModel = models.find(model => model.id === settings.modelId);
  const supportsLongPrompt = selectedModel?.supports_long_prompt !== false;
  const referenceOptions = { reference: referenceImage, strength: referenceStrength, fit: referenceFit };
  const compatibleLoras = loras.filter(adapter => adapter.base_model_id === settings.modelId);
  const missingLora = settings.loraId && !compatibleLoras.some(adapter => adapter.id === settings.loraId);
  const selectedLora = compatibleLoras.find(adapter => adapter.id === settings.loraId);

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

  async function useAsReference(image = previewImage) {
    if (!image || !destinations || openingEditor) return;
    setOpeningEditor(true); setEditError('');
    try { setReferenceImage(await readReferenceImage(await destinations.readImage(image))); }
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
    void generate(settings, referenceOptions);
  }

  function compareReferences() {
    try { setEditError(''); void generateBatch(referenceComparison(settings, referenceStrength), referenceOptions); }
    catch (error) { setEditError(error.message); }
  }

  function handleReset() {
    dispatch({ type: "RESET_IMAGE_SETTINGS" });
    refs.imagePromptTarget = null;
    setPromptTokens(null);
    setResult(null);
    setReferenceImage(null); setReferenceStrength(.3); setReferenceFit('contain');
    dispatch({ type: "SHOW_TOAST", payload: { message: "Generate settings reset to defaults", type: "success" } });
  }

  function handleClear() {
    if (submittingReference || copying || !clearGeneration()) return;
    dispatch({ type: "RESET_IMAGE_SETTINGS" });
    refs.imagePromptTarget = null;
    setPromptTokens(null); setImageSize(null); setSelectedImageId(null);
    setEditingRequest(false); setEditError('');
    setClearVersion(version => version + 1);
    dispatch({ type: "SHOW_TOAST", payload: { message: "Generate tab cleared. Saved images and queued jobs are kept.", type: "success" } });
  }

  return (
    <section id="image-studio">
      <header className="image-studio-header">
        <div>
          <p className="image-studio-eyebrow">Local Diffusers</p>
          <h1>Generate Image</h1>
        </div>
        <div className="image-studio-header-actions">
          <button type="button" className="image-clear-btn" aria-label="Clear Generate tab" onClick={handleClear}
            disabled={submittingReference || copying} title="Clear prompts, selections, reference image, previews and batch settings">Clear tab</button>
          <span className={`image-runtime ${runtime?.ready ? "ready" : "not-ready"}`}>
            {runtime?.ready ? runtime.device : "CUDA unavailable"}
          </span>

        </div>
      </header>
      {catalogError && <p role="alert">{catalogError}</p>}
      {connectionError && <p role="status">{connectionError}</p>}
      <div className="image-studio-layout">
        <form className="image-studio-controls" aria-label="Image generation controls" onSubmit={handleGenerate}>
          <GenerateReference key={`reference-${clearVersion}`} active={active} reference={referenceImage} onChange={setReferenceImage} strength={referenceStrength}
            onStrength={setReferenceStrength} fit={referenceFit} onFit={setReferenceFit} steps={settings.steps} onBusyChange={setReadingReference}
            onSettings={setImageSettings} prompt={settings.prompt} onPrompt={prompt => setImageSettings({prompt})} />
          <label>Image Model
            <select value={settings.modelId} onChange={(event) => setImageSettings({ modelId: event.target.value, loraId: "" })} disabled={models.length === 0}>
              <option value="">{models.length === 0 ? "No supported image models installed" : "Select an image model"}</option>
              {models.map((model) => <option value={model.id} key={model.id}>{model.name} ({model.pipeline})</option>)}
            </select>
          </label>
          {selectedModel?.recommended_settings && <div className="image-model-hint">

            <button type="button" onClick={() => setImageSettings(selectedModel.recommended_settings)}>Use Verboa settings</button>
          </div>}
          <label>LoRA Adapter (optional)
            <select value={settings.loraId || ""} onChange={(event) => setImageSettings({ loraId: event.target.value })}>
              <option value="">None (base model only)</option>
              {missingLora && <option value={settings.loraId}>Selected LoRA unavailable or incompatible</option>}
              {compatibleLoras.map((adapter) => <option value={adapter.id} key={adapter.id}>{adapter.name} ({adapter.id.slice(0, 8)})</option>)}
            </select>
          </label>

          {selectedLora?.trigger_word && <div className="reference-lora-hint">
            <small>{selectedLora.training_goal === 'character_identity' ? 'Character identity' : 'Style'} LoRA · Trigger: {selectedLora.trigger_word}</small>
            <button type="button" disabled={settings.prompt.includes(selectedLora.trigger_word)} onClick={() => setImageSettings({prompt: [selectedLora.trigger_word, settings.prompt].filter(Boolean).join(', ')})}>Add LoRA trigger to prompt</button>
          </div>}
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
          <CustomProfileControls key={`profile-${clearVersion}:${state.activeCustomProfileId}`} />
          <label>Prompt
            <textarea value={settings.prompt} onFocus={(event) => { refs.imagePromptTarget = event.target; }} onChange={(event) => setImageSettings({ prompt: event.target.value })} />
          </label>
          {promptTokens && <div className={`image-token-status ${promptTokens.prompt.chunks_required > 1 || promptTokens.negative_prompt.chunks_required > 1 ? "long" : ""}`}>
            <span>Prompt: {promptTokens.prompt.token_count} / {promptTokens.prompt.native_content_limit} native tokens</span>
            <span>Negative: {promptTokens.negative_prompt.token_count} / {promptTokens.negative_prompt.native_content_limit}</span>
            {(promptTokens.prompt.chunks_required > 1 || promptTokens.negative_prompt.chunks_required > 1) && (
              <span>{!supportsLongPrompt ? 'Shorten the prompt to the native token limit' : settings.longPrompt !== false ? `Long prompt: ${Math.max(promptTokens.prompt.chunks_required, promptTokens.negative_prompt.chunks_required)} chunks enabled` : "Will be truncated to the native token limit"}</span>
            )}
            {settings.longPrompt !== false && Math.max(promptTokens.prompt.chunks_required, promptTokens.negative_prompt.chunks_required) > promptTokens.long_prompt_max_chunks && <span className="token-error">Too long: max {promptTokens.long_prompt_max_tokens} content tokens.</span>}
          </div>}
          <label>Negative Prompt
            <textarea value={settings.negativePrompt} onFocus={(event) => { refs.imagePromptTarget = event.target; }} onChange={(event) => setImageSettings({ negativePrompt: event.target.value })} placeholder="Optional" />
          </label>
          <SaveImagePrompts key={`prompts-${clearVersion}`} />
          {supportsLongPrompt && <label className="image-long-prompt-toggle">
            <input type="checkbox" checked={settings.longPrompt !== false} onChange={(event) => setImageSettings({ longPrompt: event.target.checked })} />
            <span>Use long-prompt encoding (up to 4 chunks)</span>
          </label>}
          <div className="image-settings-heading">Generation Settings</div>
          <ImageSettingsControls key={`settings-${clearVersion}`} settings={settings} onChange={setImageSettings} resolutionLimits={runtime?.resolution_limits} sourceSize={referenceImage}/>
          {referenceImage && <div className="reference-comparison">
            <button type="button" disabled={submittingReference || !settings.modelId || !settings.prompt.trim() || !runtime?.ready} onClick={compareReferences}>Compare change amounts</button>

          </div>}
          <ImageBatchControls key={`batch-${clearVersion}`} settings={settings} onChange={setImageSettings} onSubmit={items => generateBatch(items, referenceOptions)} disabled={submittingReference || !settings.modelId || !settings.prompt.trim() || !runtime?.ready}/>
          <ImageOutputFolder key={`folder-${clearVersion}`} value={settings.outputDir} onChange={outputDir => setImageSettings({ outputDir })} />
          <button className="analyze-iterate-button" type="button" disabled={!settings.prompt.trim() || !iterate} onClick={() => iterate.prompts()} title="Analyze and refine the current prompts for your next image">Analyze &amp; Iterate</button>
          <button className="image-generate-btn" type="submit" disabled={submittingReference || !settings.modelId || !settings.prompt.trim() || !runtime?.ready}>{isSubmitting ? "Submitting…" : isGenerating ? "Queue image" : "Generate"}</button>
          <button className="image-generate-btn" type="button" disabled={submittingReference || !settings.modelId || !runtime?.ready} onClick={() => setEditingRequest(true)}>Edit Image Request Before Send</button>
          {isGenerating && <button className="image-stop-btn" type="button" onClick={handleStop}>Stop all image requests</button>}
          <button className="image-reset-btn" type="button" disabled={submittingReference} onClick={handleReset} title="Clear prompts and selections, and restore generation defaults">RESET DEFAULT</button>
          <button type="button" className="generate-shortcut" onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", payload: "chats" })}>Jump to Chat →</button>
        </form>
        <div className="image-studio-output">
          <ImageGenerationStatus active={active} />
          <div className={`image-studio-result${batch ? " has-batch" : ""}`} aria-label="Generated image preview">
          {batch ? <ImageBatchOutput batch={batch} requests={requests}
            onRemove={removeImages}
            onOpen={image => setSelectedImageId(image.url)}
            onEdit={image => handleEdit(generationViewerImages([image], api.apiUrl)[0])}
            onReference={image => useAsReference(generationViewerImages([image], api.apiUrl)[0])}
            onCopy={image => handleCopy(generationViewerImages([image], api.apiUrl)[0])}
            editDisabled={!destinations || openingEditor} copying={copying} /> : result ? <>
            <GeneratedImagePreview key={previewImage.url} className="image-studio-preview" src={previewImage.url} alt="Generated image"
              onOpen={() => setSelectedImageId(result.url)}
              onLoad={event => setImageSize({ url: result.url, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
            <div className="image-studio-result-actions">
              <button type="button" disabled={!destinations || openingEditor} onClick={() => useAsReference()}>Use as reference</button>
              <button type="button" className="image-generate-btn" disabled={!destinations || openingEditor} onClick={() => handleEdit()}>{openingEditor ? "Opening image…" : "Edit Image"}</button>
              <button type="button" className="generate-copy" disabled={copying} onClick={() => handleCopy(previewImage)}>{copying ? "Copying…" : "Copy Image"}</button>
              <button type="button" onClick={() => removeImages([result])}>Remove image</button>
            </div>
            <ImageSeedControls seed={result.seed} showMissing />
            {editError && <p role="alert">{editError}</p>}
            {result.output_warning && <p role="alert">{result.output_warning}</p>}
            <p>{result.filename} {size ? `| ${size.width} × ${size.height} pixels` : ""} {result.generation_seconds != null ? `| generated in ${result.generation_seconds.toFixed(1)}s` : ""} {result.peak_vram_bytes ? `| peak ${(result.peak_vram_bytes / 1024 ** 3).toFixed(2)} GiB` : ""}</p>

          </> : <p className="image-studio-empty">Generated images will appear here and in the Images gallery.</p>}
          {batch && editError && <p role="alert">{editError}</p>}
          </div>
        </div>
      </div>
      <ImageViewer images={viewerImages} selectedId={selectedImageId} onSelect={setSelectedImageId} onClose={() => setSelectedImageId(null)} active={active} onRemove={images => removeImages(images.map(image => ({url:image.id})))} />
      {editingRequest && <ImageRequestEditor settings={settings} models={models} loras={loras} runtime={runtime} loraError={loraError}
        referenceSummary={referenceImage ? {name:referenceImage.file.name,strength:referenceStrength,fit:referenceFit} : null} onClose={() => setEditingRequest(false)} onSend={request => {
        setEditingRequest(false); setImageSettings(request); void generate(request, referenceOptions);
      }} />}
    </section>
  );
}
