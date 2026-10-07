import { useEffect, useRef, useState } from 'react';
import { useDispatch } from '../useStore';
import { createMessageId } from '../messageIds';
import { defaultStep, launchTargets, loadWorkflows, saveWorkflows, stepTypes, validateWorkflow } from '../functionWorkflow.mjs';
import ActionMenu from './ActionMenu';

const label = type => stepTypes.find(([id]) => id === type)?.[1] || type;
const windowKey = value => JSON.stringify(value);
const windowSteps = type => type.startsWith('window-') || type.startsWith('control-') || type.startsWith('pointer-');
const controlSteps = type => type.startsWith('control-');
function templates() {
  const task = { process: 'Taskmgr', title: '' };
  return [
    { name: 'Task Manager screenshot', steps: [{ type: 'launch', target: 'task-manager' }, { type: 'window-wait', window: task }, { type: 'window-capture', window: task }, { type: 'output-copy' }] },
    { name: 'Folder environment audit', steps: [defaultStep('folder-audit'), { type: 'output-save' }] },
    { name: 'Codex application inspection', steps: [{ type: 'launch', target: 'codex' }, { type: 'window-wait' }, defaultStep('pointer-paste'), { type: 'pointer-click' }] },
    { name: 'Open Phone Link', steps: [{ type: 'launch', target: 'phone-link' }] },
    { name: 'Open Sound settings', steps: [{ type: 'launch', target: 'settings' }, { type: 'launch', target: 'settings-sound' }] },
  ];
}

export default function FunctionBuilder({ legacyBusy = false }) {
  const dispatch = useDispatch();
  const [loaded] = useState(() => { try { return { items: loadWorkflows() }; } catch (error) { return { items: [], error: error.message }; } });
  const [items, setItems] = useState(loaded.items), [draft, setDraft] = useState(null);
  const [error, setError] = useState(loaded.error || ''), [run, setRun] = useState(null);
  const [inspecting, setInspecting] = useState(false), [windows, setWindows] = useState([]), [controls, setControls] = useState({});
  const [starting, setStarting] = useState(false), [handoff, setHandoff] = useState('');
  const [pointing, setPointing] = useState(false);
  const [templateName, setTemplateName] = useState(templates()[0].name);
  const startingRef = useRef(false);
  const busy = legacyBusy || starting || run?.status === 'running';
  const desktop = window.workstationDesktop;
  const supported = !!desktop?.startFunction;
  const call = async (method, value) => {
    if (!desktop?.[method]) throw Error('Fully quit and restart the desktop app to use function sequences.');
    const result = await desktop[method](value);
    if (result?.error && !result?.status) throw Error(result.error);
    return result;
  };
  useEffect(() => {
    if (!supported) return;
    let ended = false, timer;
    async function poll() {
      try { const state = await desktop.functionRunState(); if (state?.error && !state.status) throw Error(state.error); if (!ended) setRun(state); }
      catch (failure) { if (!ended) setError(failure.message); }
      if (!ended) timer = setTimeout(poll, 1000);
    }
    void poll();
    return () => { ended = true; clearTimeout(timer); };
  }, [supported, desktop]);
  async function act(task) { setError(''); try { return await task(); } catch (failure) { setError(failure.message); } }
  function update(index, patch) { setDraft(current => current ? ({ ...current, steps: current.steps.map((step, offset) => offset === index ? { ...step, ...patch } : step) }) : current); }
  function persist(next) { setItems(saveWorkflows(next)); }
  async function scanWindows() {
    setInspecting(true);
    await act(async () => setWindows((await call('inspectFunctionWindow', { action: 'windows' })).windows));
    setInspecting(false);
  }
  async function scanControls(index, step) {
    setInspecting(true);
    await act(async () => {
      const result = await call('inspectFunctionWindow', { action: 'controls', window: step.window });
      setControls(current => ({ ...current, [index]: result.controls }));
      if (!result.controls.some(control => step.type === 'control-set' ? control.canSet : control.canInvoke))
        setError('This window exposes no matching accessible control. Choose a pointed field/button step or use clipboard handoff.');
    });
    setInspecting(false);
  }
  async function pointAt(index) {
    setInspecting(true); setPointing(true);
    await act(async () => {
      const picked = await call('inspectFunctionWindow', { action: 'pick-pointer' });
      setDraft(current => current ? ({ ...current, steps: current.steps.map((step, offset) => offset === index
        ? { ...step, ...picked } : step.type === 'window-wait' && !step.window ? { ...step, window: picked.window } : step) }) : current);
    });
    setPointing(false); setInspecting(false);
  }
  async function start(item) {
    if (startingRef.current || busy) return;
    startingRef.current = true; setStarting(true); setHandoff('');
    await act(async () => { await call('startFunction', item); setRun(await call('functionRunState')); });
    startingRef.current = false; setStarting(false);
  }
  async function stageResult() {
    await act(async () => {
      const result = run?.result;
      const files = [];
      if (result?.image) {
        if (!result.image.startsWith('data:image/png;base64,')) throw Error('Invalid screenshot result.');
        const bytes = Uint8Array.from(atob(result.image.split(',')[1]), character => character.charCodeAt(0));
        files.push(new File([bytes], 'function-screenshot.png', { type: 'image/png' }));
      }
      if (result?.text) files.push(new File([result.text], 'function-result.md', { type: 'text/markdown' }));
      if (!files.length) throw Error('This function has no text or image result.');
      dispatch({ type: 'SET_SIDEBAR_TAB', payload: 'chats' });
      // Wait for the active composer to receive its new props. A handled event is
      // acknowledged through preventDefault; failed staging retains this result.
      let accepted = false;
      for (let attempt = 0; attempt < 20 && !accepted; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        const event = new CustomEvent('stage-function-result', { detail: files, cancelable: true });
        window.dispatchEvent(event); accepted = event.defaultPrevented;
      }
      if (!accepted) throw Error('Open a chat and use Copy result to paste, or try Add to chat again.');
      setHandoff('Added as pending attachments. Review them in Chats, then Send.');
    });
  }
  function newDraft(template) { setError(''); setControls({}); setDraft({ id: createMessageId(), name: template?.name || '', steps: structuredClone(template?.steps || [defaultStep('launch')]) }); }

  return <section className="function-sequences" aria-labelledby="sequences-heading">
    <div className="tools-toolbar"><h2 id="sequences-heading">Function sequences</h2><button disabled={!!loaded.error || !!draft || busy} onClick={() => newDraft()}>+ Create Function</button></div>

    {pointing && <p role="status">Within 5 seconds, move your pointer over the target field or button in the other application. Keep it there; no click is needed.</p>}
    {!supported && <p className="tools-note">Sequences need the desktop app and its updated bridge. Fully quit from the tray and relaunch after building.</p>}
    {!draft && <div className="tools-toolbar" aria-label="Function templates">
      <label>Template<select aria-label="Function template" disabled={!!loaded.error || busy} value={templateName} onChange={event => setTemplateName(event.target.value)}>{templates().map(template => <option key={template.name}>{template.name}</option>)}</select></label>
      <button type="button" disabled={!!loaded.error || busy} onClick={() => newDraft(templates().find(template => template.name === templateName))}>Use template</button>
    </div>}
    {draft && <form className="functions-editor function-sequence-editor" onSubmit={event => { event.preventDefault(); void act(async () => { validateWorkflow(draft); persist(items.some(item => item.id === draft.id) ? items.map(item => item.id === draft.id ? draft : item) : [...items, draft]); setDraft(null); }); }}>
      <label>Function name<input autoFocus required maxLength={80} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })}/></label>
      <ol className="function-step-list">{draft.steps.map((step, index) => <li key={index}>
        {index > 0 && <strong className="function-then">THEN</strong>}
        <div className="function-step">
          <label>Step {index + 1}<select aria-label={`Step ${index + 1} action`} value={step.type} onChange={event => { setControls({}); setDraft({ ...draft, steps: draft.steps.map((current, offset) => offset === index ? defaultStep(event.target.value) : current) }); }}>{stepTypes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          {step.type === 'launch' && <><label>Application<select value={step.target} onChange={event => update(index, { target: event.target.value })}>
            {launchTargets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}
            <option value="program:choose">Choose program / shortcut…</option>
            {step.target?.startsWith('program:') && step.target !== 'program:choose' && <option value={step.target}>{step.programName}</option>}
          </select></label>{step.target?.startsWith('program:') && <button type="button" disabled={busy} onClick={() => act(async () => { const program = await call('chooseProgram'); if (program) update(index, { target: `program:${program.id}`, programName: program.name }); })}>Browse for program</button>}</>}
          {windowSteps(step.type) && <>
            <div className="tools-toolbar"><button type="button" disabled={inspecting || busy || !supported} onClick={scanWindows}>Find open windows</button></div>
            <label>Target window<select value={step.window ? windowKey(step.window) : ''} onChange={event => { setControls({}); update(index, { window: JSON.parse(event.target.value), control: undefined, point: undefined }); }}>
              <option value="" disabled>Open the application, then find its window…</option>
              {step.window && !windows.some(value => windowKey(value) === windowKey(step.window)) && <option value={windowKey(step.window)}>{step.window.process}: {step.window.title || 'any unique title'}</option>}
              {windows.map((value, offset) => <option key={offset} value={windowKey(value)}>{value.process}: {value.title}</option>)}
            </select></label>
            {step.window && <label><input type="checkbox" checked={!step.window.title} onChange={event => update(index, { window: { ...step.window, title: event.target.checked ? '' : windows.find(value => value.process === step.window.process)?.title || '' }, control: undefined })}/>Match any title (requires exactly one window for this application)</label>}

          </>}
          {controlSteps(step.type) && <>
            <button type="button" disabled={!step.window || inspecting || busy || !supported} onClick={() => scanControls(index, step)}>Pick accessible control</button>
            <label>{step.type === 'control-set' ? 'Text field' : 'Button to press'}<select value={step.control ? JSON.stringify(step.control) : ''} onChange={event => update(index, { control: JSON.parse(event.target.value) })}>
              <option value="" disabled>Choose a unique named control…</option>
              {step.control && <option value={JSON.stringify(step.control)}>{step.control.name || step.control.automationId}</option>}
              {(controls[index] || []).filter(control => step.type === 'control-set' ? control.canSet : control.canInvoke).map((control, offset) => <option key={offset} value={JSON.stringify(control)}>{control.name || '(unnamed)'} — {control.controlType} {control.automationId}</option>)}
            </select></label>

          </>}
          {step.type.startsWith('pointer-') && <><button type="button" disabled={inspecting || busy || !supported} onClick={() => pointAt(index)}>Point at {step.type === 'pointer-paste' ? 'text field' : 'button'} (5 seconds)</button>
            <small>{step.point ? `Recorded position ${step.point.x}, ${step.point.y} in a ${step.point.width} × ${step.point.height} window.` : 'No position recorded.'}</small>
            </>}
          {(step.type === 'text' || step.type === 'control-set' || step.type === 'pointer-paste') && <label>Request / text<textarea rows={5} maxLength={32000} value={step.text} onChange={event => update(index, { text: event.target.value })}/></label>}
          {(step.type === 'folder-audit' || step.type === 'output-save') && <><button type="button" disabled={busy || !supported} onClick={() => act(async () => { const folder = await call('chooseFunctionFolder', step.type === 'folder-audit' ? 'audit' : 'output'); if (folder) update(index, { folderId: folder.id, folderName: folder.name }); })}>Browse {step.type === 'folder-audit' ? 'folder to inspect' : 'output folder'}</button><small>{step.folderName || 'No folder selected'}</small></>}
          {step.type === 'folder-audit' && <label>Subfolder depth (0–8)<input type="number" min={0} max={8} value={step.depth} onChange={event => update(index, { depth: Number(event.target.value) })}/></label>}


          <div className="tools-toolbar"><button type="button" disabled={index === 0} onClick={() => { const steps = [...draft.steps]; [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]]; setControls({}); setDraft({ ...draft, steps }); }}>Move up</button>
            <button type="button" disabled={index === draft.steps.length - 1} onClick={() => { const steps = [...draft.steps]; [steps[index + 1], steps[index]] = [steps[index], steps[index + 1]]; setControls({}); setDraft({ ...draft, steps }); }}>Move down</button>
            <button type="button" disabled={draft.steps.length === 1} onClick={() => { setControls({}); setDraft({ ...draft, steps: draft.steps.filter((_, offset) => offset !== index) }); }}>Remove step</button></div>
        </div>
      </li>)}</ol>
      <div className="tools-toolbar"><button type="button" disabled={draft.steps.length >= 30} onClick={() => setDraft({ ...draft, steps: [...draft.steps, defaultStep('launch')] })}>+ THEN add step</button><button type="submit">Save function</button><button type="button" onClick={() => setDraft(null)}>Cancel</button></div>

    </form>}
    {error && <p className="functions-error" role="alert">{error}</p>}
    <div className="functions-buttons">{items.map(item => <article className="function-custom" key={item.id}>
      <button className="function-launcher" disabled={busy || !supported} onClick={() => start(item)}><strong>Run {item.name}</strong><span>{item.steps.map(step => label(step.type)).join(' → ')}</span></button>
      <ActionMenu label="Function options" title={`Options for ${item.name}`} actions={[
        {label:'Edit', disabled:!!draft || busy, onClick:() => { setControls({}); setDraft(structuredClone(item)); }},
        {label:'Duplicate', disabled:!!draft || busy, onClick:() => newDraft({ ...item, name: `${item.name.slice(0, 70)} copy` })},
        {label:'Remove', danger:true, disabled:busy, onClick:() => { if (window.confirm(`Remove function "${item.name}"?`)) void act(async () => persist(items.filter(value => value.id !== item.id))); }},
      ]}/>
    </article>)}</div>
    {run && <section className="function-result" aria-label="Function run result">
      <div className="tools-toolbar"><strong>{run.name}</strong><span role="status">{run.status}{run.status === 'running' ? ` · Step ${run.index + 1} of ${run.steps.length}` : ''}</span>{run.status === 'running' && <button onClick={() => act(() => call('stopFunction', run.id))}>Stop function</button>}</div>
      <ol>{run.steps.map((step, index) => <li key={index}>{label(step.type)} — {step.status}{step.detail && <small> · {step.detail}</small>}</li>)}</ol>
      {run.error && <p className="functions-error" role="alert">{run.error}</p>}
      {run.result?.image && <img src={run.result.image} alt="Captured function window"/>}
      {run.result?.text && <textarea readOnly aria-label="Function result text" rows={10} value={run.result.text}/>}
      {run.result?.saved?.map(filename => <p key={filename}>Saved: {filename}</p>)}
      {run.status !== 'running' && (run.result?.text || run.result?.image) && <div className="tools-toolbar"><button onClick={stageResult}>Add result to chat</button>{run.result.image && <button onClick={() => act(() => call('copyImage', run.result.image))}>Copy screenshot</button>}{run.result.text && <button onClick={() => act(() => navigator.clipboard.writeText(run.result.text))}>Copy text</button>}</div>}
      {handoff && <p role="status">{handoff}</p>}
    </section>}

  </section>;
}
