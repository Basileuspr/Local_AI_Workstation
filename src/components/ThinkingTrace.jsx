import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadThinkingTrace, mergeTracePage, exportThinkingTrace } from "../thinkingTrace";
import { openThinkingTerminal } from "../api";
import "./ThinkingTrace.css";

export default function ThinkingTrace({ onClose }) {
  const dialog = useRef(null), output = useRef(null), follow = useRef(true);
  const [trace, setTrace] = useState("");
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [terminalError, setTerminalError] = useState("");
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState("");
  useEffect(() => {
    const previousFocus = document.activeElement;
    dialog.current.showModal();
    return () => previousFocus?.focus();
  }, []);
  useEffect(() => {
    let active = true, timer;
    let snapshot = { content: "", offset: 0, revision: "" };
    const controller = new AbortController();
    async function refresh() {
      let delay = 1200;
      try {
        if (!document.hidden) {
          const page = await loadThinkingTrace({ ...snapshot, signal: controller.signal });
          if (!active) return;
          snapshot = mergeTracePage(snapshot, page);
          setTrace(snapshot.content);
          setError("");
          setLoading(false);
          if (page.more) delay = 0;
        }
      } catch (failure) {
        if (!active) return;
        setError(`${failure.message}. Retrying…`);
        setLoading(false);
        delay = 4000;
      }
      if (active) timer = window.setTimeout(refresh, delay);
    }
    refresh();
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if (follow.current && output.current) output.current.scrollTop = output.current.scrollHeight;
  }, [trace]);
  async function openTerminal() {
    setTerminalError("");
    try {
      const result = await openThinkingTerminal();
      if (!result.opened) throw new Error(result.error || "Could not open thinking terminal");
    } catch (failure) { setTerminalError(failure.message); }
  }
  async function exportTrace() {
    setExportError("");
    setExportNotice("");
    setExporting(true);
    try {
      await exportThinkingTrace();
      setExportNotice("Download started; history preserved.");
    } catch (failure) { setExportError(failure.message || "Could not export thinking trace"); }
    finally { setExporting(false); }
  }
  return createPortal(<dialog ref={dialog} className="thinking-trace-dialog" aria-labelledby="thinking-trace-title"
    onClose={onClose} onCancel={event => { event.preventDefault(); dialog.current.close(); }}>
    <header>
      <h2 id="thinking-trace-title">Thinking trace</h2>
      <button type="button" autoFocus onClick={() => dialog.current.close()} aria-label="Close thinking trace">×</button>
    </header>

    <pre ref={output} tabIndex={0} aria-label="Full thinking trace" onScroll={event => {
      const node = event.currentTarget;
      follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
    }}>{trace || (loading ? "Loading thinking trace…" : "No thinking trace recorded yet. Send a chat message to begin.")}</pre>
    {(error || terminalError || exportError) && <p role="alert">{error || terminalError || exportError}</p>}
    {exportNotice && <p role="status">{exportNotice}</p>}
    <footer>
      <button type="button" onClick={openTerminal}>Open terminal</button>
      <button type="button" onClick={exportTrace} disabled={exporting || !trace} title="Download the complete saved trace without clearing it">
        {exporting ? "Exporting…" : "Export thinking trace"}
      </button>
    </footer>

  </dialog>, document.body);
}
