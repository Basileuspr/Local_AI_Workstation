import {useEffect, useRef, useState} from 'react';
import * as api from '../imageWorkflowApi';
import {reviewedActions} from '../scenePlanner';

export default function ScenePlanner({workflow, active, busy, onPropose, onApply}) {
  const [intention, setIntention] = useState(''), [model, setModel] = useState(''), [models, setModels] = useState([]);
  const [plan, setPlan] = useState(null), [selected, setSelected] = useState([]), [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(null), mounted = useRef(true), lock = useRef(false);
  const stale = plan && (plan.workflow_id !== workflow.id || plan.revision !== workflow.revision);
  function show(value) {setPlan(value); setSelected(value.proposal.actions.map((_,index) => index));}
  async function refreshModels() {
    try {const result = await api.scenePlannerModels(); if (mounted.current) {setModels(result.models); setError('');}}
    catch (failure) {if (mounted.current) setError(failure.message);}
  }
  useEffect(() => {mounted.current=true; return () => {
    mounted.current=false;
    if (pending.current) {pending.current.controller.abort(); void api.stopScenePlan(pending.current.workflowId,pending.current.id).catch(() => {});}
  };}, []);
  useEffect(() => {if(active && !models.length) void refreshModels();}, [active]);
  useEffect(() => {
    let cancelled = false; setPlan(null); setSelected([]); setIntention(''); setError('');
    api.scenePlans(workflow.id).then(result => {if (!cancelled && result.plans.length) show(result.plans[0]);})
      .catch(failure => {if (!cancelled) setError(failure.message);});
    return () => {cancelled = true;};
  }, [workflow.id]);
  async function propose() {
    if (lock.current) return;
    lock.current=true; setWorking(true); setError('');
    const id = crypto.randomUUID().replaceAll('-',''), controller = new AbortController();
    pending.current={id,controller,workflowId:workflow.id};
    try {
      const result = await onPropose({request_id:id,model,intention},controller.signal);
      if (mounted.current && !controller.signal.aborted) show(result);
    } catch (failure) {if (mounted.current) setError(controller.signal.aborted ? 'Planning stopped. Your scene is unchanged.' : failure.message);}
    finally {pending.current=null; lock.current=false; if(mounted.current)setWorking(false);}
  }
  function stop() {
    const current = pending.current;
    if (!current) return;
    current.controller.abort();
    void api.stopScenePlan(current.workflowId,current.id).catch(() => {});
  }
  return <section className="workflow-card" aria-label="Scene planner">
    <h2>Plan the next frame</h2>
    <p>Describe your intention. Review the proposed visual changes before applying them.</p>
    {error && <p className="workflow-error" role="alert">{error}</p>}
    <fieldset disabled={busy || working}>
      <label className="workflow-field"><span>Planning model</span><select value={model} onChange={event => setModel(event.target.value)}><option value="">Choose an installed Ollama model</option>{models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <button type="button" onClick={refreshModels}>Refresh planning models</button>
      <label className="workflow-field"><span>Intention for the next frame</span><textarea rows={3} maxLength={2000} value={intention} onChange={event => setIntention(event.target.value)} placeholder="Turn the wrist slightly clockwise while keeping the grip and camera unchanged." /></label>
      <button type="button" disabled={!model || !intention.trim()} onClick={propose}>Propose visual actions</button>
    </fieldset>
    {working && <><p role="status">Waiting for local inference or planning…</p><button type="button" onClick={stop}>Stop planning</button></>}
    {plan && <div>
      <h3>Review proposed actions</h3><p>{plan.proposal.summary}</p>
      {stale && <p role="status">This scene has changed. Make a new plan before applying actions.</p>}
      {plan.proposal.uncertainties.length > 0 && <div><h4>Uncertainties to review</h4><ul>{plan.proposal.uncertainties.map((text,index) => <li key={index}>{text}</li>)}</ul></div>}
      {reviewedActions(plan,selected).map((action,index) => <div key={index}>
        <label><input type="checkbox" checked={selected.includes(index)} disabled={busy || working || stale} onChange={event => setSelected(values => event.target.checked ? [...values,index] : values.filter(value => value !== index))} /> {index+1}. {action.description}</label>
        <dl>{action.review.map((change,i) => <div key={i}><dt>{change.field}</dt><dd>{change.before} → {change.after}</dd></div>)}</dl>
      </div>)}
      <p>Apply follows the displayed order. Generation remains a separate step.</p>
      <button type="button" disabled={busy || working || stale || !selected.length} onClick={() => onApply(plan.id,selected)}>Apply reviewed actions</button>
      <button type="button" disabled={working} onClick={() => {setPlan(null);setSelected([]);}}>Dismiss proposal</button>
    </div>}
  </section>;
}
