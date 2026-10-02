import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { chatSubmissionQueue } from "../chatSubmissionQueue";
import { chatStageLabel } from "../chatActivity";
import { apiUrl } from "../api";
import { queueObserver } from "../appPolling";
import { invalidatePolling } from "../polling";
import { useDispatch } from "../useStore.jsx";
import { queueDestination } from "../queueNavigation";
import { calculateQueueTiming, formatQueueTime, loadQueueTiming, recordQueueTiming, saveQueueTiming } from '../queueTiming';
import { downloadBlob } from '../downloadBlob';
import "./PromptQueue.css";

const QueueContext = createContext({ jobs: [], error: "", paused: false });
const pending = (job) => ["queued", "running", "cancelling"].includes(job.status);
export function usePromptQueue() { return useContext(QueueContext); }
const names = { 'local-file': 'Video processing', 'video-vision': 'Video vision', gif: "GIF Maker", chat: "Chat", image: "Image", training: "LoRA training", analysis: "LoRA analysis", compact: "Chat memory", workflow: "Image workflow", "character-parts": "Character regions" };

export function PromptQueueProvider({ children }) {
  const [data, setData] = useState({ jobs: [], error: "", paused: false });
  const [reports, setReports] = useState(loadQueueTiming);
  const reportRef = useRef(reports);
  const imageQueueRef = useRef("");
  const [persistent, setPersistent] = useState(true);
  useEffect(() => {
    return queueObserver().subscribe({ data: next => {
          const imageState = JSON.stringify(next.jobs?.filter(job => job.kind === "image").map(job => [job.request_id, job.status]));
          if (imageQueueRef.current !== imageState) { imageQueueRef.current = imageState; invalidatePolling("image-tasks"); }
          const updated = recordQueueTiming(reportRef.current, next);
          if (JSON.stringify(updated) !== JSON.stringify(reportRef.current)) {
            reportRef.current = updated; setReports(updated);
            setPersistent(saveQueueTiming(updated));
          }
          setData({ ...next, error: "" });
      }, recovered: () => setData(current => current.error ? { ...current, error: "" } : current),
      error: error => setData(current => ({ ...current, error: error.message || "Queue connection unavailable" })) });
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
  return <div className="queue-request-status" role="status"><div><span title={job.stage_detail}>{job.status === "queued" ? `Queued · waiting position ${job.position}` : job.status === "cancelling" ? "Stopping safely…" : job.stage ? chatStageLabel(job.stage) : "Running"}</span><QueueJobTiming jobId={job.id}/></div><button type="button" onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", payload: "queue" })}>View Prompt Queue</button></div>;
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
      invalidatePolling("queue", "image-tasks", "runtime");
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
    <header><p className="queue-eyebrow">Shared local workload</p><h1>Prompt Queue</h1></header>
    {(error || actionError) && <p className="queue-error" role="alert">{actionError || error}{error && jobs.length > 0 ? " Last known queue state is shown." : ""}</p>}
    <div className="queue-summary" role="status">{paused ? "Queue paused for runtime reset" : active.length ? `${active.length} request${active.length === 1 ? "" : "s"} in progress or waiting` : "Ready for requests"}{gpuOwner && !active.some((job) => job.status === "running" || job.status === "cancelling") ? " · waiting for the current GPU task to finish" : ""}</div>
    <QueueTimeSummary images/>
    <QueueTimingReport reports={reports} persistent={persistent}/>
    <h2>Running & waiting</h2>
    {active.length ? active.map(jobCard) : <p className="queue-empty">No pending requests. Start a chat, generate an image, create a GIF, or start LoRA training.</p>}
    {followUps.length > 0 && <section aria-label="Chat follow-ups"><h2>Waiting for earlier chat replies</h2>

      {followUps.map(job => <article className="queue-job" key={job.id}><h3><button type="button" className="queue-open" onClick={() => open({ ...job, kind: "chat" })}>{job.label}</button></h3><button type="button" onClick={() => chatSubmissionQueue.cancel(job.id)}>Cancel waiting prompt</button></article>)}
    </section>}
    <h2>Recent requests</h2>
    {history.length ? history.map(jobCard) : <p className="queue-empty">Completed, cancelled and failed requests will appear here.</p>}

  </section>;
}
