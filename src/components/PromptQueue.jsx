import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { chatSubmissionQueue } from "../chatSubmissionQueue";
import { apiUrl } from "../api";
import { useDispatch } from "../useStore.jsx";
import { queueDestination } from "../queueNavigation";
import { calculateQueueTiming, formatQueueTime, loadQueueTiming, recordQueueTiming, saveQueueTiming } from '../queueTiming';
import { downloadBlob } from '../downloadBlob';
import "./PromptQueue.css";

const QueueContext = createContext({ jobs: [], error: "", paused: false });
const pending = (job) => ["queued", "running", "cancelling"].includes(job.status);
export function usePromptQueue() { return useContext(QueueContext); }
const names = { gif: "GIF Maker", chat: "Chat", image: "Image", training: "LoRA training", analysis: "LoRA analysis", compact: "Chat memory", workflow: "Image workflow", "character-parts": "Character regions" };

export function PromptQueueProvider({ children }) {
  const [data, setData] = useState({ jobs: [], error: "", paused: false });
  const [reports, setReports] = useState(loadQueueTiming);
  const reportRef = useRef(reports);
  const [persistent, setPersistent] = useState(true);
  useEffect(() => {
    let stopped = false;
    let timer;
    let controller;
    async function refresh() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      let delay = 2000;
      try {
        const response = await fetch(apiUrl("/queue"), { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(response.status === 404 ? "Restart the desktop app to load Prompt Queue." : "Could not read the queue.");
        const next = await response.json();
        if (!stopped) {
          const updated = recordQueueTiming(reportRef.current, next);
          if (JSON.stringify(updated) !== JSON.stringify(reportRef.current)) {
            reportRef.current = updated; setReports(updated);
            setPersistent(saveQueueTiming(updated));
          }
          setData({ ...next, error: "" });
        }
        if (next.jobs?.some(pending)) delay = 750;
      } catch (error) {
        if (!stopped) setData((current) => ({ ...current, error: error.message || "Queue connection unavailable" }));
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(refresh, delay);
      }
    }
    refresh();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, []);
  const timing = calculateQueueTiming(data, reports);
  return <QueueContext.Provider value={{...data, timing, reports, persistent}}>{children}</QueueContext.Provider>;
}

export function QueueTimeSummary({images = false, kind}) {
  const {timing, error} = usePromptQueue();
  if (!timing) return null;
  const {averages} = timing;
  const matching = kind ? averages.completed.filter(row=>row.kind===kind) : [];
  return <div className="queue-timing-summary" aria-label="Queue timing">
    {timing.activeCount > 0 && <span>{error ? 'Queue estimate unavailable · last report retained' : timing.remaining === null ? 'Queue finish time: calculating when timing is available' : `Estimated queue remaining: ${formatQueueTime(timing.remaining)}`}</span>}
    {images && <span>Average image generation: {averages.image === null ? 'Learning from completed images' : `${formatQueueTime(averages.image)} · ${averages.imageCount} completed`}</span>}
    {kind && <span>Average {names[kind] || kind} run: {matching.length ? `${formatQueueTime(matching.reduce((sum,row)=>sum+row.runSeconds,0)/matching.length)} · ${matching.length} completed` : 'Learning from completed requests'}</span>}
    <span>Overall average run: {averages.overall === null ? 'Learning from completed requests' : `${formatQueueTime(averages.overall)} · ${averages.count} completed`}</span>
  </div>;
}

export function QueueJobTiming({jobId, requestId}) {
  const {timing, jobs, error} = usePromptQueue();
  const job = jobs.find(item => jobId ? item.id === jobId : item.request_id === requestId && item.kind === 'image');
  const estimate = timing?.jobs[job?.id];
  if (!estimate) return null;
  return <div className="queue-job-timing">
    {error ? <span>Timing unavailable · last report retained</span> : <>
      {job.status === 'queued' && <span>Estimated wait: {formatQueueTime(estimate.wait)} · run: {formatQueueTime(estimate.duration)} · finish in: {formatQueueTime(estimate.finish)}</span>}
      {job.status !== 'queued' && <span>Run elapsed: {formatQueueTime(estimate.elapsed)} · estimated remaining: {formatQueueTime(estimate.remaining)}</span>}
      {estimate.reason && <span>{estimate.reason}</span>}
    </>}
    <small>{estimate.basis}{estimate.samples ? ` · ${estimate.samples} completed sample${estimate.samples === 1 ? '' : 's'}` : ''}</small>
  </div>;
}

export function QueueTimingReport({reports = [], persistent = true}) {
  return <details className="queue-timing-report"><summary>Queue timing report ({reports.length})</summary>
    <p>Last 200 observed requests, saved locally in this UI. Wait is separate from run time; run time includes loading and saving. Only successful runs train the averages. First-observed estimates stay in the report for comparison; estimated wait includes time already spent queued. Estimates vary with settings, model loading, and hardware.</p>
    {!persistent && <p role="status">Local storage is unavailable. This report lasts for this window only.</p>}
    <button type="button" disabled={!reports.length} onClick={()=>downloadBlob(new Blob([JSON.stringify(reports,null,2)], {type:'application/json'}),'queue-timing-report.json')}>Save timing report</button>
    <div className="queue-timing-table"><table><thead><tr><th>Request</th><th>Status</th><th>Estimated wait / run</th><th>Actual wait / run</th><th>Estimate basis</th></tr></thead><tbody>
      {[...reports].reverse().map(row=><tr key={row.key}><td>{names[row.kind] || row.kind} · {row.id.slice(0,8)}<br/>{new Date(row.createdAt).toLocaleString()}</td><td>{row.status}</td><td>{formatQueueTime(row.estimatedWait)} / {formatQueueTime(row.estimatedRun)}</td><td>{formatQueueTime(row.waitSeconds)} / {formatQueueTime(row.runSeconds)}</td><td>{row.basis || 'Completed before UI observation'}</td></tr>)}
    </tbody></table></div>
  </details>;
}

export function QueueRequestStatus({ requestId, projectId, kind }) {
  const { jobs } = useContext(QueueContext);
  const dispatch = useDispatch();
  const job = [...jobs].reverse().find((entry) => (requestId ? entry.request_id === requestId : projectId ? entry.project_id === projectId : false) && (!kind || entry.kind === kind));
  if (!job || !pending(job)) return null;
  return <div className="queue-request-status" role="status"><div><span>{job.status === "queued" ? `Queued · waiting position ${job.position}` : job.status === "cancelling" ? "Stopping safely…" : "Running"}</span><QueueJobTiming jobId={job.id}/></div><button type="button" onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", payload: "queue" })}>View Prompt Queue</button></div>;
}

export default function PromptQueue({ onOpenDestination }) {
  const followUps = useSyncExternalStore(chatSubmissionQueue.subscribe, chatSubmissionQueue.getSnapshot).filter(job => job.status === "waiting");
  const { jobs, error, paused, gpu_owner: gpuOwner, reports, persistent } = useContext(QueueContext);
  const [actionError, setActionError] = useState("");
  const [cancelling, setCancelling] = useState([]);
  const active = jobs.filter(pending);
  const history = jobs.filter((job) => !pending(job)).slice(-30).reverse();
  async function open(job) {
    const destination = queueDestination(job);
    if (!destination || !onOpenDestination) return;
    setActionError("");
    try { await onOpenDestination(destination); }
    catch (error) { setActionError(error.message || "Could not open this request's destination."); }
  }
  async function cancel(job) {
    setActionError("");
    setCancelling((current) => [...current, job.id]);
    try {
      const response = await fetch(apiUrl(`/queue/${encodeURIComponent(job.id)}/cancel`), { method: "POST" });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.detail || "Could not cancel this request");
      }
    } catch (failure) {
      setActionError(failure.message);
    } finally {
      setCancelling((current) => current.filter((id) => id !== job.id));
    }
  }
  function jobCard(job) {
    const canOpen = !!onOpenDestination && !!queueDestination(job);
    return <article className={`queue-job queue-${job.status}${canOpen ? " queue-navigable" : ""}`} key={job.id}
      onClick={event => { if (canOpen && !event.target.closest("button, a, input")) void open(job); }}>
      <div className="queue-job-heading"><span className="queue-kind">{names[job.kind] || job.kind}</span><span className="queue-state">{job.status === "queued" ? `Waiting · #${job.position}` : job.status}</span></div>
      <h3>{canOpen ? <button type="button" className="queue-open" onClick={() => open(job)} title="Open this request's destination">{job.label}</button> : job.label}</h3>
      {job.stage && <p>Stage: {["workflow", "gif"].includes(job.kind) ? job.stage : job.stage === "analysis" ? "Dataset analysis" : "Local training"}</p>}
      <p>Submitted {new Date(job.created_at).toLocaleTimeString()}{job.started_at ? ` · started ${new Date(job.started_at).toLocaleTimeString()}` : ""}{job.finished_at ? ` · finished ${new Date(job.finished_at).toLocaleTimeString()}` : ""}</p>
      <QueueJobTiming jobId={job.id}/>
      {job.error && <p className="queue-error">{job.error}</p>}
      {pending(job) && <button type="button" disabled={job.status === "cancelling" || cancelling.includes(job.id)} onClick={() => cancel(job)}>{job.status === "queued" ? "Cancel request" : job.status === "cancelling" ? "Stopping…" : "Stop request"}</button>}
    </article>;
  }
  return <section className="prompt-queue">
    <header><p className="queue-eyebrow">Shared local workload</p><h1>Prompt Queue</h1><p>GPU requests run in submission order. GIF exports run one at a time in their own CPU queue, alongside GPU work. Submit normally from their tabs; busy requests wait here.</p></header>
    {(error || actionError) && <p className="queue-error" role="alert">{actionError || error}{error && jobs.length > 0 ? " Last known queue state is shown." : ""}</p>}
    <div className="queue-summary" role="status">{paused ? "Queue paused for runtime reset" : active.length ? `${active.length} request${active.length === 1 ? "" : "s"} in progress or waiting` : "Ready for requests"}{gpuOwner && !active.some((job) => job.status === "running" || job.status === "cancelling") ? " · waiting for the current GPU task to finish" : ""}</div>
    <QueueTimeSummary images/>
    <QueueTimingReport reports={reports} persistent={persistent}/>
    <h2>Running & waiting</h2>
    {active.length ? active.map(jobCard) : <p className="queue-empty">No pending requests. Start a chat, generate an image, create a GIF, or start LoRA training.</p>}
    {followUps.length > 0 && <section aria-label="Chat follow-ups"><h2>Waiting for earlier chat replies</h2>
      <p>These prompts join the shared queue after earlier replies are saved, so they include the latest chat context.</p>
      {followUps.map(job => <article className="queue-job" key={job.id}><h3><button type="button" className="queue-open" onClick={() => open({ ...job, kind: "chat" })}>{job.label}</button></h3><button type="button" onClick={() => chatSubmissionQueue.cancel(job.id)}>Cancel waiting prompt</button></article>)}
    </section>}
    <h2>Recent requests</h2>
    {history.length ? history.map(jobCard) : <p className="queue-empty">Completed, cancelled and failed requests will appear here.</p>}
    <p className="queue-footnote">This queue lasts for the current backend run. Keep the app open for pending work. Chat and image results return to the submitting chat; GIF results return to GIF Maker. Restarting clears pending work. Missing models and invalid inputs still need correction. Stopping a running job waits for its worker to exit before starting the next request in that lane.</p>
  </section>;
}
