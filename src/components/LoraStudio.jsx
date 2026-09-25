import FreshFileInput from "./FreshFileInput";
import ProtectedImage from "../ImagePrivacy";
import { useEffect, useRef, useState } from "react";
import { QueueRequestStatus } from "./PromptQueue";
import { useDispatch, useStore } from "../useStore.jsx";
import * as api from "../api";
import LoraAnalysisProgress from "./LoraAnalysisProgress";
import LoraHelp from "./LoraHelp";
import CpuPerformance from "./CpuPerformance";
import BulkActions, { SelectionCheckbox } from "./BulkActions";
import { useSelection, useBatchAction } from "../useSelection";

const DEFAULT_PROJECT = {
  name: "",
  description: "",
  trigger_word: "",
  training_goal: "character_identity",
  base_model_id: "",
  vision_model: "",
  output_location: "",
  settings: {},
  images: [],
  training: { status: "draft", logs: [] },
};

const fields = [
  ["resolution", "Resolution", "number", 256, 1024, 64],
  ["epochs", "Epochs", "number", 1, 1000, 1],
  ["batch_size", "Batch size", "number", 1, 32, 1],
  ["learning_rate", "Learning rate", "number", 0.000001, 1, 0.00001],
  ["rank", "Network rank", "number", 1, 256, 1],
  ["alpha", "Network alpha", "number", 1, 256, 1],
];

export default function LoraStudio({ active = true }) {
  const state = useStore();
  const dispatch = useDispatch();
  const fileRef = useRef(null);
  const createDialogRef = useRef(null);
  const analysisControllerRef = useRef(new Map());
  const loadSerial = useRef(0);
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const imageSelection = useSelection(project?.images || [], item => item.id, project?.id || "");
  const imageBatch = useBatchAction();
  const [models, setModels] = useState([]);
  const [visionModels, setVisionModels] = useState([]);
  const [hardware, setHardware] = useState(null);
  const [preflight, setPreflight] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [analysisProjects, setAnalysisProjects] = useState([]);
  const analyzing = analysisProjects.includes(project?.id);
  const [creatingProject, setCreatingProject] = useState(false);
  const [trainingSubmitting, setTrainingSubmitting] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  function toast(message, type = "") {
    dispatch({ type: "SHOW_TOAST", payload: { message, type } });
  }

  async function refreshProjects(selectId = state.activeLoraProjectId) {
    const list = await api.listLoraProjects();
    setProjects(list);
    const preferred = selectId || list[0]?.id;
    if (preferred) await loadProject(preferred, false);
    else setProject(null);
  }

  async function loadProject(projectId, updatePreference = true) {
    const serial = ++loadSerial.current;
    const loaded = await api.getLoraProject(projectId);
    if (serial !== loadSerial.current) return;
    setProject(loaded);
    if (updatePreference) dispatch({ type: "SET_ACTIVE_LORA_PROJECT", payload: projectId });
    try {
      const check = await api.getLoraPreflight(projectId);
      if (serial === loadSerial.current) setPreflight(check);
    } catch {
      if (serial === loadSerial.current) setPreflight(null);
    }
  }

  async function refreshSupport() {
    const [imageModels, nextHardware, nextVisionModels] = await Promise.all([
      api.loadImageGenerationModels(),
      api.loraHardware(),
      api.listLoraVisionModels().catch(() => []),
    ]);
    setModels(imageModels.models || []);
    setHardware(nextHardware);
    setVisionModels(nextVisionModels);
  }

  useEffect(() => {
    if (!active) return;
    Promise.all([refreshProjects(), refreshSupport()]).catch((error) => toast(error.message || "Could not load LoRA workspace", "error"));
  }, [active, state.connected]);

  useEffect(() => () => {
    for (const activeAnalysis of analysisControllerRef.current.values()) {
      activeAnalysis.controller.abort();
      api.stopLoraAnalysis(activeAnalysis.requestId).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!project?.id || !["queued", "starting", "running", "cancelling"].includes(project.training?.status)) return undefined;
    let disposed = false;
    const interval = setInterval(async () => {
      try {
        const training = await api.getLoraTraining(project.id);
        if (disposed) return;
        if (!["queued", "starting", "running", "cancelling"].includes(training.status)) {
          const [list, updated] = await Promise.all([api.listLoraProjects(), api.getLoraProject(project.id)]);
          if (!disposed) {
            setProjects(list);
            setProject(current => current?.id === project.id ? updated : current);
          }
        } else {
          setProject((current) => current?.id === project.id ? { ...current, training } : current);
        }
      } catch (error) {
        toast(error.message || "Could not refresh training", "error");
      }
    }, 1500);
    return () => { disposed = true; clearInterval(interval); };
  }, [project?.id, project?.training?.status]);

  useEffect(() => {
    if (creatingProject) createDialogRef.current?.showModal();
  }, [creatingProject]);

  function openCreateProject() {
    setNewProjectName("");
    setCreatingProject(true);
  }

  async function createProject(event) {
    event?.preventDefault();
    const name = newProjectName.trim();
    if (!name) return;
    setLoading(true);
    try {
      const created = await api.createLoraProject({ ...DEFAULT_PROJECT, name });
      dispatch({ type: "SET_ACTIVE_LORA_PROJECT", payload: created.id });
      await refreshProjects(created.id);
      setCreatingProject(false);
      setNewProjectName("");
      toast("LoRA project created", "success");
    } catch (error) {
      toast(error.message || "Could not create project", "error");
    } finally {
      setLoading(false);
    }
  }

  const createProjectDialog = creatingProject && (
    <dialog ref={createDialogRef} className="lora-create-modal" aria-labelledby="lora-create-title" onCancel={(event) => { if (loading) event.preventDefault(); else setCreatingProject(false); }}>
      <form className="lora-create-dialog" aria-labelledby="lora-create-title" onSubmit={createProject} onMouseDown={(event) => event.stopPropagation()}>
        <p className="image-studio-eyebrow">New local adapter</p>
        <h2 id="lora-create-title">Create LoRA project</h2>
        <label>Project name<input autoFocus value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="e.g. Rowan — continuous scenes" maxLength={120} /></label>
        <p>The project starts as an editable workspace. You will choose its image base and vision-analysis models next.</p>
        <div className="lora-create-actions">
          <button className="lora-secondary-button" type="button" onClick={() => setCreatingProject(false)} disabled={loading}>Cancel</button>
          <button className="image-generate-btn" type="submit" disabled={loading || !newProjectName.trim()}>{loading ? "Creating…" : "Create project"}</button>
        </div>
      </form>
    </dialog>
  );

  function editProject(changes) {
    setProject((current) => {
      const next = { ...current, ...changes };
      const folderName = (name) => (name || "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[.\-]+|[.\-]+$/g, "").slice(0, 80) || "adapter";
      if (changes.name !== undefined && current.output_location === folderName(current.name)) {
        next.output_location = folderName(changes.name);
      }
      return next;
    });
  }

  function editSettings(changes) {
    setProject((current) => ({ ...current, settings: { ...current.settings, ...changes } }));
  }

  async function saveProject() {
    if (!project?.id) return;
    setLoading(true);
    try {
      const saved = await api.updateLoraProject(project.id, {
        name: project.name,
        description: project.description,
        trigger_word: project.trigger_word,
        training_goal: project.training_goal,
        base_model_id: project.base_model_id,
        vision_model: project.vision_model,
        output_location: project.output_location,
        settings: project.settings,
      });
      setProject(saved);
      setPreflight(await api.getLoraPreflight(saved.id));
      await refreshProjects(saved.id);
      toast("LoRA settings saved", "success");
    } catch (error) {
      toast(error.message || "Could not save LoRA settings", "error");
    } finally {
      setLoading(false);
    }
  }

  async function addImages(files) {
    // Capture event-owned files before the picker resets or the drop event ends.
    const selectedFiles = Array.from(files || []);
    if (!project?.id || !selectedFiles.length) return;
    if (["queued", "starting", "running", "cancelling"].includes(project.training?.status)) {
      toast("The training dataset is locked until this run finishes", "error");
      return;
    }
    if (!models.some((model) => model.id === project.base_model_id)) {
      toast("Select an installed SDXL image model before adding its training dataset", "error");
      return;
    }
    setLoading(true);
    try {
      // Persist the model choice before the backend validates and stores files.
      await api.updateLoraProject(project.id, {
        name: project.name,
        description: project.description,
        trigger_word: project.trigger_word,
        training_goal: project.training_goal,
        base_model_id: project.base_model_id,
        vision_model: project.vision_model,
        output_location: project.output_location,
        settings: project.settings,
      });
      const result = await api.uploadLoraImages(project.id, selectedFiles);
      setProject(result.project);
      setPreflight(await api.getLoraPreflight(project.id));
      if (result.errors?.length) toast(result.errors.join(" "), "error");
      else toast(`${result.added.length} training image${result.added.length === 1 ? "" : "s"} added`, "success");
    } catch (error) {
      toast(error.message || "Could not add training images", "error");
    } finally {
      setLoading(false);
    }
  }

  async function removeImage(imageId) {
    if (!project?.id || ["queued", "starting", "running", "cancelling"].includes(project.training?.status)) return;
    try {
      const updated = await api.removeLoraImage(project.id, imageId);
      setProject(updated);
      setPreflight(await api.getLoraPreflight(project.id));
    } catch (error) {
      toast(error.message || "Could not remove image", "error");
    }
  }

  async function clearImages() {
    if (!project?.id || !window.confirm("Remove all copied training images from this project? Your original files are not affected.")) return;
    try {
      const updated = await api.clearLoraImages(project.id);
      setProject(updated);
      setPreflight(await api.getLoraPreflight(project.id));
    } catch (error) {
      toast(error.message || "Could not clear training images", "error");
    }
  }

  function removeSelectedImages(items) {
    if (workspaceBusy || loading) return;
    const projectId = project.id;
    return imageBatch.run({items, selection:imageSelection,
      confirm:`Remove ${items.length} selected training image(s) from this LoRA project? Your original files are unchanged.`,
      action:image => api.removeLoraImage(projectId, image.id), after:async result => {
        const updated = result.values.at(-1);
        if (updated) setProject(current => current?.id === projectId ? {...current, images:updated.images,
          identity_analysis:updated.identity_analysis, updated_at:updated.updated_at} : current);
        setPreflight(await api.getLoraPreflight(projectId));
      }});
  }

  async function saveCaption(imageId, caption) {
    if (!project?.id || ["queued", "starting", "running", "cancelling"].includes(project.training?.status)) return;
    try {
      const updated = await api.updateLoraCaption(project.id, imageId, caption);
      setProject(updated);
    } catch (error) {
      toast(error.message || "Could not save caption", "error");
    }
  }

  async function analyzeDataset() {
    if (!project?.id || !project.vision_model || !project.images?.length || analyzing) return;
    const requestId = globalThis.crypto?.randomUUID?.() || `lora-analysis-${Date.now()}`;
    const controller = new AbortController();
    if (analysisControllerRef.current.has(project.id)) return;
    analysisControllerRef.current.set(project.id, { requestId, controller });
    setAnalysisProjects(current => [...current, project.id]);
    try {
      const saved = await api.updateLoraProject(project.id, {
        name: project.name,
        description: project.description,
        trigger_word: project.trigger_word,
        training_goal: project.training_goal,
        base_model_id: project.base_model_id,
        vision_model: project.vision_model,
        output_location: project.output_location,
        settings: project.settings,
      });
      setProject(current => current?.id === saved.id ? saved : current);
      const analyzed = await api.analyzeLoraDataset(saved.id, {
        model: saved.vision_model,
        request_id: requestId,
      }, controller.signal);
      setProject(current => current?.id === analyzed.id ? analyzed : current);
      toast("Dataset analysis is ready for review", "success");
    } catch (error) {
      if (error?.name !== "AbortError") toast(error.message || "Could not analyze the dataset", "error");
    } finally {
      if (analysisControllerRef.current.get(project.id)?.requestId === requestId) {
        analysisControllerRef.current.delete(project.id);
        setAnalysisProjects(current => current.filter(id => id !== project.id));
      }
    }
  }

  async function stopAnalysis() {
    const activeAnalysis = analysisControllerRef.current.get(project.id);
    if (!activeAnalysis) return;
    activeAnalysis.controller.abort();
    // Keep this project's editor locked until the request finishes cleanup.
    try {
      await api.stopLoraAnalysis(activeAnalysis.requestId);
    } catch (error) {
      toast(error.message || "Could not stop dataset analysis upstream", "error");
    }
  }

  async function applySuggestedCaptions() {
    if (!project?.id || project.identity_analysis?.status !== "ready") return;
    try {
      const updated = await api.applyLoraCaptionSuggestions(project.id);
      setProject(updated);
      toast("Suggested captions applied", "success");
    } catch (error) {
      toast(error.message || "Could not apply suggested captions", "error");
    }
  }

  async function train(analyzeFirst = false) {
    if (!project?.id || trainingSubmitting) return;
    setTrainingSubmitting(true);
    try {
      // Training reads the persisted project, so commit the visible controls
      // first instead of silently training with an older configuration.
      const saved = await api.updateLoraProject(project.id, {
        name: project.name,
        description: project.description,
        trigger_word: project.trigger_word,
        training_goal: project.training_goal,
        base_model_id: project.base_model_id,
        vision_model: project.vision_model,
        output_location: project.output_location,
        settings: project.settings,
      });
      setProject(saved);
      const check = await api.getLoraPreflight(saved.id);
      setPreflight(check);
      if (!check.valid) {
        toast(check.errors[0] || "Fix validation errors before training", "error");
        return;
      }
      const training = analyzeFirst ? await api.analyzeAndTrainLora(saved.id) : await api.startLoraTraining(saved.id);
      setProject((current) => ({ ...current, training }));
      toast(analyzeFirst ? "Analysis and training added to Prompt Queue" : "LoRA training added to Prompt Queue", "success");
    } catch (error) {
      toast(error.message || "Could not start training", "error");
    } finally {
      setTrainingSubmitting(false);
    }
  }

  async function cancel() {
    if (!project?.id) return;
    try {
      const training = await api.cancelLoraTraining(project.id);
      setProject((current) => ({ ...current, training }));
    } catch (error) {
      toast(error.message || "Could not stop training", "error");
    }
  }

  if (!project) {
    return <section id="lora-studio" className="lora-empty"><LoraHelp /><div><p className="image-studio-eyebrow">Local training</p><h1>LoRA Creation</h1><p>Create a project to prepare images and train a portable local adapter.</p><button className="image-generate-btn" type="button" onClick={openCreateProject} disabled={loading}>+ New LoRA Project</button></div>{createProjectDialog}</section>;
  }

  const training = project.training || { status: "draft", logs: [] };
  const busy = ["queued", "starting", "running", "cancelling"].includes(training.status);
  const settings = project.settings || {};
  const selectedModel = models.find((model) => model.id === project.base_model_id);
  const identityTraining = project.training_goal === "character_identity";
  const analysis = project.identity_analysis;
  const workspaceBusy = busy || analyzing || trainingSubmitting || imageBatch.busy;

  return (
    <section id="lora-studio">
      <header className="lora-header">
        <div><p className="image-studio-eyebrow">Local training</p><h1>LoRA Creation</h1></div>
        <div className="lora-project-picker"><select aria-label="LoRA project" value={project.id} onChange={(event) => loadProject(event.target.value).catch(error => toast(error.message, "error"))} disabled={loading || trainingSubmitting || imageBatch.busy}>{projects.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.image_count})</option>)}</select><button type="button" onClick={openCreateProject} disabled={loading || trainingSubmitting || imageBatch.busy}>+ New</button><LoraHelp learningRate={settings.learning_rate} /></div>
      </header>
      <div className="lora-layout">
        <div className="lora-column">
          <section className="lora-card">
            <h2>Project</h2>
            <div className="lora-form-grid">
              <label>LoRA name<input value={project.name} disabled={workspaceBusy} onChange={(event) => editProject({ name: event.target.value })} /></label>
              <label>Trigger token<input value={project.trigger_word} disabled={workspaceBusy} onChange={(event) => editProject({ trigger_word: event.target.value })} placeholder="e.g. mysubject" /></label>
              <label>Training goal<select value={project.training_goal || "style"} disabled={workspaceBusy} onChange={(event) => editProject({ training_goal: event.target.value })}><option value="character_identity">Character identity / likeness</option><option value="style">Visual style</option></select></label>
              <label>Image base model<select value={project.base_model_id} disabled={workspaceBusy} onChange={(event) => editProject({ base_model_id: event.target.value })}><option value="">Select installed SDXL image model</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name} ({model.pipeline})</option>)}</select></label>
              <label>Vision analysis model<select value={project.vision_model || ""} disabled={workspaceBusy} onChange={(event) => editProject({ vision_model: event.target.value })}><option value="">Select installed Ollama vision model</option>{visionModels.map((model) => <option key={model.name} value={model.name}>{model.name}{model.parameter_size ? ` (${model.parameter_size})` : ""}</option>)}</select></label>
              <label className="lora-span">Description<textarea value={project.description} disabled={workspaceBusy} onChange={(event) => editProject({ description: event.target.value })} placeholder="Optional" /></label>
              <label>Saved adapter name / folder<input value={project.output_location} disabled={workspaceBusy} onChange={(event) => editProject({ output_location: event.target.value })} /></label>
            </div>
            <p className="lora-pipeline-note">{identityTraining ? "Identity mode trains a reusable character trigger from consistent features across varied angles, expressions, and actions. It requires a unique trigger token." : "Style mode learns recurring visual treatment rather than one character identity."}</p>
            <button type="button" className="lora-secondary-button" onClick={saveProject} disabled={loading || workspaceBusy}>Save project settings</button>
          </section>

          <section className="lora-card lora-analysis-card">
            <div className="lora-card-title"><h2>Identity & scene analysis</h2><span>{analysis?.status === "ready" ? "Review ready" : analysis?.status || "Not analyzed"}</span></div>
            <p className="lora-pipeline-note">Uses a local vision model to describe visible consistency, actions, and scenes. This assists dataset curation; it is not biometric identity verification.</p>
            {!visionModels.length && <p className="lora-warning">No compatible Ollama vision model is currently available.</p>}
            {analysis?.summary && <p className="lora-analysis-summary">{analysis.summary}</p>}
            {!analyzing && !busy && <CpuPerformance report={analysis?.cpu_assistance} timings={analysis?.timings} analysis />}
            {analysis?.stable_traits?.length > 0 && <div className="lora-traits">{analysis.stable_traits.map((trait) => <span key={trait}>{trait}</span>)}</div>}
            {analysis?.warnings?.map((warning) => <p className="lora-warning" key={warning}>{warning}</p>)}
            {analysis?.status === "stale" && <p className="lora-warning">The dataset or identity inputs changed. Analyze again before applying these suggestions.</p>}
            <p className="lora-pipeline-note">Analysis processes all images in small batches and combines suggestions for review. Batches shrink automatically if the model's context is full.</p>
            {(analyzing || (busy && training.workflow === "analyze_train" && training.stage === "analysis")) && <LoraAnalysisProgress key={project.id} projectId={project.id} requestId={analysisControllerRef.current.get(project.id)?.requestId || training.queue_id || training.run_id} total={project.images?.length || 0} />}
            <div className="lora-analysis-actions">
              {analyzing ? <button className="lora-danger-button" type="button" onClick={stopAnalysis}>Stop analysis</button> : <button className="lora-secondary-button" type="button" onClick={analyzeDataset} disabled={workspaceBusy || loading || !project.vision_model || !project.images?.length}>Analyze current dataset</button>}
              {analysis?.status === "ready" && <button className="lora-secondary-button" type="button" onClick={applySuggestedCaptions} disabled={workspaceBusy}>Apply all suggested captions</button>}
            </div>
          </section>

          <section className="lora-card">
            <div className="lora-card-title"><h2>Dataset</h2><span>{project.images?.length || 0} images</span></div>
            <div className={`lora-dropzone ${dragging ? "dragging" : ""} ${selectedModel && !workspaceBusy ? "" : "disabled"}`} onDragOver={(event) => { event.preventDefault(); if (selectedModel && !workspaceBusy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); if (!workspaceBusy) addImages(event.dataTransfer.files); }} onClick={() => selectedModel && !workspaceBusy && fileRef.current?.click()}>
              {selectedModel ? `Drop PNG, JPG, or WebP images for ${selectedModel.name}, or browse. Originals stay untouched.` : "Select an installed SDXL image model before attaching a training dataset."}
            </div>
            <div className="lora-dataset-actions"><button type="button" onClick={() => fileRef.current?.click()} disabled={!selectedModel || workspaceBusy}>Browse images</button>{project.images?.length > 0 && <button type="button" onClick={clearImages} disabled={workspaceBusy}>Clear copied images</button>}</div>
            <BulkActions selection={imageSelection} items={project.images || []} label="training images" batch={imageBatch} disabled={workspaceBusy || loading}
              actions={[{label:"Remove selected training images", danger:true, onClick:removeSelectedImages}]} />
            <div className="lora-image-grid">{project.images?.map((image) => <article className="lora-image-card" key={image.id}><SelectionCheckbox selection={imageSelection} item={image} label={`training image ${image.original_filename}`} disabled={workspaceBusy || loading} /><ProtectedImage src={api.getLoraImageUrl(project.id, image.id)} alt={image.original_filename} /><div><span>{image.original_filename}</span><small>{image.width} x {image.height}</small><textarea defaultValue={image.caption} key={`${image.id}-${image.caption}`} onBlur={(event) => saveCaption(image.id, event.target.value)} placeholder="Caption / trigger words" disabled={workspaceBusy} />{image.caption_suggestion && <div className="lora-caption-suggestion"><small>Suggested caption</small><p>{image.caption_suggestion}</p><button className="lora-use-suggestion" type="button" onClick={() => saveCaption(image.id, image.caption_suggestion)} disabled={workspaceBusy}>Use suggestion</button></div>}<button type="button" onClick={() => removeImage(image.id)} disabled={workspaceBusy}>Remove</button></div></article>)}</div>
          </section>
        </div>

        <div className="lora-column">
          <section className="lora-card">
            <h2>Training settings</h2>
            <div className="lora-form-grid">
              <label>CPU Assistance<select value={settings.cpu_assistance || "auto"} disabled={workspaceBusy} onChange={(event) => editSettings({ cpu_assistance: event.target.value })}>
                <option value="auto">Auto — up to 2 workers</option><option value="light">Light — 1 worker</option><option value="balanced">Balanced — up to 4 workers</option>
              </select></label>
              <label>Preloading RAM budget (MiB)<input type="number" min="32" max="2048" step="32" value={settings.preload_ram_mb ?? 256} disabled={workspaceBusy} onChange={(event) => editSettings({ preload_ram_mb: Number(event.target.value) })} /></label>
            </div>
            <p className="lora-pipeline-note">Applies to dataset analysis and training preparation. Auto uses up to 256 MiB; Light up to 64 MiB. All modes respect your budget and reduce preloading when free RAM is low. This budgets extra preparation, not model memory. Timings below measure where each run spends time.</p>
            <div className="lora-form-grid">{fields.map(([key, label, type, min, max, step]) => <label key={key}>{label}<input type={type} min={min} max={max} step={step} value={settings[key] ?? ""} disabled={workspaceBusy} onChange={(event) => editSettings({ [key]: Number(event.target.value) })} /><small>{key==='learning_rate'?`${Number(settings[key]||0).toExponential()} · ${Number((Number(settings[key]||0)/.0001).toFixed(3))}× app default (0.0001). See Settings guide above for comparisons.`:({resolution:'Larger inputs use more memory. 1024² has 4× the pixels of 512².',epochs:'Passes through your dataset. More can learn more, or overfit.',batch_size:'Images processed together. Effective full update = batch × accumulation.',rank:'Adapter capacity. Default 8; higher uses more memory and storage.',alpha:'Contribution scale relative to rank. Default alpha/rank = 1.'})[key]}</small></label>)}<label>Precision<select value={settings.precision} disabled={workspaceBusy} onChange={(event) => editSettings({ precision: event.target.value })}><option value="fp16">FP16</option><option value="bf16">BF16</option><option value="fp32">FP32</option></select></label><label>Aspect handling<select value={settings.aspect_mode} disabled={workspaceBusy} onChange={(event) => editSettings({ aspect_mode: event.target.value })}><option value="crop">Center crop</option><option value="pad">Pad to fit</option></select></label></div>
            <details className="lora-advanced"><summary>Advanced settings</summary><div className="lora-form-grid"><label>Max steps (0 = epochs)<input type="number" min="0" value={settings.max_steps} disabled={workspaceBusy} onChange={(event) => editSettings({ max_steps: Number(event.target.value) })} /></label><label>Gradient accumulation<input type="number" min="1" max="64" value={settings.gradient_accumulation_steps} disabled={workspaceBusy} onChange={(event) => editSettings({ gradient_accumulation_steps: Number(event.target.value) })} /></label><label>Save interval<input type="number" min="1" value={settings.save_interval} disabled={workspaceBusy} onChange={(event) => editSettings({ save_interval: Number(event.target.value) })} /></label><label>Seed<input type="number" min="0" value={settings.seed} disabled={workspaceBusy} onChange={(event) => editSettings({ seed: Number(event.target.value) })} /></label><label className="lora-span">Caption prefix<input value={settings.caption_prefix || ""} disabled={workspaceBusy} onChange={(event) => editSettings({ caption_prefix: event.target.value })} placeholder="Optional text prepended to new captions" /></label></div></details>
          </section>

          <section className="lora-card lora-status-card">
            <div className="lora-card-title"><h2>Readiness & progress</h2><span className={`lora-status ${preflight?.valid ? "ready" : ""}`}>{training.status || "draft"}</span></div>
            <div className="lora-hardware">{hardware?.cuda_available ? `${hardware.device} · ${hardware.available_vram_gib} / ${hardware.total_vram_gib} GiB free at pane load` : hardware?.error || "Checking GPU..."}</div>
            {preflight && <><div className="lora-summary">{preflight.dataset_count} images · ~{preflight.estimated_steps} steps · {preflight.memory_strategy || "VRAM estimate unavailable"}</div>{preflight.errors?.map((item) => <p className="lora-error" key={item}>{item}</p>)}{preflight.warnings?.map((item) => <p className="lora-warning" key={item}>{item}</p>)}</>}
            {training.phase && <div className="lora-summary">{training.phase}{busy && training.phase === "Preparing images and captions" ? ` · ${training.prepared || 0}/${training.dataset_count || 0}` : ""}</div>}
            {training.memory && <div className="lora-summary">Last worker sample: {training.memory.allocated_gib} GiB allocated · peak {training.memory.peak_gib} GiB · {training.memory.free_gib} GiB GPU free</div>}
            <CpuPerformance report={training.cpu_assistance} timings={training.timings} />
            {busy && training.stage !== "analysis" && <><div className="lora-progress"><span style={{ width: `${Math.max(0, Math.min(100, training.percent || 0))}%` }} /></div><div className="lora-summary">Epoch {training.epoch || 0}/{training.epochs || settings.epochs} · step {training.step || 0}/{training.total_steps || "?"} · {training.percent || 0}% {training.loss != null ? `· loss ${Number(training.loss).toFixed(4)}` : ""}</div></>}
            <QueueRequestStatus projectId={project.id} kind="training" />
            <div className="lora-training-actions">{busy ? <button className="lora-danger-button" type="button" onClick={cancel}>Cancel safely</button> : <>
              <button className="image-generate-btn" type="button" onClick={() => train(true)} disabled={loading || workspaceBusy || !project.vision_model || !project.images?.length || !hardware?.cuda_available || hardware?.training_ready === false || state.serviceStatus?.capabilities?.features?.training?.available === false}>Analyze &amp; Train</button>
              <button className="lora-secondary-button" type="button" onClick={() => train()} disabled={loading || workspaceBusy || !hardware?.cuda_available || hardware?.training_ready === false || state.serviceStatus?.capabilities?.features?.training?.available === false}>Start local training</button>
            </>}</div>
            <p className="lora-pipeline-note">Analyze &amp; Train queues both stages as one job. It fills blank or automatically created captions, keeps edited captions, then trains locally. Cancel stops the remaining workflow. Use Analyze current dataset to review suggestions first.</p>
            {training.error && <p className="lora-error">{training.error}</p>}
            <pre className="lora-log">{(training.logs || []).slice(-8).join("\n") || "No training logs yet."}</pre>
            {project.adapter && <div className="lora-output lora-complete-output"><strong>Complete LoRA ready</strong><span>{project.adapter.filename} is selectable in Generate for its matching base model.</span>{project.adapter.complete_path && <><code>{project.adapter.complete_path}</code><small>model/ · weights/ · training-images/ · captions/ · manifests</small></>}</div>}
          </section>
        </div>
      </div>
      {createProjectDialog}
      <FreshFileInput ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp" multiple hidden disabled={!selectedModel || workspaceBusy} onChange={(event) => { addImages(event.target.files); event.target.value = ""; }} />
    </section>
  );
}
