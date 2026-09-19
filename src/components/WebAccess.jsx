import { useEffect, useRef, useState } from "react";
import { useStore } from "../useStore.jsx";
import { createWebChat, getActiveWebImport, getWebImport, startWebImport, stopWebImport } from "../webAccess";
import "./WebAccess.css";

const terminal = new Set(["complete", "cancelled", "error"]);

export default function WebAccess({ onOpenSession }) {
  const { isGenerating, selectedModel } = useStore();
  const [url, setUrl] = useState("");
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [opening, setOpening] = useState(false);
  const [stopping, setStopping] = useState(false);
  const busy = useRef(false);
  const active = job && !terminal.has(job.status);

  useEffect(() => {
    let disposed = false;
    getActiveWebImport().then(({ job: running }) => {
      if (!disposed && running) setJob((current) => current || running);
    }).catch(() => {});
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (!active || !job?.id) return;
    let disposed = false;
    let timer;
    async function poll() {
      try {
        const next = await getWebImport(job.id);
        if (!disposed) {
          setJob(next);
          setError("");
          if (!terminal.has(next.status)) timer = setTimeout(poll, 1000);
        }
      } catch (err) {
        if (!disposed) {
          setError(err.message + ". You can still use Stop import.");
          timer = setTimeout(poll, 3000);
        }
      }
    }
    poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [job?.id, Boolean(active)]);

  async function importPage(event) {
    event.preventDefault();
    if (busy.current || active) return;
    busy.current = true;
    setStarting(true);
    setError("");
    setJob(null);
    try { setJob(await startWebImport(url)); }
    catch (err) { setError(err.message); }
    finally { busy.current = false; setStarting(false); }
  }

  async function stop() {
    setStopping(true);
    try { setJob(await stopWebImport(job.id)); setError(""); }
    catch (err) { setError(err.message); }
    finally { setStopping(false); }
  }

  async function openChat() {
    if (busy.current || isGenerating) return;
    busy.current = true;
    setOpening(true);
    setError("");
    try {
      const session = await createWebChat(job.source, selectedModel);
      await onOpenSession(session.id);
    } catch (err) { setError(err.message); }
    finally { busy.current = false; setOpening(false); }
  }

  return <details className="web-access">
    <summary>Internet · Import a public page</summary>
    <p>Fetch one public <code>https://</code> page — an article, documentation, or any ordinary web page, including addresses with query parameters. Local and private network addresses are refused. Nothing is fetched until you click Import. Chat and inference stay local.</p>
    <form onSubmit={importPage}>
      <label htmlFor="web-page-url">Public page URL</label>
      <div className="web-access-row">
        <input id="web-page-url" type="url" required placeholder="https://example.com/article" value={url} onChange={(event) => setUrl(event.target.value)} disabled={Boolean(active) || starting} />
        <button type="submit" disabled={Boolean(active) || starting}>{starting ? "Starting…" : "Import page"}</button>
        {active && <button type="button" onClick={stop} disabled={stopping}>{stopping ? "Stopping…" : "Stop import"}</button>}
      </div>
    </form>
    <p className="web-access-note">One request at a time · 10+ seconds apart · 30 requests/hour · 24-hour cache. Site limits may require longer pauses.</p>
    {job && <p role="status">{job.message}{job.source?.cached ? " · Loaded from local cache" : ""}</p>}
    {error && <p role="alert">{error}</p>}
    {job?.status === "complete" && <div className="web-source-preview">
      <strong>{job.source.title}</strong>
      <p><a href={job.source.url} target="_blank" rel="noreferrer">View original source</a> · Retrieved {new Date(job.source.fetched_at).toLocaleString()}</p>
      {job.source.requested_url && job.source.requested_url !== job.source.url &&
        <p className="web-access-note">Redirected from {job.source.requested_url} — the page above is what was actually imported.</p>}
      <p>{job.source.char_count.toLocaleString()} extracted characters. A new chat receives up to 6,000 characters with attribution.</p>
      <pre>{job.source.text.slice(0, 600)}</pre>
      <button type="button" onClick={openChat} disabled={opening || isGenerating}>{opening ? "Opening…" : "Open new chat with source"}</button>
      {isGenerating && <p>Finish or stop the current reply before opening a new chat.</p>}
    </div>}
  </details>;
}
