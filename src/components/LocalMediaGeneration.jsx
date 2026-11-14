import {useEffect, useRef, useState} from 'react';
import {apiUrl} from '../api';
import {fetchWorkload, createPollingObserver, readPollingJson} from '../polling';
import {mediaJobsObserver} from '../appPolling';
import {pendingJob} from '../pollingPolicies';
import MediaGenerationProgress from './MediaGenerationProgress';
import ProtectedImage from '../ImagePrivacy';
import './LocalMediaGeneration.css';

export async function mediaRequest(path, body) {
  const response = await (body === undefined ? fetch : fetchWorkload)(apiUrl('/media-generation' + path), body === undefined ? {signal: AbortSignal.timeout(15000)} : {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Check the generation settings and try again.');
  return data;
}

export default function LocalMediaGeneration({active = true}) {
  const section = useRef(null);
  const [catalog, setCatalog] = useState(null), [jobs, setJobs] = useState([]);
  const [modelId, setModelId] = useState(''), [prompt, setPrompt] = useState(''), [negative, setNegative] = useState('');
  const [width, setWidth] = useState(512), [height, setHeight] = useState(512), [steps, setSteps] = useState(20);
  const [guidance, setGuidance] = useState(5), [seed, setSeed] = useState(''), [frames, setFrames] = useState(17), [fps, setFps] = useState(16);
  const [references, setReferences] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [pollError, setPollError] = useState(''), [catalogError, setCatalogError] = useState('');
  const [receivedAt, setReceivedAt] = useState(0), [clock, setClock] = useState(Date.now());
  const [accepted, setAccepted] = useState(''), [stopping, setStopping] = useState([]);
  const pending = jobs.filter(pendingJob), history = jobs.filter(job => !pendingJob(job));
  const model = catalog?.models.find(item => item.id === modelId);
  const video = model?.kind === 'video';
  useEffect(() => {if (!active) section.current?.querySelectorAll('video').forEach(player => player.pause());}, [active]);
  useEffect(() => {
    if (!active) return;
    // Model inventory failures must not hide live progress or Stop controls.
    const models = createPollingObserver({read: options => readPollingJson(apiUrl('/media-generation/models'), options), interval: () => 30000});
    const detachModels = models.subscribe({data: next => {setCatalog(next); setCatalogError('');}, error: failure => setCatalogError(failure.message)});
    const detachJobs = mediaJobsObserver().subscribe({data: next => {
      setJobs(next.jobs); setPollError(''); setReceivedAt(Date.now()); setClock(Date.now());
    }, error: () => setPollError('Progress connection unavailable. Last reported jobs are retained; reconnecting…')});
    return () => {detachModels(); detachJobs();};
  }, [active]);
  useEffect(() => {
    if (!active || !pending.length || pollError) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, pending.length, pollError]);
  function choose(identifier) {
    const next = catalog.models.find(item => item.id === identifier);
    setModelId(identifier); setSteps(next?.steps || 20); setGuidance(next?.guidance || 5);
    setWidth(next?.width || 512); setHeight(next?.height || 512);
    if (next?.kind === 'video') setReferences(previous => previous.slice(0, 1));
  }
  async function upload(event) {
    const files = [...event.target.files]; event.target.value = '';
    if (!files.length) return;
    const limit = video ? 1 : 4;
    if (references.length + files.length > limit) {setError(`Choose at most ${limit} reference image(s).`); return;}
    setBusy(true); setError('');
    try {
      const added = [];
      for (const file of files) {
        const form = new FormData(); form.append('file', file);
        const response = await fetch(apiUrl('/image-generation/references'), {method: 'POST', body: form});
        const data = await response.json();
        if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Could not read the reference image.');
        added.push(data);
      }
      setReferences(previous => [...previous, ...added]);
    } catch (failure) {setError(failure.message);}
    finally {setBusy(false);}
  }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await mediaRequest('/jobs', {model_id: modelId, prompt, negative_prompt: negative, width: Number(width), height: Number(height),
        steps: Number(steps), guidance: Number(guidance), seed: seed === '' ? null : Number(seed),
        references: references.map(item => item.reference), frames: Number(frames), fps: Number(fps)});
      setAccepted(result.id); mediaJobsObserver().invalidate();
    } catch (failure) {setError(failure.message);}
    finally {setBusy(false);}
  }
  async function stop(identifier) {
    setError(''); setStopping(previous => [...previous, identifier]);
    try {await mediaRequest(`/jobs/${identifier}/cancel`, {}); mediaJobsObserver().invalidate();}
    catch (failure) {setError(failure.message);}
    finally {setStopping(previous => previous.filter(id => id !== identifier));}
  }
  function jobCard(job) {
    return <article key={job.id}>
      <h3>{job.name}</h3>
      {pendingJob(job) ? <MediaGenerationProgress job={job} unavailable={Boolean(pollError)} age={Math.max(0, clock - receivedAt) / 1000}/>
        : <p role="status">{job.status} · {job.phase}{Number.isFinite(job.progress?.elapsed_seconds) ? ` · ${Math.round(job.progress.elapsed_seconds)}s elapsed` : ''}</p>}
      <p>Seed {job.request.seed}</p><p>{job.request.prompt}</p>{job.error && <p role="alert">{job.error}</p>}
      {pendingJob(job) && <button type="button" disabled={job.status === 'cancelling' || stopping.includes(job.id)} onClick={() => stop(job.id)}>{job.status === 'cancelling' || stopping.includes(job.id) ? 'Stopping…' : 'Stop'}</button>}
      {job.url && <>{job.kind === 'video' ? <video controls preload="metadata" src={apiUrl(job.url)}/> : <ProtectedImage alt="Generated image" loading="lazy" src={apiUrl(job.url)}/>}
        <a href={apiUrl(job.url + '?download=true')} download>Save {job.kind}</a></>}
    </article>;
  }
  return <section ref={section} className="local-media-generation" aria-label="Qwen images and Wan video">
    <h1>Qwen images &amp; Wan video</h1>
    <p>Create or edit images with Qwen, or generate video from text or an image with Wan. Jobs share the local model queue and continue when you leave this tab.</p>
    <p>Large models can take several minutes to load and much longer to generate while using disk offloading. Stop remains available during loading.</p>
    {error && <p role="alert">{error}</p>}
    {catalogError && <p role="alert">Model availability could not be refreshed. {catalogError}</p>}
    {pollError && <p role="alert">{pollError}</p>}
    {accepted && !jobs.some(job => job.id === accepted) && <p role="status">Request accepted. Waiting for its queue status…</p>}
    {pending.length > 0 && <section aria-label="Active generations"><h2>Running &amp; waiting ({pending.length})</h2><div className="local-media-history">{pending.map(jobCard)}</div></section>}
    {catalog && !catalog.runtime_ready && <p role="status">The local generation runtime is not installed. Follow the setup guide for Qwen and Wan.</p>}
    <form onSubmit={submit}>
      <label>Model<select value={modelId} onChange={event => choose(event.target.value)} disabled={busy}>
        <option value="">Choose a model</option>{catalog?.models.map(item => <option key={item.id} value={item.id} disabled={!item.ready}>{item.name}{item.ready ? '' : ' · not installed'}</option>)}
      </select></label>
      <label>{video ? 'Describe the motion' : 'Describe the image or edit'}<textarea required rows={3} value={prompt} maxLength={12000} onChange={event => setPrompt(event.target.value)}/></label>
      <label>Negative prompt<textarea rows={2} value={negative} maxLength={12000} onChange={event => setNegative(event.target.value)}/></label>
      <label>Reference images {model?.reference_mode === 'required' ? '(required)' : '(optional)'}<input type="file" accept="image/*" multiple={!video} onChange={upload} disabled={busy || !model}/></label>
      <ul>{references.map((item, index) => <li key={`${item.reference}-${index}`}>{item.name || `Reference ${index+1}`} <button type="button" disabled={busy} onClick={() => setReferences(previous => previous.filter((_, i) => i !== index))}>Remove</button></li>)}</ul>
      {model?.kind === 'image' && <p>Describe what to change and what to preserve. Reference images are used in the listed order; exact identity is not guaranteed.</p>}
      <div className="local-media-options">
        <label>Width<input type="number" min={128} max={video ? 832 : 1536} step={video ? 16 : 32} value={width} onChange={e => setWidth(e.target.value)}/></label>
        <label>Height<input type="number" min={128} max={video ? 832 : 1536} step={video ? 16 : 32} value={height} onChange={e => setHeight(e.target.value)}/></label>
        <label>{model?.family === 'wan2.2-14b' ? 'Steps per expert' : 'Steps'}<input type="number" min={1} max={100} value={steps} disabled={Boolean(model?.fixed_steps)} onChange={e => setSteps(e.target.value)}/></label>
        <label>Guidance<input type="number" min={1} max={20} step={0.5} value={guidance} onChange={e => setGuidance(e.target.value)}/></label>
        <label>Seed (blank = random)<input type="number" min={0} max={2147483647} value={seed} onChange={e => setSeed(e.target.value)}/></label>
        {video && <><label>Frames<select value={frames} onChange={e => setFrames(e.target.value)}>{[9,17,33,49,65,81].map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Frames per second<input type="number" min={8} max={30} value={fps} onChange={e => setFps(e.target.value)}/></label></>}
      </div>
      <button disabled={busy || !model?.ready || !catalog?.runtime_ready || model?.reference_mode === 'required' && !references.length} type="submit">{busy ? 'Preparing…' : video ? 'Generate video' : 'Generate image'}</button>
    </form>
    <h2>Generation history</h2>
    {!history.length && <p>Completed images and videos will appear here.</p>}
    <div className="local-media-history">{history.map(jobCard)}</div>
  </section>;
}
