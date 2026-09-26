import { useRef, useState } from "react";
import { previewDocument } from "../codePreview";
import "./Tools.css";

const SAMPLE = '<main><h1>Style preview</h1><p>Edit CSS to change this page, or supply your own HTML.</p><button>Example button</button><section class="card"><h2>A sample card</h2><p>Spacing, colors, borders, and typography.</p></section></main>';
export default function CodeViewer({ kind }) {
  const styling = kind === "css", input = useRef(null);
  const [source, setSource] = useState(styling ? 'body { background: #f0f4fa; }\n.card { padding: 24px; margin-top: 20px; border-radius: 12px; background: white; }\nbutton { background: #356ad8; color: white; padding: 12px 20px; border: 0; border-radius: 6px; }' : "");
  const [html, setHTML] = useState(SAMPLE), [preview, setPreview] = useState(null), [error, setError] = useState("");
  async function read(file) {
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("Choose a text file under 2 MB.");
      setSource(await file.text()); setPreview(null); setError("");
    } catch (failure) { setError(failure.message); }
  }
  return <section className="tools-workspace" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void read(event.dataTransfer.files[0]); }}>
    <header className="tools-heading"><h1>{styling ? "CSS / Styling Viewer" : "HTML Viewer"}</h1><p>Paste source or drop a file, then preview the result.</p></header>
    <div className="tools-toolbar">
      <button onClick={() => input.current.click()}>Open {styling ? "CSS" : "HTML"} file</button>
      <input ref={input} type="file" hidden accept={styling ? ".css,text/css" : ".html,.htm,text/html"} onChange={event => { void read(event.target.files[0]); event.target.value = ""; }} />
      <button onClick={() => setPreview(null)} aria-pressed={preview === null}>Source</button>
      <button onClick={() => setPreview(previewDocument(styling ? html : source, styling ? source : ""))} aria-pressed={preview !== null}>Preview</button>
    </div>
    {error && <p role="alert">{error}</p>}
    <textarea className="tools-editor" hidden={preview !== null} aria-label={styling ? "CSS source" : "HTML source"} value={source} onChange={event => setSource(event.target.value)} spellCheck={false} />
    {styling && preview === null && <details><summary>HTML to style</summary><textarea className="tools-editor" aria-label="HTML to style" value={html} onChange={event => setHTML(event.target.value)} spellCheck={false} /></details>}
    {preview !== null && <iframe className="tools-preview code-preview" sandbox="" referrerPolicy="no-referrer" title={styling ? "CSS preview" : "HTML preview"} srcDoc={preview} />}
    <p className="tools-note">Preview uses local HTML and CSS. Scripts and external resources are disabled. Source stays here while switching tabs.</p>
  </section>;
}
