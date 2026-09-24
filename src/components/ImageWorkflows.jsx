import ImageResolutionControls from './ImageResolutionControls';
import FreshFileInput from "./FreshFileInput";
import ProtectedImage from "../ImagePrivacy";
import { useEffect, useRef, useState } from "react";
import * as api from "../imageWorkflowApi";
import { imageSourceOptions, stageWithProvider, parseSource, runIsActive, resolveStageSources, sourceDimensions } from "../imageWorkflow";
import WorkflowRunPanel from "./WorkflowRunPanel";
import BulkActions, { SelectionCheckbox } from "./BulkActions";
import { useSelection } from "../useSelection";
import WorkflowDeleteDialog from "./WorkflowDeleteDialog";
import SceneStudio from "./SceneStudio";
import { useDispatch, useStore } from "../useStore";
import { MAX_IMAGE_STEPS, MAX_IMAGE_GUIDANCE } from "../imageGenerationLimits";

function Field({ label, help, children }) {
  return <label className="workflow-field"><span>{label}</span>{children}{help && <small>{help}</small>}</label>;
}

export default function ImageWorkflows({ active }) {
  const state = useStore(), dispatch = useDispatch();
  const [mode, setMode] = useState(() => typeof localStorage === "undefined" ? "stages" : localStorage.getItem("law-workflow-mode-v1") || "stages");
  function choose(value) { setMode(value); localStorage.setItem("law-workflow-mode-v1", value); }
  useEffect(() => { if (state?.sceneToOpen) choose("scene"); }, [state?.sceneToOpen]);
  useEffect(() => { if (state?.workflowToOpen) choose("stages"); }, [state?.workflowToOpen]);
  return <><nav className="workflow-mode-tabs" aria-label="Image workflow mode">
    <button aria-pressed={mode === "stages"} onClick={() => choose("stages")}>Processing stages</button>
    <button aria-pressed={mode === "scene"} onClick={() => choose("scene")}>Iterative scenes</button>
  </nav><div className="workflow-mode-panel" hidden={mode !== "stages"}><StageWorkflows active={active && mode === "stages"} /></div>
    <div className="workflow-mode-panel" hidden={mode !== "scene"}><SceneStudio active={active && mode === "scene"} sceneToOpen={state?.sceneToOpen} onSceneOpened={id => dispatch?.({ type: "ITERATIVE_SCENE_OPENED", payload: id })} /></div></>;
}

function StageWorkflows({ active }) {
  const navigationState = useStore(), dispatch = useDispatch();
  useEffect(() => {
    if (!active || !navigationState?.workflowToOpen) return;
    const id = navigationState.workflowToOpen;
    void load(id).then(() => dispatch({ type: "IMAGE_WORKFLOW_OPENED", payload: id })).catch(error => setError(error.message));
  }, [active, navigationState?.workflowToOpen]);
  const [catalog, setCatalog] = useState(null);
  const [library, setLibrary] = useState([]);
  const workflowSelection = useSelection(library);
  const [deleting, setDeleting] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [draft, setDraft] = useState(null);
  const stageSelection = useSelection(draft?.stages || [], item => item.id, draft?.id || "");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [report, setReport] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [operation, setOperation] = useState("img2img");
  const [execution, setExecution] = useState(null);
  const actionLock = useRef(false);

  async function refreshLibrary() {
    const listed = await api.list();
    setLibrary(listed.workflows.filter(item => item.mode !== "scene")); setWarnings(listed.warnings);
  }

  async function deleted(result) {
    const ids = new Set(result.deleted);
    if (ids.has(draft?.id)) {
      setDraft(null); setDirty(false); setExecution(null); setJobs([]); setReport(null); setSnapshot(null);
    } else if (draft) {
      const updated = result.updated_workflows.find(item => item.id === draft.id);
      if (updated) {
        setDraft(current => ({ ...current, revision: updated.revision,
          parent: ids.has(current.parent?.workflow_id) ? null : current.parent,
          assets: current.assets.map(asset => ids.has(asset.origin?.workflow_id) ? { ...asset, origin: null } : asset),
        }));
        setSnapshot(null);
      }
    }
    workflowSelection.end(); setDeleting(null);
    await refreshLibrary();
    setNotice(`Deleted ${result.deleted.length} workflow(s). Saved image copies were kept and workflow associations removed.`);
  }

  useEffect(() => {
    const removedElsewhere = event => {
      if (event.key !== "workflows-deleted" || !event.newValue) return;
      try {
        const result = JSON.parse(event.newValue);
        if (Array.isArray(result.deleted) && Array.isArray(result.updated_workflows)) void deleted(result).catch(err => setError(err.message));
      } catch { /* Ignore unrelated or invalid storage events. */ }
    };
    window.addEventListener("storage", removedElsewhere);
    return () => window.removeEventListener("storage", removedElsewhere);
  }, [draft]);

  async function initialize() {
    const [metadata, listed] = await Promise.all([api.catalog(), api.list()]);
    setCatalog(metadata);
    setLibrary(listed.workflows.filter(item => item.mode !== "scene"));
    setWarnings(listed.warnings);
  }

  useEffect(() => {
    if (!active || catalog) return;
    let ignore = false;
    Promise.all([api.catalog(), api.list()]).then(([metadata, listed]) => {
      if (ignore) return;
      setCatalog(metadata);
      setLibrary(listed.workflows.filter(item => item.mode !== "scene"));
      setWarnings(listed.warnings);
      setError("");
    }).catch(err => { if (!ignore) setError(err.message); });
    return () => { ignore = true; };
  }, [active, catalog]);

  useEffect(() => {
    if (!dirty) return;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!runIsActive(execution)) return;
    let ignore = false;
    let timer;
    async function refresh() {
      try {
        const record = await api.runState(execution.workflow_id, execution.id);
        if (ignore) return;
        setExecution(record);
        if (!runIsActive(record)) return;
      } catch (err) {
        if (!ignore) setError(`Could not refresh run status: ${err.message}. The run may still be active.`);
      }
      if (!ignore) timer = setTimeout(refresh, 1000);
    }
    refresh();
    return () => { ignore = true; clearTimeout(timer); };
  }, [execution?.id, execution?.workflow_id, execution?.status]);

  useEffect(() => {
    if (!active || !draft?.id) return;
    let ignore = false;
    let timer;
    const refresh = async () => {
      try {
        const history = await api.jobs(draft.id);
        if (!ignore && !actionLock.current) setJobs(history.jobs);
      } catch (err) { if (!ignore) setError(err.message); }
      if (!ignore) timer = setTimeout(refresh, 2000);
    };
    refresh();
    return () => { ignore = true; clearTimeout(timer); };
  }, [active, draft?.id]);

  function remember(workflow) {
    setLibrary(current => [{ id: workflow.id, name: workflow.name, revision: workflow.revision }, ...current.filter(item => item.id !== workflow.id)]);
  }

  function accept(workflow) {
    setDraft(workflow);
    setDirty(false);
    setReport(null);
    setSnapshot(null);
    remember(workflow);
  }

  function change(update) {
    setDraft(current => {const next=typeof update==="function"?update(current):{...current,...update};return {...next,stages:resolveStageSources(next.stages)};});
    setDirty(true);
    setReport(null);
    setSnapshot(null);
    setNotice("");
  }

  function changeStage(id, update) {
    change(current=>({...current,stages:current.stages.map(stage=>stage.id===id?{...stage,...update}:stage)}));
  }

  async function run(action) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try { await action(); } catch (err) { setError(err.message || "Workflow action failed"); }
    finally { actionLock.current = false; setBusy(false); }
  }

  async function saveCurrent() {
    if (!dirty) return draft;
    const saved = await api.save(draft);
    accept(saved);
    return saved;
  }

  async function load(id) {
    if (dirty && !window.confirm("Discard unsaved workflow changes and load the saved version?")) return;
    const [workflow, history] = await Promise.all([api.get(id), api.jobs(id)]);
    accept(workflow);
    setJobs(history.jobs);
    const latest = history.jobs.find(item => item.execution);
    setExecution(latest ? await api.runState(id, latest.id) : null);
  }

  async function create() {
    if (dirty && !window.confirm("Discard unsaved workflow changes and create a new workflow?")) return;
    accept(await api.create());
    setJobs([]);
    setExecution(null);
    setNotice("Workflow created on disk. Add images and processing stages below.");
  }

  async function upload(files) {
    if (!files.length) return;
    const saved = await saveCurrent();
    const result = await api.uploadMany(saved, files, accept);
    setNotice(`${result.added} image(s) added to this workflow${result.duplicates ? ` · ${result.duplicates} already present` : ""}.`);
    if (result.failed.length) setError(result.failed.join("\n"));
  }

  async function prepare() {
    const saved = await saveCurrent();
    const record = await api.prepare(saved);
    setSnapshot(record);
    setReport(record.preflight);
    setJobs(current => [{ id: record.id, created_at: record.created_at, status: record.status, revision: record.snapshot.revision }, ...current]);
    setNotice("Snapshot saved. Choose Run workflow to execute a new snapshot of the saved draft.");
  }

  async function execute() {
    const saved = await saveCurrent();
    const record = await api.execute(saved);
    setExecution(record);
    setJobs(current => [{ id: record.id, revision: saved.revision, created_at: record.created_at, status: record.status, execution: true }, ...current]);
    setSnapshot(await api.job(saved.id, record.id));
    setNotice("Workflow submitted to Prompt Queue. Its settings are saved; you can edit this draft and queue another run.");
  }

  async function stop() {
    try {
      const stopped = await api.stop(execution.workflow_id, execution.id);
      setExecution(current => current?.id === stopped.id ? stopped : current);
    }
    catch (err) { setError(err.message); }
  }

  function moveStage(index, direction) {
    const stages = [...draft.stages];
    [stages[index], stages[index + direction]] = [stages[index + direction], stages[index]];
    change({ stages });
  }

  function assetSelect(value, onChange, label) {
    return <select aria-label={label} value={value || ""} onChange={event => onChange(event.target.value || null)}>
      <option value="">Choose uploaded image</option>
      {draft.assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name} ({asset.width} × {asset.height})</option>)}
    </select>;
  }

  return <section className="image-workflows" aria-label="Image Workflows">
    <header className="workflow-heading">
      <div><p className="workflow-eyebrow">LOCAL · MODEL-INDEPENDENT</p><h1>Image Workflows</h1><p>Arrange the assets and stages for an image-editing pipeline.</p></div>
      <span className="workflow-badge">Local execution · Review results before reuse</span>
    </header>
    <p className="workflow-banner">Run stages in order using installed local providers. SDXL supports image-to-image and masked editing; Ollama vision describes images; Lanczos resizes on CPU. ControlNet and multi-reference adapters are not installed. Completed results appear in Images → Workflow Images. Keep a result or stitched image as a reference to reuse it in later scenes.</p>
    {error && <div className="workflow-error" role="alert">{error}</div>}
    {notice && <p role="status" className="workflow-notice">{notice}</p>}
    {warnings.map(warning => <p className="workflow-error" key={warning}>{warning}</p>)}
    {!catalog ? <button disabled={busy} onClick={() => run(initialize)}>Load workflow workspace</button> : <>
      <fieldset disabled={busy} className="workflow-toolbar">
        <select aria-label="Saved workflow" value={draft?.id || ""} onChange={event => run(() => load(event.target.value))}>
          <option value="" disabled>Choose a saved workflow</option>
          {library.map(item => <option key={item.id} value={item.id}>{item.name}{item.deletion_pending ? " · cleanup pending" : ""}</option>)}
        </select>
        <button onClick={() => run(create)}>+ New image workflow</button>
        <button onClick={() => run(async () => setCatalog(await api.catalog()))}>Refresh providers</button>
        {draft && <>
          <button type="button" className="danger" disabled={runIsActive(execution)} onClick={() => setDeleting([{id: draft.id, name: draft.name, revision: draft.revision}])}>Delete workflow</button>
          <button onClick={() => run(async () => { await saveCurrent(); setNotice("Workflow saved."); })}>{dirty ? "Save changes" : "Saved"}</button>
          <button onClick={() => run(() => load(draft.id))}>Reload saved</button>
          <button onClick={() => run(async () => { accept(await api.branch(await saveCurrent())); setJobs([]); setExecution(null); setNotice("Next-scene draft created. Choose a kept result as the source for the next scene."); })}>Branch next scene</button>
        </>}
      </fieldset>
      <BulkActions selection={workflowSelection} items={library} label="workflows" disabled={busy}
        actions={[{label:"Delete selected workflows", danger:true, onClick:setDeleting}]} />
      {workflowSelection.enabled && <div className="workflow-selection-list">{library.map(item => <label key={item.id}><SelectionCheckbox selection={workflowSelection} item={item} label={`workflow ${item.name}`} disabled={busy} /> {item.name}{item.deletion_pending ? " · retry cleanup" : ""}</label>)}</div>}
      {deleting && <WorkflowDeleteDialog items={deleting} onDeleted={deleted} onClose={() => setDeleting(null)} onRefresh={refreshLibrary} />}
      {!draft ? <div className="workflow-empty"><h2>Start with your reference images</h2><p>Create a workflow, attach images, then arrange processing stages. No models are needed to prepare the structure.</p><p>Each workflow owns its assets, editable draft, and read-only preparation history.</p></div> : <div className="workflow-layout">
        <fieldset disabled={busy} className="workflow-editor">
          <section className="workflow-card">
            <Field label="Workflow name"><input value={draft.name} maxLength={120} onChange={event => change({ name: event.target.value })} /></Field>
            <Field label="Scene continuity notes" help="Planning notes for appearance, action, and what must remain consistent. These notes are not silently appended to the prompt."><textarea rows={2} maxLength={8000} value={draft.scene_notes} onChange={event => change({ scene_notes: event.target.value })} /></Field>
            {draft.parent && <p className="workflow-muted">Branched from workflow {draft.parent.workflow_id}, revision {draft.parent.revision}.</p>}
          </section>
          <section className="workflow-card">
            <h2>1 · Reference assets</h2><p>Upload source images, masks, and control maps here; assign their roles in each stage. Originals are copied, not moved.</p>
            <Field label="Attach images" help="Select several PNG, JPEG, or WebP files together. Each: single frame, up to 20 MiB / 24 megapixels. Saves pending draft changes first."><FreshFileInput type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; run(() => upload(files)); }} /></Field>
            <div className="workflow-assets">{draft.assets.map(asset => <a key={asset.id} href={api.assetUrl(draft.id, asset.id)} target="_blank" rel="noreferrer" title={`Open ${asset.name}`}>
              <ProtectedImage src={api.assetUrl(draft.id, asset.id)} alt={asset.name} loading="lazy" /><span>{asset.name}</span><small>{asset.width} × {asset.height}</small>
            </a>)}</div>
          </section>
          <section className="workflow-card">
            <h2>2 · Prompt settings</h2><p>SDXL stages use these settings. Describe / OCR reports image content separately; Lanczos changes size without using a prompt.</p>
            <Field label="Positive prompt" help="Describe the image or edit you want. Recognition suggestions will need your approval before filling this field."><textarea rows={3} maxLength={12000} value={draft.prompt_settings.prompt} onChange={event => change({ prompt_settings: { ...draft.prompt_settings, prompt: event.target.value } })} /></Field>
            <Field label="Negative prompt" help="Describe things to avoid. Some model families do not support negative prompts; their adapter must report that."><textarea rows={2} maxLength={12000} value={draft.prompt_settings.negative_prompt} onChange={event => change({ prompt_settings: { ...draft.prompt_settings, negative_prompt: event.target.value } })} /></Field>
            <div className="workflow-numbers">{[
              ["seed", "Seed", -1, 4294967295, 1, "-1 requests a new random seed. A fixed seed helps comparisons but does not guarantee identical results across models or hardware."],
              ["steps", "Steps", 1, MAX_IMAGE_STEPS, 1, `SDXL refinement steps, up to ${MAX_IMAGE_STEPS}. Steps multiplied by strength must be at least 1 unless strength is 0.`],
              ["guidance", "Guidance", 0, MAX_IMAGE_GUIDANCE, 0.1, "How strongly a compatible model follows your prompt. Too much can introduce harsh or distorted details."],
            ].map(([key, label, min, max, step, help]) => <Field key={key} label={label} help={help}><input type="number" min={min} max={max} step={step} value={draft.prompt_settings[key]} onChange={event => change({ prompt_settings: { ...draft.prompt_settings, [key]: Number(event.target.value) } })} /></Field>)}</div>
          </section>
          <section className="workflow-card">
            <h2>3 · Processing stages</h2><p>Work flows from top to bottom. Previous-image links follow the processing order when stages change. Choose a particular image or stage only when you want a fixed source.</p>
            <BulkActions selection={stageSelection} items={draft.stages} label="stages" disabled={busy}
              actions={[{label:"Remove selected stages", danger:true, onClick:items => {
                if (!window.confirm(`Remove ${items.length} selected stage(s) from this draft? Remaining stages may need new source selections. Save changes to keep this edit.`)) return;
                const ids = new Set(items.map(item => item.id));
                change({stages:draft.stages.filter(stage => !ids.has(stage.id))}); stageSelection.forget(items);
              }}]} />
            {draft.stages.map((stage, index) => {
              const metadata = catalog.operations.find(item => item.id === stage.operation);
              const options = imageSourceOptions(draft, index);
              const previous=draft.stages.slice(0,index).filter(item=>item.operation!=="describe").at(-1);
              const sourceValue = stage.source_mode==="previous"?"previous":stage.source ? `${stage.source.kind}:${stage.source.id}` : "";
              return <article className="workflow-stage" key={stage.id}>
                <SelectionCheckbox selection={stageSelection} item={stage} label={`stage ${index + 1}`} disabled={busy} />
                <div className="workflow-stage-heading"><h3>{index + 1} · {metadata.label}</h3><div>
                  <button aria-label={`Move stage ${index + 1} up`} disabled={index === 0} onClick={() => moveStage(index, -1)}>↑</button>
                  <button aria-label={`Move stage ${index + 1} down`} disabled={index === draft.stages.length - 1} onClick={() => moveStage(index, 1)}>↓</button>
                  <button aria-label={`Remove stage ${index + 1}`} onClick={() => change({ stages: draft.stages.filter(item => item.id !== stage.id) })}>Remove stage</button>
                </div></div>
                <p>{metadata.help}</p>
                {stage.operation !== "txt2img" && <Field label={`Stage ${index + 1} source`}><select value={sourceValue} onChange={event => changeStage(stage.id,event.target.value==="previous"?{source_mode:"previous"}:{source_mode:"selected",source:parseSource(event.target.value)})}>
                  <option value="">Choose a source</option>
                  <option value="previous" disabled={!previous}>Previous image stage{previous?` · Stage ${draft.stages.indexOf(previous)+1} output`:" · none yet"}</option>
                  {sourceValue && sourceValue!=="previous" && !options.some(item => item.value === sourceValue) && <option value={sourceValue}>Invalid reference — choose another source</option>}
                  {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select></Field>}
                {stage.operation === "inpaint" && <Field label={`Stage ${index + 1} mask`} help="White = edit, black = preserve. Match the source dimensions; this release does not include a mask painter.">{assetSelect(stage.mask_asset_id, value => changeStage(stage.id, { mask_asset_id: value }), `Stage ${index + 1} mask`)}</Field>}
                {stage.operation === "controlnet" && <>
                  <Field label="Control map type" help="Records how the map should be interpreted. The eventual adapter must support this type."><select value={stage.control_kind} onChange={event => changeStage(stage.id, { control_kind: event.target.value })}><option value="edges">Edges</option><option value="depth">Depth</option><option value="pose">Pose</option><option value="other">Other / adapter-specific</option></select></Field>
                  <Field label={`Stage ${index + 1} control map`} help="Upload an already prepared map. Map extraction and model-family compatibility checks are future adapter work.">{assetSelect(stage.control_asset_id, value => changeStage(stage.id, { control_asset_id: value }), `Stage ${index + 1} control map`)}</Field>
                  <Field label="Control influence" help="Higher values give the map more influence over structure."><input type="number" min={0} max={2} step={0.05} value={stage.control_scale} onChange={event => changeStage(stage.id, { control_scale: Number(event.target.value) })} /></Field>
                </>}
                {["img2img", "inpaint", "multi_reference"].includes(stage.operation) && <Field label="Change strength" help="0 stays closest to the source; 1 allows the largest change. Exact behavior is adapter-dependent."><input type="number" min={0} max={1} step={0.05} value={stage.strength} onChange={event => changeStage(stage.id, { strength: Number(event.target.value) })} /></Field>}
                {stage.operation === "upscale" && <Field label="Size multiplier" help="Lanczos resampling on CPU, not AI detail reconstruction. Output is limited to 24 megapixels."><select value={stage.upscale_factor} onChange={event => changeStage(stage.id, { upscale_factor: Number(event.target.value) })}><option value={2}>2×</option><option value={3}>3×</option><option value={4}>4×</option></select></Field>}
                {stage.operation === "multi_reference" && <div className="workflow-references"><p>Reference images (up to eight)</p>{draft.assets.map(asset => <label key={asset.id}><input type="checkbox" checked={stage.reference_asset_ids.includes(asset.id)} disabled={!stage.reference_asset_ids.includes(asset.id) && stage.reference_asset_ids.length >= 8} onChange={event => changeStage(stage.id, { reference_asset_ids: event.target.checked ? [...stage.reference_asset_ids, asset.id] : stage.reference_asset_ids.filter(id => id !== asset.id) })} />{asset.name}</label>)}</div>}
                <Field label={`Stage ${index + 1} provider`}><select value={stage.provider_slot} onChange={event => { const provider = catalog.providers.find(item => item.id === event.target.value); changeStage(stage.id, { provider_slot: event.target.value, model_id: provider?.models[0]?.id || "" }); }}>
                  <option value="">Choose a provider</option>
                  {stage.provider_slot && !catalog.providers.some(p => p.id === stage.provider_slot && p.operations.includes(stage.operation)) && <option value={stage.provider_slot}>Unavailable provider: {stage.provider_slot}</option>}
                  {catalog.providers.filter(p => p.operations.includes(stage.operation)).map(p => <option key={p.id} value={p.id} disabled={!p.available}>{p.name}{!p.available ? " (unavailable)" : ""}</option>)}
                </select></Field>
                {stage.operation !== "upscale" && <Field label={`Stage ${index + 1} model`}><select value={stage.model_id || ""} onChange={event => changeStage(stage.id, { model_id: event.target.value })}>
                  <option value="">Choose an installed model</option>
                  {(catalog.providers.find(p => p.id === stage.provider_slot)?.models || []).map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
                </select></Field>}
                {stage.operation!=="txt2img"&&<p className="workflow-source-summary">{stage.source?.kind==='stage'?`Input: Stage ${draft.stages.findIndex(item=>item.id===stage.source.id)+1} image output → Stage ${index+1}`:stage.source?'Input: uploaded image':'Choose a source image.'}</p>}
                {["txt2img", "img2img", "inpaint"].includes(stage.operation) && <ImageResolutionControls width={stage.width} height={stage.height} min={256} max={1024} prefix={`Stage ${index+1} `} locked={stage.lock_aspect_ratio!==false} onLock={locked=>changeStage(stage.id,{lock_aspect_ratio:locked})} sourceSize={sourceDimensions(draft,stage.source)} onChange={size=>changeStage(stage.id,size)}/>}

                {!metadata.supported && <p className="workflow-error">No installed adapter supports this stage. Remove it or choose a supported operation before running.</p>}
              </article>;
            })}
            <div className="workflow-toolbar"><select aria-label="Stage type to add" value={operation} onChange={event => setOperation(event.target.value)}>{catalog.operations.map(item => <option key={item.id} value={item.id}>{item.label}{!item.supported ? " (unavailable)" : ""}</option>)}</select><button disabled={draft.stages.length >= 24} onClick={() => change({ stages: [...draft.stages, stageWithProvider(draft, operation, catalog)] })}>+ Add stage</button></div>
          </section>
        </fieldset>
        <aside className="workflow-inspector">
          <WorkflowRunPanel record={execution} busy={busy} onStop={stop}
            onKeepStitched={async layout => {
              if (actionLock.current) throw new Error("Wait for the current workflow action to finish.");
              actionLock.current = true; setBusy(true);
              try { accept(await api.keepStitched(await saveCurrent(), execution.id, layout)); }
              finally { actionLock.current = false; setBusy(false); }
            }}
            onKeep={output => run(async () => { const saved = await saveCurrent(); accept(await api.keepOutput(saved, execution.id, output.id)); setExecution(await api.runState(saved.id, execution.id)); setNotice("Result kept as an owned reference with its run and stage lineage."); })}
            onUseText={text => { change({ prompt_settings: { ...draft.prompt_settings, prompt: text.slice(0, 12000) } }); setNotice("Description copied to the draft prompt. Review it before saving or running."); }} />
          <section className="workflow-card">
            <h2>Preparation</h2><p>{dirty ? "Unsaved changes" : `Saved revision ${draft.revision}`} · Validate and Prepare save pending changes first.</p>
            <div className="workflow-actions"><button disabled={busy} onClick={() => run(async () => setReport(await api.validate(await saveCurrent())))}>Validate inputs</button><button disabled={busy} onClick={() => run(prepare)}>Prepare snapshot</button><button disabled={busy || !draft.stages.length} onClick={() => run(execute)}>Run workflow</button></div>
            {report && <div aria-live="polite"><h3>{snapshot ? `Snapshot revision ${snapshot.snapshot.revision}` : `Draft revision ${report.revision}`}</h3><p>{report.ready ? "Ready to run with the selected local providers." : "Resolve these issues before running."}</p><ul>{report.issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul></div>}
          </section>
          <section className="workflow-card"><h2>Snapshots and runs</h2><p>Each run keeps its original input snapshot. Select a run to inspect its state and review completed results.</p>
            <div className="workflow-history">{jobs.length ? jobs.map(item => <button key={item.id} disabled={busy} onClick={() => run(async () => { const record = await api.job(draft.id, item.id); setSnapshot(record); setReport(record.preflight); setExecution(item.execution ? await api.runState(draft.id, item.id) : null); })}>Revision {item.revision} · {item.status}<small>{new Date(item.created_at).toLocaleString()}</small></button>) : <p>No snapshots yet.</p>}</div>
            {snapshot && <details><summary>Snapshot JSON and planned output paths</summary><pre>{JSON.stringify(snapshot, null, 2)}</pre></details>}
          </section>
          <section className="workflow-card"><h2>Running and keeping results</h2><p>Workflows share Prompt Queue with chat, image generation and LoRA work. Stop workflow or the sidebar Reset / Unload cancels the current run and waits for the provider to stop.</p><p>Completed images remain separate from references until you choose Keep as reference. Branch next scene copies your owned references; select a kept result as the new source.</p><p>After an interrupted backend restart, review the saved run and start again. Interrupted outputs are never accepted automatically.</p></section>
        </aside>
      </div>}
    </>}
    {busy && <p className="workflow-notice" role="status">Saving or reading local workflow data…</p>}
  </section>;
}
