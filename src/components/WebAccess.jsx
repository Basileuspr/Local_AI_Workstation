import { useEffect, useRef, useState } from "react";
import { useStore } from "../useStore.jsx";
import { useChatPane } from "../ChatPane";
import { createWebChat, getActiveWebImport, getWebImport, startWebImport, stopWebImport, webImageUrl } from "../webAccess";
import WebImageReader from "./WebImageReader";
import "./WebAccess.css";

const terminal = new Set(["complete", "cancelled", "error"]);

export default function WebAccess({ onOpenSession, embedded = false, onActivity }) {
  const pane = useChatPane();
  const { isGenerating, selectedModel } = useStore();
  const [url, setUrl] = useState("");
  const [includeImages, setIncludeImages] = useState(true);
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [opening, setOpening] = useState(false);
  const [stopping, setStopping] = useState(false);
  const busy = useRef(false);
  const active = job && !terminal.has(job.status);
  useEffect(() => {
    onActivity?.({ active: Boolean(active) || starting, complete: job?.status === "complete", message: job?.message || "", error });
  }, [Boolean(active), starting, job?.status, job?.message, error, onActivity]);

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
    try { setJob(await startWebImport(url, includeImages)); }
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

  const Container = embedded ? "section" : "details";
  return <Container className={`web-access${embedded ? " embedded" : ""}`}>
    {!embedded && <summary>Internet · Import a public page</summary>}

    <form onSubmit={importPage}>
      <label htmlFor={pane.domId("web-page-url")}>Public page URL</label>
      <div className="web-access-row">
        <input id={pane.domId("web-page-url")} type="url" required placeholder="https://example.com/article" value={url} onChange={(event) => setUrl(event.target.value)} disabled={Boolean(active) || starting} />
        <button type="submit" disabled={Boolean(active) || starting}>{starting ? "Starting…" : "Import page"}</button>
        {active && <button type="button" onClick={stop} disabled={stopping}>{stopping ? "Stopping…" : "Stop import"}</button>}
      </div>
      <label className="web-images-option"><input type="checkbox" checked={includeImages}
        onChange={event => setIncludeImages(event.target.checked)} disabled={Boolean(active) || starting} />
        Save page images locally (up to 24 images, 10 MB each, 50 MB total)</label>
    </form>

    {job && <p role="status">{job.message}{job.source?.cached ? " · Loaded from local cache" : ""}</p>}
    {error && <p role="alert">{error}</p>}
    {job?.status === "complete" && <div className="web-source-preview">
      <strong>{job.source.title}</strong>
      <p><a href={job.source.url} target="_blank" rel="noreferrer">View original source</a> · Retrieved {new Date(job.source.fetched_at).toLocaleString()}</p>
      {job.source.requested_url && job.source.requested_url !== job.source.url &&
        <p className="web-access-note">Redirected from {job.source.requested_url} — the page above is what was actually imported.</p>}
      <p>{job.source.char_count.toLocaleString()} extracted characters. A new chat receives up to 6,000 characters with attribution.</p>
      <pre>{job.source.text.slice(0, 600)}</pre>
      {job.source.include_images && <p>{job.source.images?.length || 0} of {job.source.images_found || 0} discovered images saved locally.
        Images remain available in the saved chat. Text inside images is not automatically read by the chat model.</p>}
      {!!job.source.image_warnings?.length && <details><summary>Image import notes ({job.source.image_warnings.length})</summary>
        <ul>{job.source.image_warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
      <WebImageReader images={job.source.images} sourceFor={image => webImageUrl(image.src)} />
      <button type="button" onClick={openChat} disabled={opening || isGenerating}>{opening ? "Opening…" : "Open new chat with source"}</button>
      {isGenerating && <p>Finish or stop the current reply before opening a new chat.</p>}
    </div>}
  </Container>;
}
