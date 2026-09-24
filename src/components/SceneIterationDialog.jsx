import { useEffect, useRef, useState } from "react";
import { useStore } from "../useStore";
import * as api from "../imageWorkflowApi";
import { sourceFor } from "../imageLibraryApi";
import { newStage, runIsActive } from "../imageWorkflow";
import { sceneDraftFromAnalysis } from "../sceneIteration";
import ProtectedImage from "../ImagePrivacy";

export default function SceneIterationDialog({ image, onClose, onOpenScene }) {
  const state = useStore(), dialog = useRef(null), work = useRef(null), lock = useRef(false), closing = useRef(false);
  const [catalog, setCatalog] = useState(null), [model, setModel] = useState("");
  const [imageModel, setImageModel] = useState("");
  const [record, setRecord] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const visionModels = catalog?.providers.find(item => item.id === "ollama-vision")?.models || [];
  const imageModels = catalog?.providers.find(item => item.id === "local-sdxl")?.models || [];
  const running = runIsActive(record);
  const analysis = record?.status === "completed" ? record.stage_results.find(item => item.metadata?.scene_analysis)?.metadata.scene_analysis : null;
  useEffect(() => {
    let ignore = false;
    dialog.current.showModal();
    api.catalog().then(value => {
      if (ignore) return;
      setCatalog(value);
      const models = value.providers.find(item => item.id === "ollama-vision")?.models || [];
      setModel(models.some(item => item.id === state?.selectedModel) ? state.selectedModel : models.length === 1 ? models[0].id : "");
    }).catch(failure => { if (!ignore) setError(failure.message); });
    return () => { ignore = true; };
  }, []);
  useEffect(() => {
    if (!running) return;
    let ignore = false, timer;
    async function poll() {
      try {
        const result = await api.runState(record.workflow_id, record.id);
        if (ignore) return;
        setRecord(result);
        if (!runIsActive(result)) { if (closing.current) onClose(); return; }
      } catch (failure) { if (!ignore) setError(`Analysis status unavailable: ${failure.message}. Use Stop analysis before closing.`); }
      if (!ignore) timer = setTimeout(poll, 1000);
    }
    void poll();
    return () => { ignore = true; clearTimeout(timer); };
  }, [record?.id, running]);

  async function stop(close = false) {
    closing.current = close;
    try {
      const result = await api.stop(record.workflow_id, record.id);
      setRecord(result);
      if (close && !runIsActive(result)) onClose();
    } catch (failure) { closing.current = false; setError(failure.message); }
  }
  function close() { if (lock.current) return; if (running) void stop(true); else onClose(); }
  async function analyze() {
    if (lock.current || running) return;
    lock.current = true; setBusy(true); setError(""); closing.current = false;
    try {
      if (!work.current) work.current = await api.create();
      if (!work.current.assets.length) work.current = await api.importSource(work.current, sourceFor(image));
      const stage = { ...newStage(work.current, "describe"), provider_slot: "ollama-vision", model_id: model, analysis_kind: "scene" };
      work.current = await api.save({ ...work.current, name: `Analyze - ${image.name}`.slice(0, 120), stages: [stage] });
      setRecord(await api.execute(work.current));
    } catch (failure) { setError(failure.message); }
    finally { lock.current = false; setBusy(false); }
  }
  async function openScene() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      work.current = await api.save(sceneDraftFromAnalysis(work.current, analysis, imageModel));
      onOpenScene(work.current.id);
    } catch (failure) { setError(failure.message); }
    finally { lock.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="iterate-dialog" aria-label="Analyze image and iterate scene" onCancel={event => { event.preventDefault(); close(); }}>
    <header><div><h2>Analyze &amp; Iterate</h2><p>Build an editable scene from this image.</p></div><button type="button" disabled={busy} onClick={close} aria-label="Close scene analysis">Close ×</button></header>
    <div className="iterate-body">
      <figure className="iterate-source"><ProtectedImage src={image.url} alt={image.name} /><figcaption>{image.name}</figcaption></figure>
      <label>Vision analysis model<select value={model} disabled={busy || running} onChange={event => setModel(event.target.value)}><option value="">Choose a local vision model</option>{visionModels.map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>
      {catalog && !visionModels.length && <p role="status">No local vision models are installed. Add an image-capable model in Ollama, then reopen this dialog.</p>}
      <p className="iterate-help">Analysis proposes visible scene details and possible next steps. Review the draft before generating a new frame.</p>
      {error && <p role="alert" className="workflow-error">{error}</p>}{record?.error && <p role="alert" className="workflow-error">{record.error}</p>}
      {(busy || running) && <p role="status">{busy ? "Preparing scene…" : record.phase || "Waiting in Prompt Queue…"}</p>}
      {!running && record?.status === "cancelled" && <p role="status">Analysis stopped. The source image is preserved.</p>}
      <div className="iterate-actions"><button type="button" disabled={busy || running || !visionModels.some(item => item.id === model)} onClick={analyze}>{record ? "Analyze again" : "Analyze image"}</button>{running && <button type="button" disabled={record.status === "cancelling"} onClick={() => stop()}>{record.status === "cancelling" ? "Stopping…" : "Stop analysis"}</button>}</div>
      {analysis && <section className="iterate-proposal"><h3>Scene analysis</h3><p className="iterate-text">{analysis.observations}</p>
        {analysis.uncertainties.length > 0 && <><h4>Uncertain details</h4><ul>{analysis.uncertainties.map((item, i) => <li key={i}>{item}</li>)}</ul></>}
        {analysis.suggestions.length > 0 && <><h4>Possible next steps</h4><ul>{analysis.suggestions.map((item, i) => <li key={i}>{item}</li>)}</ul></>}
        <label>Image model for the scene (optional)<select value={imageModel} onChange={event => setImageModel(event.target.value)}><option value="">Choose later in the scene editor</option>{imageModels.map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>
        <p className="iterate-help">The original image stays intact. Iterative scenes supports a canvas up to 1024 × 1024; review its size and settings before generating.</p>
        <button type="button" disabled={busy} onClick={openScene}>Open scene draft</button>
      </section>}
    </div>
  </dialog>;
}
