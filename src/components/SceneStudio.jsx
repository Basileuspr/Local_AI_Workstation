import { useEffect, useRef, useState } from "react";
import * as api from "../imageWorkflowApi";
import * as faces from "../faceApi";
import { runIsActive } from "../imageWorkflow";
import { scenePrompt, SCENE_FIELDS, newSceneObject, DENOISE_PRESETS } from "../sceneState";
import ProtectedImage from "../ImagePrivacy";
import FreshFileInput from "./FreshFileInput";

const LAST_SCENE = "law-last-iterative-scene-v1";
const Field = ({label, help, children}) => <label className="workflow-field"><span>{label}</span>{children}{help && <small>{help}</small>}</label>;

export default function SceneStudio({ active }) {
  const [catalog, setCatalog] = useState(null), [library, setLibrary] = useState([]), [characters, setCharacters] = useState([]);
  const [draft, setDraft] = useState(null), [dirty, setDirty] = useState(false), [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [frames, setFrames] = useState([]), [runs, setRuns] = useState([]), [execution, setExecution] = useState(null);
  const [advanced, setAdvanced] = useState(""), [characterId, setCharacterId] = useState("");
  const current = useRef(null), version = useRef(0), savedVersion = useRef(0), savingTask = useRef(null), actionLock = useRef(false);

  function accept(value) {
    current.current = value; version.current = 0; savedVersion.current = 0;
    setDraft(value); setDirty(false); setAdvanced(JSON.stringify(value.scene.state, null, 2));
    setLibrary(items => [{id:value.id,name:value.name,mode:value.mode,revision:value.revision}, ...items.filter(item => item.id !== value.id)]);
    localStorage.setItem(LAST_SCENE, value.id);
  }
  function change(update) {
    const next = {...current.current, ...update};
    current.current = next; version.current++; setDraft(next); setDirty(true); setError("");
  }
  const changeScene = update => change({scene:{...current.current.scene, ...update}});
  const changeState = update => changeScene({state:{...current.current.scene.state, ...update}});

  async function persist() {
    while (savedVersion.current < version.current) {
      if (!savingTask.current) {
        const value = current.current, editingVersion = version.current;
        setSaving(true);
        savingTask.current = api.save(value).then(saved => {
          // A keystroke during this request must survive its response.
          current.current = version.current === editingVersion ? saved : {...current.current, revision:saved.revision, assets:saved.assets};
          savedVersion.current = editingVersion;
          setDraft(current.current); setDirty(version.current !== editingVersion);
          setLibrary(items => items.map(item => item.id === saved.id ? {...item,name:saved.name,revision:saved.revision} : item));
          return saved;
        }).finally(() => { savingTask.current = null; setSaving(false); });
      }
      await savingTask.current;
    }
    return current.current;
  }
  async function history(id) {
    const [results, jobs] = await Promise.all([api.sceneFrames(id), api.jobs(id)]);
    if (current.current?.id !== id) return;
    setFrames(results.frames); setRuns(jobs.jobs.filter(item => item.execution));
    if (results.warnings.length) setNotice(results.warnings.join(" "));
  }
  async function refreshLibrary() { const data = await api.list(); setLibrary(data.workflows.filter(item => item.mode === "scene")); }
  async function load(id) {
    const value = await api.get(id); accept(value); await history(id);
    const jobs = await api.jobs(id), latest = jobs.jobs.find(item => item.execution);
    setExecution(latest ? await api.runState(id, latest.id) : null);
  }
  async function run(action, save = true) {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError(""); setNotice("");
    try { if (save) await persist(); await action(); }
    catch (err) { setError(err.message); }
    finally { actionLock.current = false; setBusy(false); }
  }

  useEffect(() => {
    if (!active || catalog) return;
    let ignore = false;
    Promise.all([api.catalog(), api.list(), faces.listCharacters()]).then(async ([metadata, listed, bank]) => {
      if (ignore) return;
      setCatalog(metadata); if (!current.current) setLibrary(listed.workflows.filter(item => item.mode === "scene")); setCharacters(bank.characters);
      const last = localStorage.getItem(LAST_SCENE);
      if (listed.workflows.some(item => item.id === last && item.mode === "scene")) await load(last);
    }).catch(err => { if (!ignore) setError(err.message); });
    return () => { ignore = true; };
  }, [active, catalog]);

  useEffect(() => {
    if (!dirty || busy || error) return;
    const timer = setTimeout(() => { void persist().catch(err => setError(`Save failed: ${err.message}`)); }, 900);
    return () => clearTimeout(timer);
  }, [draft, dirty, busy, error]);
  useEffect(() => {
    if (!dirty) return;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (!runIsActive(execution)) return;
    let ignore = false, timer;
    const poll = async () => {
      try {
        const record = await api.runState(execution.workflow_id, execution.id);
        if (ignore) return;
        setExecution(record);
        if (!runIsActive(record)) { await history(record.workflow_id); return; }
      } catch (err) { if (!ignore) setError(`Run status unavailable: ${err.message}. It may still be running.`); }
      if (!ignore) timer = setTimeout(poll, 1000);
    };
    void poll();
    return () => { ignore = true; clearTimeout(timer); };
  }, [execution?.id, execution?.status]);

  async function chooseFrame(frame, action) {
    const value = await api.sceneFrame(current.current, frame, action);
    accept(value); await history(value.id); await refreshLibrary();
    setNotice(action === "restore" ? "Original state, source and seed restored. Generate creates a new result." : "Selected frame is now the source. Edit only the details that change, then generate.");
    setExecution(null);
  }
  const models = catalog?.providers.find(item => item.id === "local-sdxl");
  const scene = draft?.scene, state = scene?.state;
  return <section className="image-workflows scene-studio" aria-label="Iterative scenes">
    <header className="workflow-heading"><div><p className="workflow-eyebrow">PERSISTENT SCENES · ONE FRAME AT A TIME</p><h1>Iterative scenes</h1><p>Describe what stays in view, change a few details, then continue from a chosen frame.</p></div><span className="workflow-badge">Review each result before continuing</span></header>
    {error && <p className="workflow-error" role="alert">{error}</p>}{notice && <p className="workflow-notice" role="status">{notice}</p>}
    <fieldset className="workflow-toolbar" disabled={busy}>
      <select aria-label="Saved iterative scene" value={draft?.id || ""} onChange={e => run(() => load(e.target.value))}><option value="" disabled>Choose a scene</option>{library.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <button onClick={() => run(async () => { accept(await api.create("scene")); setFrames([]); setRuns([]); setExecution(null); await refreshLibrary(); })}>+ New iterative scene</button>
      {draft && <><button onClick={() => run(async () => { await refreshLibrary(); setNotice("Scene saved."); })}>{saving ? "Saving…" : dirty ? "Save scene" : "Saved"}</button><button onClick={() => run(async () => { if (!dirty || window.confirm("Discard unsaved edits and reload the saved scene?")) { if (savingTask.current) await savingTask.current; await load(draft.id); } }, false)}>Reload saved</button></>}
      <button onClick={() => run(async () => { setCatalog(await api.catalog()); setCharacters((await faces.listCharacters()).characters); await refreshLibrary(); })}>Refresh models and characters</button>
    </fieldset>
    {!draft ? <div className="workflow-empty"><h2>Keep the scene between frames</h2><p>Create a scene to save character details, camera, lighting, pose and objects. Generate the first frame from text or attach a starting image.</p></div> : <div className="workflow-layout">
      <fieldset className="workflow-editor" disabled={busy}>
        <section className="workflow-card"><Field label="Scene name"><input maxLength={120} value={draft.name} onChange={e => change({name:e.target.value})} /></Field>
          <Field label="Visible action" help="Describe the resulting pose and contact: right hand grips the screwdriver, wrist rotated clockwise, screw sits deeper in the board."><textarea maxLength={400} rows={3} value={state.current_action} onChange={e => changeState({current_action:e.target.value})} /></Field>
          <Field label="Visual style"><input maxLength={400} value={state.visual_style} onChange={e => changeState({visual_style:e.target.value})} /></Field>
          <p className="workflow-muted">Edits save automatically. Describe each change in the fields below; all other details carry forward. Natural-language action planning is a later feature.</p>
        </section>
        {SCENE_FIELDS.map(([group, label, fields]) => <details className="workflow-card" key={group} open={group === "character" || group === "body"}><summary><strong>{label}</strong></summary>
          {group === "character" && <><Field label="Character Face Bank"><select value={characterId} onChange={e => setCharacterId(e.target.value)}><option value="">Choose a saved character</option>{characters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><button disabled={!characterId} onClick={() => run(async () => { accept(await api.sceneIdentity(current.current, characterId)); setNotice("Selected identity references copied into this scene. Describe appearance below; base SDXL uses that text and the previous frame."); })}>Attach approved identity references</button><p className="workflow-muted">Copies the profile’s chosen primary and additional references. They remain saved for review; this SDXL adapter conditions on the previous frame and text, without a face adapter.</p><div className="scene-reference-strip">{scene.identity_asset_ids.map(id => <ProtectedImage key={id} src={api.assetUrl(draft.id, id)} alt="Saved character reference" />)}</div></>}
          {fields.map(([key, title]) => <Field key={key} label={title}><input maxLength={400} value={state[group][key]} onChange={e => changeState({[group]:{...state[group], [key]:e.target.value}})} /></Field>)}
        </details>)}
        <section className="workflow-card"><h2>Objects and contact</h2><p>Keep each object’s identity while changing placement, contact or progress.</p>
          {state.objects.map((obj, index) => <details className="scene-object" key={obj.id} open><summary>{obj.name || `Object ${index + 1}`}</summary>{["name", "appearance", "position", "orientation", "contact", "progression"].map(key => <Field key={key} label={key === "progression" ? "Progression (for example: 70% inserted)" : key[0].toUpperCase() + key.slice(1)}><input maxLength={400} value={obj[key]} onChange={e => changeState({objects:state.objects.map(item => item.id === obj.id ? {...item, [key]:e.target.value} : item)})} /></Field>)}<button onClick={() => changeState({objects:state.objects.filter(item => item.id !== obj.id)})}>Remove object</button></details>)}
          <button disabled={state.objects.length >= 24} onClick={() => changeState({objects:[...state.objects, newSceneObject()]})}>+ Add object</button>
        </section>
        <details className="workflow-card"><summary>Advanced scene state</summary><p>Inspect or edit the complete state as JSON. Applying it validates and saves the state; invalid data leaves the saved version intact.</p><button onClick={() => setAdvanced(JSON.stringify(state, null, 2))}>Read current fields</button><textarea aria-label="Scene state JSON" className="scene-json" rows={16} value={advanced} onChange={e => setAdvanced(e.target.value)} /><button onClick={() => run(async () => { const saved = await api.save({...current.current, scene:{...current.current.scene, state:JSON.parse(advanced)}}); accept(saved); })}>Apply JSON state</button></details>
      </fieldset>
      <aside className="workflow-inspector">
        <fieldset className="workflow-card" disabled={busy}><h2>{scene.source_asset_id ? "Continue from a source" : "Create the first frame"}</h2>
          {scene.source_asset_id && <ProtectedImage className="scene-source" src={api.assetUrl(draft.id, scene.source_asset_id)} alt="Source for next frame" />}
          <Field label="Starting image" help="Optional for the first frame. Upload copies an image into this scene."><FreshFileInput type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) run(async () => { const saved = await api.upload(current.current, file); accept(saved); const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))).map(b => b.toString(16).padStart(2,"0")).join(""); changeScene({source_asset_id:hash, parent_frame:null}); await persist(); }); }} /></Field>
          <Field label="Owned source image"><select value={scene.source_asset_id || ""} onChange={e => changeScene({source_asset_id:e.target.value || null, parent_frame:null})}><option value="">Text to image (no source)</option>{draft.assets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          {scene.parent_frame && <p className="workflow-muted">Parent frame: {scene.parent_frame.output_id.slice(0, 8)}</p>}
          <Field label="Installed SDXL model"><select value={scene.model_id} onChange={e => changeScene({model_id:e.target.value})}><option value="">Choose a model</option>{scene.model_id && !models?.models.some(item => item.id === scene.model_id) && <option value={scene.model_id}>Unavailable: {scene.model_id}</option>}{models?.models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <div className="workflow-numbers">{["width", "height"].map(key => <Field key={key} label={key}><input type="number" min={256} max={1024} step={8} value={scene[key]} onChange={e => changeScene({[key]:Number(e.target.value)})} /></Field>)}</div>
          <Field label="Denoising strength" help="Small changes: 0.15–0.30. Moderate changes: 0.30–0.50. Higher values can redesign the scene; 0 preserves the source."><input type="number" min={0} max={1} step={.01} value={scene.denoise} onChange={e => changeScene({denoise:Number(e.target.value)})} /></Field>
          <div className="workflow-actions">{DENOISE_PRESETS.map(item => <button key={item.value} onClick={() => changeScene({denoise:item.value})}>{item.label}</button>)}</div>
          <p className="workflow-muted">Denoising applies when a source is selected. Continuity depends on the model; review hands, objects and identity after every frame.</p>
          <div className="workflow-numbers">{[["seed", "Seed (−1 = random)",-1,4294967295,1],["steps","Steps",1,60,1],["guidance","Guidance",0,30,.1]].map(([key,label,min,max,step]) => <Field label={label} key={key}><input type="number" min={min} max={max} step={step} value={draft.prompt_settings[key]} onChange={e => change({prompt_settings:{...draft.prompt_settings,[key]:Number(e.target.value)}})} /></Field>)}</div>
          <Field label="Negative prompt"><textarea maxLength={12000} rows={2} value={draft.prompt_settings.negative_prompt} onChange={e => change({prompt_settings:{...draft.prompt_settings,negative_prompt:e.target.value}})} /></Field>
          <details><summary>Complete prompt for the next frame</summary><p className="workflow-result-text">{scenePrompt(state) || "Enter visible scene details above."}</p></details>
          <button className="scene-generate" disabled={runIsActive(execution) || !scene.model_id || !models?.available} onClick={() => run(async () => { setExecution(await api.execute(current.current)); await history(current.current.id); })}>{scene.source_asset_id ? "Generate next frame" : "Generate first frame"}</button>
          {models && !models.available && <p className="workflow-muted">CUDA is unavailable. You can edit and save scenes; generation requires the local SDXL runtime.</p>}
        </fieldset>
        {execution && <section className="workflow-card"><h2>Generation · {execution.status}</h2><p role="status">{execution.phase}</p>{execution.total_steps > 0 && <progress value={execution.step} max={execution.total_steps} aria-label="Scene generation progress" />}{execution.error && <p className="workflow-error">{execution.error}</p>}{runIsActive(execution) && <button disabled={execution.status === "cancelling"} onClick={() => { void api.stop(execution.workflow_id, execution.id).then(setExecution).catch(err => setError(err.message)); }}>{execution.status === "cancelling" ? "Stopping safely…" : "Stop generation"}</button>}</section>}
        <section className="workflow-card"><h2>Frame history</h2><p>Choosing a frame restores its state. Continue edits from there, restore its original inputs to regenerate, or create a separate branch. Earlier frames remain saved.</p><button disabled={busy} onClick={() => run(() => history(draft.id))}>Refresh history</button>
          {frames.map((item, index) => <article className="scene-frame" key={item.frame.output_id}><ProtectedImage src={api.outputUrl(draft.id,item.frame.job_id,item.frame.output_id)} alt={`Scene frame ${frames.length - index}`} /><p>Frame {frames.length - index} · {item.operation} · seed {item.seed}{item.operation === "img2img" ? ` · denoise ${item.scene.denoise}` : ""}</p><div className="workflow-actions"><button disabled={busy} onClick={() => run(() => chooseFrame(item.frame,"continue"))}>Use as next source</button><button disabled={busy} onClick={() => run(() => chooseFrame(item.frame,"restore"))}>Restore inputs</button><button disabled={busy} onClick={() => run(() => chooseFrame(item.frame,"branch"))}>Branch from frame</button></div><details><summary>State, prompt and generation record</summary><pre>{JSON.stringify(item,null,2)}</pre></details></article>)}
          {!frames.length && <p>No frames yet. Your scene can be saved before a model is available.</p>}
          <details><summary>All generation attempts</summary>{runs.map(item => <button className="scene-attempt" key={item.id} disabled={busy} onClick={() => run(async () => setExecution(await api.runState(draft.id,item.id)))}>{new Date(item.created_at).toLocaleString()} · {item.status}</button>)}</details>
        </section>
      </aside>
    </div>}
  </section>;
}
