import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { chatSubmissionQueue } from "../chatSubmissionQueue";
import { apiUrl } from "../api";
import { useDispatch } from "../useStore.jsx";
import "./PromptQueue.css";

const QueueContext = createContext({ jobs: [], error: "", paused: false });
const pending = (job) => ["queued", "running", "cancelling"].includes(job.status);
const names = { chat: "Chat", image: "Image", training: "LoRA training", analysis: "LoRA analysis", compact: "Chat memory", workflow: "Image workflow" };

export function PromptQueueProvider({ children }) {
  const [data, setData] = useState({ jobs: [], error: "", paused: false });
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
        if (!stopped) setData({ ...next, error: "" });
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
  return <QueueContext.Provider value={data}>{children}</QueueContext.Provider>;
}

export function QueueRequestStatus({ requestId, projectId, kind }) {
  const { jobs } = useContext(QueueContext);
  const dispatch = useDispatch();
  const job = [...jobs].reverse().find((entry) => (requestId ? entry.request_id === requestId : projectId ? entry.project_id === projectId : false) && (!kind || entry.kind === kind));
  if (!job || !pending(job)) return null;
  return <div className="queue-request-status" role="status"><span>{job.status === "queued" ? `Queued · waiting position ${job.position}` : job.status === "cancelling" ? "Stopping safely…" : "Running"}</span><button type="button" onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", payload: "queue" })}>View Prompt Queue</button></div>;
}

export default function PromptQueue() {
  const followUps = useSyncExternalStore(chatSubmissionQueue.subscribe, chatSubmissionQueue.getSnapshot).filter(job => job.status === "waiting");
  const { jobs, error, paused, gpu_owner: gpuOwner } = useContext(QueueContext);
  const [actionError, setActionError] = useState("");
  const [cancelling, setCancelling] = useState([]);
  const active = jobs.filter(pending);
  const history = jobs.filter((job) => !pending(job)).slice(-30).reverse();
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
    return <article className={`queue-job queue-${job.status}`} key={job.id}>
      <div className="queue-job-heading"><span className="queue-kind">{names[job.kind] || job.kind}</span><span className="queue-state">{job.status === "queued" ? `Waiting · #${job.position}` : job.status}</span></div>
      <h3>{job.label}</h3>
      {job.stage && <p>Stage: {job.kind === "workflow" ? job.stage : job.stage === "analysis" ? "Dataset analysis" : "Local training"}</p>}
      <p>Submitted {new Date(job.created_at).toLocaleTimeString()}{job.started_at ? ` · started ${new Date(job.started_at).toLocaleTimeString()}` : ""}{job.finished_at ? ` · finished ${new Date(job.finished_at).toLocaleTimeString()}` : ""}</p>
      {job.error && <p className="queue-error">{job.error}</p>}
      {pending(job) && <button type="button" disabled={job.status === "cancelling" || cancelling.includes(job.id)} onClick={() => cancel(job)}>{job.status === "queued" ? "Cancel request" : job.status === "cancelling" ? "Stopping…" : "Stop request"}</button>}
    </article>;
  }
  return <section className="prompt-queue">
    <header><p className="queue-eyebrow">Shared local workload</p><h1>Prompt Queue</h1><p>Chat, images and LoRA requests run in submission order, one at a time. Submit normally from their tabs; busy requests wait here.</p></header>
    {(error || actionError) && <p className="queue-error" role="alert">{actionError || error}{error && jobs.length > 0 ? " Last known queue state is shown." : ""}</p>}
    <div className="queue-summary" role="status">{paused ? "Queue paused for runtime reset" : active.length ? `${active.length} request${active.length === 1 ? "" : "s"} in progress or waiting` : "Ready for requests"}{gpuOwner && !active.some((job) => job.status === "running" || job.status === "cancelling") ? " · waiting for the current GPU task to finish" : ""}</div>
    <h2>Running & waiting</h2>
    {active.length ? active.map(jobCard) : <p className="queue-empty">No pending requests. Start a chat, generate an image, or start LoRA training.</p>}
    {followUps.length > 0 && <section aria-label="Chat follow-ups"><h2>Waiting for earlier chat replies</h2>
      <p>These prompts join the shared queue after earlier replies are saved, so they include the latest chat context.</p>
      {followUps.map(job => <article className="queue-job" key={job.id}><h3>{job.label}</h3><button type="button" onClick={() => chatSubmissionQueue.cancel(job.id)}>Cancel waiting prompt</button></article>)}
    </section>}
    <h2>Recent requests</h2>
    {history.length ? history.map(jobCard) : <p className="queue-empty">Completed, cancelled and failed requests will appear here.</p>}
    <p className="queue-footnote">This queue lasts for the current backend run. Keep the app open for waiting chat and image requests; their results return to the submitting chat. Restarting clears pending work. Missing models and invalid inputs still need correction. Stopping a running job waits for its GPU work to exit before starting the next one.</p>
  </section>;
}
