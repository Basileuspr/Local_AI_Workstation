import { useEffect, useRef, useState } from 'react';
import * as workflows from '../imageWorkflowApi';
import { uploadMagicAsset } from '../imageMagic';
import { appendReferencePrompt, REFERENCE_FIELDS as fields } from '../generationReference';

export default function ReferenceAnalysis({ reference, prompt, onPrompt, onBusyChange }) {
  const [models, setModels] = useState([]), [model, setModel] = useState('');
  const [analysis, setAnalysis] = useState(null), [selected, setSelected] = useState(Object.keys(fields));
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('');
  const mounted = useRef(true), running = useRef(false), cancelled = useRef(false), job = useRef(null);
  const busyCallback = useRef(onBusyChange); busyCallback.current = onBusyChange;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancelled.current = true; busyCallback.current?.(false);
      if (job.current) void workflows.stop(...job.current).catch(() => {}); };
  }, []);
  function check() { if (cancelled.current || !mounted.current) throw new Error('Reference analysis stopped. Your prompt is unchanged.'); }
  async function discover() {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    try {
      const catalog = await workflows.catalog();
      if (!mounted.current) return;
      const installed = catalog.providers?.find(provider => provider.id === 'ollama-vision')?.models || [];
      setModels(installed); setModel(current => installed.some(item => item.id === current) ? current : installed[0]?.id || '');
      setStatus(installed.length ? 'Choose a vision model, then read the reference.' : 'Install an Ollama vision model to read reference details. Presets and image-to-image generation are available without it.');
    } catch (failure) { if (mounted.current) setError(failure.message); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  async function analyze() {
    if (running.current || !model) return;
    running.current = true; cancelled.current = false; setBusy(true); busyCallback.current?.(true); setError('');
    try {
      setStatus('Saving reference for local analysis…');
      let workflow = await workflows.create(); check();
      const uploaded = await uploadMagicAsset(workflow, reference.file); check();
      workflow = await workflows.save({...uploaded.workflow, name: 'Generate · likeness and emulation analysis',
        stages: [{id: crypto.randomUUID().replaceAll('-', ''), operation: 'describe', analysis_kind: 'reference',
          provider_slot: 'ollama-vision', model_id: model, source: {kind: 'asset', id: uploaded.id}, width: 512, height: 512}]});
      check();
      let run = await workflows.execute(workflow);
      job.current = [workflow.id, run.id];
      if (cancelled.current || !mounted.current) { await workflows.stop(...job.current); check(); }
      while (['queued', 'running', 'cancelling'].includes(run.status)) {
        check(); setStatus(run.phase || run.status);
        await new Promise(resolve => setTimeout(resolve, 750)); check();
        run = await workflows.runState(...job.current);
      }
      check();
      if (run.status !== 'completed') throw new Error(run.error || `Reference analysis ${run.status}.`);
      const result = run.stage_results?.[0]?.metadata?.reference_analysis;
      if (!result) throw new Error('No reference details were returned. Retry with a vision model.');
      setAnalysis(result); setStatus('Review the details and choose what to add to your prompt.');
    } catch (failure) { if (mounted.current) { setStatus(''); setError(failure.message); } }
    finally { job.current = null; running.current = false; if (mounted.current) { setBusy(false); busyCallback.current?.(false); } }
  }
  async function stop() {
    cancelled.current = true; setStatus('Stopping reference analysis…');
    if (job.current) try { await workflows.stop(...job.current); } catch (failure) { if (mounted.current) setError(failure.message); }
  }
  return <details className="reference-analysis">
    <summary>Read likeness, style and composition</summary>

    <button type="button" disabled={busy} onClick={discover}>Find vision models</button>
    {!!models.length && <label>Reference vision model<select value={model} disabled={busy} onChange={event => setModel(event.target.value)}>
      {models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>}
    <button type="button" disabled={busy || !model} onClick={analyze}>Read reference details</button>
    {busy && job.current && <button type="button" onClick={stop}>Stop analysis</button>}
    {status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}
    {analysis && <>
      {Object.entries(fields).map(([key, label]) => <div key={key}>
        <label className="reference-detail-choice"><input type="checkbox" checked={selected.includes(key)} disabled={busy}
          onChange={event => setSelected(items => event.target.checked ? [...items, key] : items.filter(item => item !== key))}/>{label}</label>
        <textarea aria-label={`Reference ${label.toLowerCase()}`} rows={3} maxLength={key === 'appearance' ? 1400 : key === 'lighting' ? 800 : 1000} value={analysis[key]} disabled={busy}
          onChange={event => setAnalysis(current => ({...current, [key]: event.target.value}))}/>
      </div>)}
      {!!analysis.uncertainties?.length && <p>Review: {analysis.uncertainties.join(' ')}</p>}
      <button type="button" disabled={busy || !selected.length} onClick={() => {
        try { onPrompt(appendReferencePrompt(prompt, analysis, selected)); setError(''); setStatus('Selected details added to your prompt. Review it before generating.'); }
        catch (failure) { setError(failure.message); }
      }}>Add selected details to prompt</button>
    </>}
  </details>;
}
