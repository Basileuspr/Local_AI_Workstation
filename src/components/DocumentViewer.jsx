import { useEffect, useRef, useState } from "react";
import { apiUrl } from "../api";
import ProtectedImage, { useImagePrivacy } from "../ImagePrivacy";
import { useRefs } from "../useStore";

export function documentUrl(id, suffix = "") {
  if (!/^[a-f0-9]{32}$/.test(id || "")) throw new Error("This document attachment is invalid.");
  return apiUrl(`/artifacts/${id}${suffix}`);
}

async function responseError(response) {
  const value = await response.json().catch(() => ({}));
  return typeof value.detail === "string" ? value.detail : `Document unavailable (${response.status}). Try creating it again.`;
}

export async function downloadDocument(artifact) {
  const response = await fetch(documentUrl(artifact.id, "/download"));
  if (!response.ok) throw new Error(await responseError(response));
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url; link.download = artifact.name || "document.docx";
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function DocumentPage({ document: value }) {
  return <article className="document-page">
    <h1>{value.title}</h1>
    {(value.blocks || []).map((block, index) => {
      if (block.type === "heading") return <h2 key={index}>{block.text}</h2>;
      if (block.type === "paragraph") return <p key={index}>{block.text}</p>;
      if (block.type === "bullet" || block.type === "numbered") {
        const Tag = block.type === "bullet" ? "ul" : "ol";
        const ordinal = value.blocks.slice(0, index + 1).filter(item => item.type === "numbered").length;
        return <Tag key={index} start={block.type === "numbered" ? ordinal : undefined}><li>{block.text}</li></Tag>;
      }
      if (block.type === "table") return <div className="document-table-scroll" key={index}><table><thead><tr>{block.headers.map((cell, i) => <th key={i}>{cell}</th>)}</tr></thead><tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{cell}</td>)}</tr>)}</tbody></table></div>;
      if (block.type === "image" && /^image-[0-9]+\.png$/.test(block.image_file)) return <figure key={index}><ProtectedImage rotateView={false} src={documentUrl(value.id, `/images/${block.image_file}`)} alt={block.caption || "Document image"} /><figcaption>{block.caption}</figcaption></figure>;
      return null;
    })}
  </article>;
}

export function DocumentAttachment({ artifact, onView }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <div className="document-attachment">
    <span className="document-file-icon" aria-hidden="true">W</span>
    <div className="document-file-info"><strong>{artifact.name}</strong><small>Word document · {Math.max(1, Math.ceil((artifact.size || 0) / 1024))} KB</small></div>
    <button type="button" onClick={() => onView(artifact)}>View</button>
    <button type="button" disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try { await downloadDocument(artifact); } catch (failure) { setError(failure.message); }
      finally { setBusy(false); }
    }}>{busy ? "Preparing…" : "Download"}</button>
    {error && <p className="document-error" role="alert">{error}</p>}
  </div>;
}

export default function DocumentViewer({ artifact, active = true, onClose }) {
  const dialog = useRef(null), refs = useRefs(), privacy = useImagePrivacy();
  const [value, setValue] = useState(null), [error, setError] = useState("");
  const [zoom, setZoom] = useState(100), [expanded, setExpanded] = useState(false), [downloading, setDownloading] = useState(false);
  const [retry, setRetry] = useState(0);
  const open = !!artifact && active;
  useEffect(() => {
    if (!open) return;
    const node = dialog.current; node.showModal();
    if (refs) refs.imageViewerOpen = true;
    return () => { node.close(); if (refs) refs.imageViewerOpen = false; };
  }, [open, refs]);
  useEffect(() => {
    setValue(null); setError("");
    if (!open || !privacy.ready) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(documentUrl(artifact.id), { signal: controller.signal });
        if (!response.ok) throw new Error(await responseError(response));
        const document = await response.json();
        if (!controller.signal.aborted) setValue(document);
      } catch (failure) { if (!controller.signal.aborted) setError(failure.message); }
    })();
    return () => controller.abort();
  }, [artifact?.id, open, privacy.ready, privacy.revision, retry]);
  return <dialog ref={dialog} className={`document-viewer ${expanded ? "expanded" : ""}`} aria-label="Document viewer"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><div><h2>{artifact?.name || "Document"}</h2><p>Document preview · Page breaks may differ in Word</p></div><button type="button" autoFocus onClick={onClose} aria-label="Close document viewer">Close ×</button></header>
    <div className="document-viewer-toolbar">
      <label>Zoom <select value={zoom} onChange={event => setZoom(Number(event.target.value))}>{[75, 100, 125, 150].map(size => <option value={size} key={size}>{size}%</option>)}</select></label>
      <button type="button" onClick={() => setExpanded(!expanded)}>{expanded ? "Restore window" : "Expand window"}</button>
      <button type="button" disabled={!artifact || downloading || !privacy.ready} onClick={async () => {
        setDownloading(true);
        try { await downloadDocument(artifact); } catch (failure) { setError(failure.message); }
        finally { setDownloading(false); }
      }}>{downloading ? "Preparing…" : "Download .docx"}</button>
    </div>
    <div className="document-viewer-body">
      {error && <div className="document-error" role="alert"><p>{error}</p><button type="button" onClick={() => setRetry(retry + 1)}>Retry preview</button></div>}
      {!value && !error && <p role="status">Loading document…</p>}
      {value && privacy.ready && <div className="document-zoom" style={{ zoom: zoom / 100 }}><DocumentPage document={value} /></div>}
    </div>
  </dialog>;
}
