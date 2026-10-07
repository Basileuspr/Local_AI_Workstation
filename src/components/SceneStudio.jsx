import { useEffect, useRef, useState } from "react";
import * as api from "../imageWorkflowApi";
import * as faces from "../faceApi";
import { runIsActive } from "../imageWorkflow";
import { scenePrompt, SCENE_FIELDS, newSceneObject, DENOISE_PRESETS } from "../sceneState";
import ProtectedImage from "../ImagePrivacy";
import ImageThumbnail from "./ImageThumbnail";
import FreshFileInput from "./FreshFileInput";
import { MAX_IMAGE_STEPS, MAX_IMAGE_GUIDANCE } from "../imageGenerationLimits";
import ImageGenerationSizing from "./ImageGenerationSizing";
import {useImageRemoval} from './ImageRemovalControls';
import ScenePlanner from './ScenePlanner';
import ActionMenu from './ActionMenu';

const LAST_SCENE = "law-last-iterative-scene-v1";
const Field = ({label, children}) => <label className="workflow-field"><span>{label}</span>{children}</label>;

export default function SceneStudio({ active, sceneToOpen, onSceneOpened }) {
  const [catalog, setCatalog] = useState(null), [library, setLibrary] = useState([]), [characters, setCharacters] = useState([]);
  const [draft, setDraft] = useState(null), [dirty, setDirty] = useState(false), [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [frames, setFrames] = useState([]), [runs, setRuns] = useState([]), [execution, setExecution] = useState(null);
  const [advanced, setAdvanced] = useState(""), [characterId, setCharacterId] = useState("");
  const current = useRef(null), version = useRef(0), savedVersion = useRef(0), savingTask = useRef(null), actionLock = useRef(false);
  const openingScene = useRef(null);
  const [removedFrames,setRemovedFrames] = useState([]);
  const frameKey = item => `${draft?.id}:${item.frame.job_id}:${item.frame.output_id}`;
  const visibleFrames = frames.map((item,index) => ({...item,number:frames.length-index})).filter(item => !removedFrames.includes(frameKey(item)));
  const frameRemoval = useImageRemoval(visibleFrames, chosen => setRemovedFrames(ids => [...ids,...chosen.map(frameKey)]), {label:'scene frames',scope:draft?.id,key:frameKey,disabled:busy});
  const identityImages=(draft?.scene?.identity_asset_ids || []).map(id=>({id}));
  const identityRemoval=useImageRemoval(identityImages, removed=>{
    const ids=new Set(removed.map(item=>item.id));
    changeScene({identity_asset_ids:current.current.scene.identity_asset_ids.filter(id=>!ids.has(id))});
  },{label:'scene identity references',scope:draft?.id,disabled:busy||runIsActive(execution)});

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
  async function load(id, cancelled = () => false) {
    const value = await api.get(id);
    if (cancelled()) return;
    accept(value); await history(id);
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
      if (!current.current) setLibrary(listed.workflows.filter(item => item.mode === "scene")); setCharacters(bank.characters);
      const last = localStorage.getItem(LAST_SCENE);
      if (!sceneToOpen && !current.current && listed.workflows.some(item => item.id === last && item.mode === "scene")) await load(last, () => ignore);
      if (!ignore) setCatalog(metadata);
    }).catch(err => { if (!ignore) setError(err.message); });
    return () => { ignore = true; };
  }, [active, catalog, sceneToOpen]);

  async function openRequestedScene() {
    await load(sceneToOpen);
    setNotice("Source image and observed scene details loaded. Review the fields and analysis notes, then describe your next frame.");
    onSceneOpened?.(sceneToOpen);
  }
  useEffect(() => {
    if (!active || !catalog || !sceneToOpen || busy || openingScene.current === sceneToOpen) return;
    openingScene.current = sceneToOpen;
    void run(openRequestedScene);
  }, [active, catalog, sceneToOpen, busy]);

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
  async function proposeScene(input, signal) {
    if (actionLock.current) throw new Error('Another scene action is running. Try again when it finishes.');
    actionLock.current=true; setBusy(true);
    try {
      await persist();
      if (signal.aborted) throw new Error('Planning stopped.');
      return await api.planScene(current.current,input,signal);
    } finally {actionLock.current=false; setBusy(false);}
  }
  const models = catalog?.providers.find(item => item.id === "local-sdxl");
  const scene = draft?.scene, state = scene?.state;
  return <section className="image-workflows scene-studio" aria-label="Iterative scenes">
    <header className="workflow-heading"><div><p className="workflow-eyebrow">PERSISTENT SCENES · ONE FRAME AT A TIME</p><h1>Iterative scenes</h1></div><span className="workflow-badge">Review each result before continuing</span></header>
    {error && <p className="workflow-error" role="alert">{error}</p>}{notice && <p className="workflow-notice" role="status">{notice}</p>}
    {error && sceneToOpen && <button disabled={busy} onClick={() => run(openRequestedScene)}>Retry opening analyzed scene</button>}
    <fieldset className="workflow-toolbar" disabled={busy}>
      <select aria-label="Saved iterative scene" value={draft?.id || ""} onChange={e => run(() => load(e.target.value))}><option value="" disabled>Choose a scene</option>{library.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <button onClick={() => run(async () => { accept(await api.create("scene")); setFrames([]); setRuns([]); setExecution(null); await refreshLibrary(); })}>+ New iterative scene</button>
      {draft && <button onClick={() => run(async () => { await refreshLibrary(); setNotice("Scene saved."); })}>{saving ? "Saving…" : dirty ? "Save scene" : "Saved"}</button>}
      <ActionMenu label="Scene options" actions={[
        draft && {label:'Reload saved', disabled:busy, onClick:() => run(async () => { if (!dirty || window.confirm("Discard unsaved edits and reload the saved scene?")) { if (savingTask.current) await savingTask.current; await load(draft.id); } }, false)},
        {label:'Refresh models and characters', disabled:busy, onClick:() => run(async () => { setCatalog(await api.catalog()); setCharacters((await faces.listCharacters()).characters); await refreshLibrary(); })},
      ]}/>
    </fieldset>
    {!draft ? <div className="workflow-empty"><h2>Keep the scene between frames</h2></div> : <div className="workflow-layout">
      <fieldset className="workflow-editor" disabled={busy}>
        <section className="workflow-card"><Field label="Scene name"><input maxLength={120} value={draft.name} onChange={e => change({name:e.target.value})} /></Field>
          <details><summary>Source analysis and notes</summary><textarea aria-label="Scene analysis notes" rows={8} maxLength={8000} value={draft.scene_notes} onChange={e => change({scene_notes:e.target.value})} /></details>
          <Field label="Visible action"><textarea maxLength={400} rows={3} value={state.current_action} onChange={e => changeState({current_action:e.target.value})} /></Field>
          <Field label="Visual style"><input maxLength={400} value={state.visual_style} onChange={e => changeState({visual_style:e.target.value})} /></Field>

        </section>
        {SCENE_FIELDS.map(([group, label, fields]) => <details className="workflow-card" key={group} open={group === "character" || group === "body"}><summary><strong>{label}</strong></summary>
          {group === "character" && <><Field label="Character Face Bank"><select value={characterId} onChange={e => setCharacterId(e.target.value)}><option value="">Choose a saved character</option>{characters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><button disabled={!characterId} onClick={() => run(async () => { accept(await api.sceneIdentity(current.current, characterId)); setNotice("Selected identity references copied into this scene. Describe appearance below; base SDXL uses that text and the previous frame."); })}>Attach approved identity references</button>{identityRemoval.toolbar}<div className="scene-reference-strip">{identityImages.map((image,index) => <div key={image.id}><ImageThumbnail src={api.assetUrl(draft.id, image.id)} alt="Saved character reference" />{identityRemoval.controls(image, `scene reference ${index+1}`)}</div>)}</div></>}
          {fields.map(([key, title]) => <Field key={key} label={title}><input maxLength={400} value={state[group][key]} onChange={e => changeState({[group]:{...state[group], [key]:e.target.value}})} /></Field>)}
        </details>)}
        <section className="workflow-card"><h2>Objects and contact</h2>
          {state.objects.map((obj, index) => <details className="scene-object" key={obj.id} open><summary>{obj.name || `Object ${index + 1}`}</summary>{["name", "appearance", "position", "orientation", "contact", "progression"].map(key => <Field key={key} label={key === "progression" ? "Progression (for example: 70% inserted)" : key[0].toUpperCase() + key.slice(1)}><input maxLength={400} value={obj[key]} onChange={e => changeState({objects:state.objects.map(item => item.id === obj.id ? {...item, [key]:e.target.value} : item)})} /></Field>)}<button onClick={() => changeState({objects:state.objects.filter(item => item.id !== obj.id)})}>Remove object</button></details>)}
          <button disabled={state.objects.length >= 24} onClick={() => changeState({objects:[...state.objects, newSceneObject()]})}>+ Add object</button>
        </section>
        <details className="workflow-card"><summary>Advanced scene state</summary><button onClick={() => setAdvanced(JSON.stringify(state, null, 2))}>Read current fields</button><textarea aria-label="Scene state JSON" className="scene-json" rows={16} value={advanced} onChange={e => setAdvanced(e.target.value)} /><button onClick={() => run(async () => { const saved = await api.save({...current.current, scene:{...current.current.scene, state:JSON.parse(advanced)}}); accept(saved); })}>Apply JSON state</button></details>
      </fieldset>
      <aside className="workflow-inspector">
        <ScenePlanner key={draft.id} workflow={draft} active={active} busy={busy || dirty || saving || runIsActive(execution)} onPropose={proposeScene}
          onApply={(planId,selected) => run(async () => {
            accept(await api.applyScenePlan(current.current,planId,selected));
            setNotice('Reviewed visual actions applied. Check the scene fields, then generate when ready.');
          })} />
        <fieldset className="workflow-card" disabled={busy}><h2>{scene.source_asset_id ? "Continue from a source" : "Create the first frame"}</h2>
          {scene.source_asset_id && <><ProtectedImage className="scene-source" src={api.assetUrl(draft.id, scene.source_asset_id)} alt="Source for next frame" /><button type="button" onClick={()=>changeScene({source_asset_id:null,parent_frame:null})}>Remove source image</button></>}
          <Field label="Starting image"><FreshFileInput type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) run(async () => { const saved = await api.upload(current.current, file); accept(saved); const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))).map(b => b.toString(16).padStart(2,"0")).join(""); changeScene({source_asset_id:hash, parent_frame:null}); await persist(); }); }} /></Field>
          <Field label="Owned source image"><select value={scene.source_asset_id || ""} onChange={e => changeScene({source_asset_id:e.target.value || null, parent_frame:null})}><option value="">Text to image (no source)</option>{draft.assets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          {scene.parent_frame && <p className="workflow-muted">Parent frame: {scene.parent_frame.output_id.slice(0, 8)}</p>}
          <Field label="Installed SDXL model"><select value={scene.model_id} onChange={e => changeScene({model_id:e.target.value})}><option value="">Choose a model</option>{scene.model_id && !models?.models.some(item => item.id === scene.model_id) && <option value={scene.model_id}>Unavailable: {scene.model_id}</option>}{models?.models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <ImageGenerationSizing width={scene.width} height={scene.height} allowLongWait={scene.allow_long_wait} waitKey="allow_long_wait" limits={catalog?.providers?.find(provider=>provider.id==='local-sdxl')?.resolution_limits} onChange={changeScene} prefix="Scene " />
          <Field label="Denoising strength"><input type="number" min={0} max={1} step={.01} value={scene.denoise} onChange={e => changeScene({denoise:Number(e.target.value)})} /></Field>
          <div className="workflow-actions">{DENOISE_PRESETS.map(item => <button key={item.value} onClick={() => changeScene({denoise:item.value})}>{item.label}</button>)}</div>

          <div className="workflow-numbers">{[["seed", "Seed (−1 = random)",-1,4294967295,1],["steps","Steps",1,MAX_IMAGE_STEPS,1],["guidance","Guidance",0,MAX_IMAGE_GUIDANCE,.1]].map(([key,label,min,max,step]) => <Field label={label} key={key}><input type="number" min={min} max={max} step={step} value={draft.prompt_settings[key]} onChange={e => change({prompt_settings:{...draft.prompt_settings,[key]:Number(e.target.value)}})} /></Field>)}</div>
          <Field label="Negative prompt"><textarea maxLength={12000} rows={2} value={draft.prompt_settings.negative_prompt} onChange={e => change({prompt_settings:{...draft.prompt_settings,negative_prompt:e.target.value}})} /></Field>
          <details><summary>Complete prompt for the next frame</summary><p className="workflow-result-text">{scenePrompt(state) || "Enter visible scene details above."}</p></details>
          <button className="scene-generate" disabled={runIsActive(execution) || !scene.model_id || !models?.available} onClick={() => run(async () => { setExecution(await api.execute(current.current)); await history(current.current.id); })}>{scene.source_asset_id ? "Generate next frame" : "Generate first frame"}</button>
          {models && !models.available && <p className="workflow-muted">CUDA is unavailable. You can edit and save scenes; generation requires the local SDXL runtime.</p>}
        </fieldset>
        {execution && <section className="workflow-card"><h2>Run · {execution.status}</h2><p role="status">{execution.phase}</p>{execution.total_steps > 0 && <progress value={execution.step} max={execution.total_steps} aria-label="Scene generation progress" />}{execution.error && <p className="workflow-error">{execution.error}</p>}{runIsActive(execution) && <button disabled={execution.status === "cancelling"} onClick={() => { void api.stop(execution.workflow_id, execution.id).then(setExecution).catch(err => setError(err.message)); }}>{execution.status === "cancelling" ? "Stopping safely…" : "Stop generation"}</button>}</section>}
        <section className="workflow-card"><h2>Frame history</h2><button disabled={busy} onClick={() => run(() => history(draft.id))}>Refresh history</button>
          {frameRemoval.toolbar}{visibleFrames.length < frames.length && <button onClick={() => setRemovedFrames([])}>Restore removed frames</button>}{visibleFrames.map(item => <article className="scene-frame" key={item.frame.output_id}><ImageThumbnail src={api.outputUrl(draft.id,item.frame.job_id,item.frame.output_id)} alt={`Scene frame ${item.number}`} />{frameRemoval.controls(item, `scene frame ${item.number}`)}<p>Frame {item.number} · {item.operation} · seed {item.seed}{item.operation === "img2img" ? ` · denoise ${item.scene.denoise}` : ""}</p><div className="workflow-actions"><button disabled={busy} onClick={() => run(() => chooseFrame(item.frame,"continue"))}>Use as next source</button><button disabled={busy} onClick={() => run(() => chooseFrame(item.frame,"restore"))}>Restore inputs</button><button disabled={busy} onClick={() => run(() => chooseFrame(item.frame,"branch"))}>Branch from frame</button></div><details><summary>State, prompt and generation record</summary><pre>{JSON.stringify(item,null,2)}</pre></details></article>)}
          {!frames.length && <p>No frames yet. Your scene can be saved before a model is available.</p>}
          <details><summary>Analysis and generation attempts</summary>{runs.map(item => <button className="scene-attempt" key={item.id} disabled={busy} onClick={() => run(async () => setExecution(await api.runState(draft.id,item.id)))}>{new Date(item.created_at).toLocaleString()} · {item.status}</button>)}</details>
        </section>
      </aside>
    </div>}
  </section>;
}
