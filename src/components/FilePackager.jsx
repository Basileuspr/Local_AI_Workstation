import { useEffect, useRef, useState } from "react";
import { apiUrl } from "../api";
import { addPackageEntries, droppedPackageFiles, packageBytes, packageFilename, removePackageEntry, selectedPackageFiles } from "../filePackager";
import "./Tools.css";
import "./FilePackager.css";
import {useImageRemoval} from './ImageRemovalControls';
import {CharacterShortcut} from '../CharacterWorkspace';

export default function FilePackager() {
  const picker = useRef(null), folderPicker = useRef(null), lock = useRef(false), request = useRef(null);
  const [entries, setEntries] = useState([]), [name, setName] = useState("Package"), [compression, setCompression] = useState("compressed");
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(""), [error, setError] = useState(""), [result, setResult] = useState(null);
  const [dragging, setDragging] = useState(false), dragDepth = useRef(0);
  useEffect(() => () => { request.current?.abort(); }, []);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
  const total = entries.reduce((sum, entry) => sum + entry.file.size, 0);
  const fileCount = entries.filter(entry => !entry.directory).length;
  const removal = useImageRemoval(entries, chosen => {
    setEntries(current => chosen.reduce((remaining,entry) => removePackageEntry(remaining,entry),current));
    setResult(null);
  }, {label:'package files',disabled:busy});

  async function add(source) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setStatus("Reading selected files…");
    try {
      const incoming = await source();
      if (!incoming.length) { setStatus("No files were added."); return; }
      const next = addPackageEntries(entries, incoming);
      setEntries(next); setResult(null); setStatus(`Added ${next.length - entries.length} item(s). Ready to package.`);
    } catch (failure) { setError(failure.message || "Could not read the selected files."); setStatus(""); }
    finally { lock.current = false; setBusy(false); }
  }

  async function createPackage() {
    if (lock.current || !entries.length) return;
    lock.current = true; setBusy(true); setError(""); setResult(null); setStatus("Creating ZIP on this computer…");
    const controller = new AbortController(); request.current = controller;
    try {
      const body = new FormData();
      for (const entry of entries) body.append("files", entry.file, entry.file.name);
      body.append("entries", JSON.stringify(entries.map(({ path, directory }) => ({ path, directory }))));
      body.append("name", name); body.append("compression", compression);
      const response = await fetch(apiUrl("/workspaces/package"), { method: "POST", body, signal: controller.signal });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(typeof detail.detail === "string" ? detail.detail : `Package creation failed (${response.status}).`);
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      setResult({ url: URL.createObjectURL(blob), name: packageFilename(name), size: blob.size, fileCount });
      setStatus("ZIP ready. Choose Save ZIP to download it.");
    } catch (failure) {
      if (failure.name === "AbortError") setStatus("Package request cancelled. Your files remain in the list.");
      else { setError(failure.message || "Could not create the ZIP. Check the local backend and try again."); setStatus(""); }
    } finally { request.current = null; lock.current = false; setBusy(false); }
  }

  function drop(event) {
    event.preventDefault(); dragDepth.current = 0; setDragging(false);
    const transfer = event.dataTransfer;
    void add(() => droppedPackageFiles(transfer));
  }
  return <section className="tools-workspace file-packager" aria-label="File Packager" onDrop={drop}
    onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = busy ? "none" : "copy"; }}
    onDragEnter={event => { event.preventDefault(); if (!busy && event.dataTransfer.types.includes("Files")) { dragDepth.current++; setDragging(true); } }}
    onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}>
    <header className="tools-heading"><p className="tools-eyebrow">Local file tools</p><h1>Packager</h1><p>Collect files and folders into one ZIP. Your originals stay where they are.</p></header>
    <CharacterShortcut/>
    <div className={`packager-dropzone${dragging ? " dragging" : ""}`}>
      <strong>{dragging ? "Drop to add to your package" : "Drop files or folders here"}</strong>
      <p>Any file type. Add more files with another drop.</p>
      <div className="tools-toolbar">
        <button type="button" disabled={busy} onClick={() => picker.current.click()}>Choose files</button>
        <button type="button" disabled={busy} onClick={() => folderPicker.current.click()}>Choose folder</button>
      </div>
      <input ref={picker} hidden type="file" multiple onChange={event => { const files = selectedPackageFiles(event.target.files); event.target.value = ""; void add(() => files); }} />
      <input ref={folderPicker} hidden type="file" multiple webkitdirectory="" onChange={event => { const files = selectedPackageFiles(event.target.files); event.target.value = ""; void add(() => files); }} />
    </div>
    <div className="packager-settings">
      <label>Package name<input disabled={busy} value={name} maxLength={120} onChange={event => { setName(event.target.value); setResult(null); }} placeholder="Package" /></label>
      <label>ZIP mode<select disabled={busy} value={compression} onChange={event => { setCompression(event.target.value); setResult(null); }}>
        <option value="compressed">Compressed · smaller ZIP</option><option value="stored">Fast · no compression</option>
      </select></label>
    </div>
    <p className="tools-note">Folder structure is preserved. Matching filenames get numbered names. Up to 1,000 items and 512 MiB per package. Drop folders to include empty folders; the folder picker includes files only.</p>
    <div className="packager-list-heading"><h2>Package contents</h2><span>{fileCount} file{fileCount === 1 ? "" : "s"} · {packageBytes(total)}</span>
      <button type="button" disabled={busy || !entries.length} onClick={() => { setEntries([]); setResult(null); setError(""); setStatus("Selection cleared. Original files were not changed."); }}>Clear list</button></div>
    {removal.toolbar}
    {entries.length ? <ul className="packager-files" aria-label="Package contents">{entries.map(entry => <li key={entry.id}>
      <span className="packager-path" title={entry.path}>{entry.path}{entry.directory ? "/" : ""}</span><span>{entry.directory ? "Folder" : packageBytes(entry.file.size)}</span>
      {removal.controls(entry,entry.path)}
    </li>)}</ul> : <p className="tools-empty">No files added yet.</p>}
    <div className="tools-toolbar"><button type="button" className="packager-create" disabled={busy || !entries.length} onClick={createPackage}>{busy ? "Working…" : "Create ZIP"}</button>
      {busy && request.current && <button type="button" onClick={() => request.current?.abort()}>Cancel request</button>}</div>
    <p role="status">{status}</p>{error && <p role="alert" className="functions-error">{error}</p>}
    {result && <div className="packager-ready"><div><strong>{result.name}</strong><p>{result.fileCount} files · {packageBytes(result.size)}</p></div><a href={result.url} download={result.name}>Save ZIP</a></div>}
  </section>;
}
