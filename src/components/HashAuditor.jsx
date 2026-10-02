import { useEffect, useRef, useState } from "react";
import { apiUrl } from "../api";
import { sharedPollingObserver, readPollingJson } from "../polling";
import { matchModes, folderPaths, formatAuditBytes, auditDate, startAudit, cancelAudit,
  chooseAuditFolders, auditGroups, auditInventory, auditGroupFiles, auditIssues, exportAudit } from "../hashAuditor";
import "./HashAuditor.css";

function FilesTable({ files, hashes = false }) {
  const [copied, setCopied] = useState(""), [error, setError] = useState("");
  async function copy(file) {
    try { await navigator.clipboard.writeText(file.path); setCopied(file.path); setError(""); }
    catch { setError("Could not copy the path. Select and copy its text instead."); }
  }
  return <><div className="hash-audit-table-scroll"><table>
    <thead><tr><th>File location</th><th>Size</th><th>Modified / last read</th>{hashes && <th>SHA-256 / status</th>}</tr></thead>
    <tbody>{files.map(file => <tr key={file.path}>
      <td><span className="hash-file-path">{file.path}</span><button type="button" className="hash-copy" onClick={() => copy(file)} aria-label={`Copy path: ${file.path}`}>{copied === file.path ? "Copied" : "Copy path"}</button>
        {file.links > 1 && <small title="More than one directory entry points to this physical file.">Hard link · {file.links} paths on disk</small>}</td>
      <td title={`${file.size ?? "Unknown"} bytes`}>{formatAuditBytes(file.size)}</td>
      <td><time title={`Modified nanoseconds: ${file.modified_ns}`}>{auditDate(file.modified_at)}</time><small>Read {auditDate(file.scanned_at)}</small></td>
      {hashes && <td><code className="hash-digest">{file.sha256 || "No verified hash"}</code><small>{file.status.replaceAll("_", " ")}</small>{file.error && <small>{file.error}</small>}</td>}
    </tr>)}</tbody>
  </table></div>{error && <p role="alert">{error}</p>}</>;
}

export function MatchGroup({ group, mode, initiallyOpen = false }) {
  const [files, setFiles] = useState(group.files), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { setFiles(group.files); setError(""); }, [group]);
  async function more() {
    setBusy(true); setError("");
    try { const result = await auditGroupFiles(mode, group.key, files.length); setFiles(current => [...current, ...result.items]); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  const values = group.values;
  return <details className="hash-match" open={initiallyOpen}>
    <summary><strong>{group.file_count.toLocaleString()} matching paths</strong><span>{group.physical_files.toLocaleString()} physical file{group.physical_files === 1 ? "" : "s"}</span>
      <span>{formatAuditBytes(values.size)} each</span>{values.name_key && <span>{values.name_key}</span>}</summary>
    <div className="hash-match-content">
      {mode === "hash" ? <p>SHA-256 <code className="hash-digest">{values.sha256}</code></p> : <p className="hash-candidate">Metadata match only. Content may differ.{values.modified_ns && ` Exact modified time: ${values.modified_ns} ns.`}</p>}
      {group.physical_files < group.file_count && <p>Some paths are hard links to the same physical file. These are not independent copies.</p>}
      <FilesTable files={files} hashes={mode !== "hash"} />
      {files.length < group.file_count && <button type="button" disabled={busy} onClick={more}>{busy ? "Loading…" : `Show more paths (${files.length} of ${group.file_count})`}</button>}
      {error && <p role="alert">{error}</p>}
    </div>
  </details>;
}

function AuditIssues({ scan }) {
  const [page, setPage] = useState(null), [offset, setOffset] = useState(0), [open, setOpen] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let live = true;
    auditIssues(scan.id, offset).then(value => { if (live) { setPage(value); setError(""); } }).catch(failure => { if (live) setError(failure.message); });
    return () => { live = false; };
  }, [open, scan.id, scan.status, offset]);
  return <details className="hash-issues" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Skipped items and errors · {scan.skipped + scan.errors}</summary>
    {error && <p role="alert">{error}</p>}
    {!page && open && !error && <p>Loading audit details…</p>}
    {page && <><ul>{page.items.map((item, index) => <li key={index}><strong>{item.kind}</strong> <span>{item.path}</span><small>{item.message}</small></li>)}</ul>
      <Pager offset={offset} limit={100} total={page.total} setOffset={setOffset} /></>}
  </details>;
}

function Pager({ offset, limit, total, setOffset }) {
  if (total <= limit) return null;
  return <div className="hash-pagination"><button type="button" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</button>
    <span>{offset + 1}–{Math.min(offset + limit, total)} of {total.toLocaleString()}</span>
    <button type="button" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>Next</button></div>;
}

export default function HashAuditor({ active = true }) {
  const [rootsText, setRootsText] = useState(""), [excludesText, setExcludesText] = useState("");
  const restored = useRef(false), observer = useRef(null);
  const [status, setStatus] = useState(null), [connectionError, setConnectionError] = useState("");
  const [error, setError] = useState(""), [working, setWorking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [view, setView] = useState("matches"), [mode, setMode] = useState("hash"), [offset, setOffset] = useState(0);
  const [search, setSearch] = useState(""), [searchDraft, setSearchDraft] = useState("");
  const [result, setResult] = useState(null), [resultError, setResultError] = useState(""), [loading, setLoading] = useState(false), [revision, setRevision] = useState(0);
  const running = status?.active, latest = running || status?.scans?.[0];

  useEffect(() => {
    if (!active) return;
    const poll = sharedPollingObserver("hash-auditor-status", {
      read: options => readPollingJson(apiUrl("/hash-auditor/status"), options), active: value => Boolean(value?.active),
      interval: (value, context) => context.hidden ? null : context.failures ? 5000 : value?.active ? 1000 : 10000,
    });
    observer.current = poll;
    return poll.subscribe({ data: value => {
      setStatus(value); setConnectionError("");
      if (!restored.current) {
        restored.current = true;
        setRootsText((value.scans[0]?.roots || []).join("\n"));
        setExcludesText((value.scans[0]?.excludes || []).join("\n"));
      }
    }, error: () => setConnectionError("Could not reach Hash Auditor. A running audit may still be working; reconnect before starting another.") });
  }, [active]);

  useEffect(() => {
    if (!active || !status) return;
    const controller = new AbortController();
    setLoading(true); setResultError("");
    const request = view === "matches" ? auditGroups(mode, offset, controller.signal) : auditInventory(search, offset, controller.signal);
    request.then(value => { if (!controller.signal.aborted) setResult(value); })
      .catch(failure => { if (!controller.signal.aborted) { setResult(null); setResultError(failure.message); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [active, Boolean(status), view, mode, offset, search, revision, latest?.id, latest?.status]);

  async function browse() {
    setError("");
    try { const paths = await chooseAuditFolders(); setRootsText(current => [...new Set([...folderPaths(current), ...paths])].join("\n")); }
    catch (failure) { setError(failure.message); }
  }
  async function start() {
    setWorking(true); setError("");
    try {
      const scan = await startAudit(folderPaths(rootsText), folderPaths(excludesText));
      setStatus(current => ({ ...current, active: scan, scans: [scan, ...(current?.scans || [])] }));
      setRootsText(scan.roots.join("\n")); setOffset(0); observer.current?.invalidate();
    } catch (failure) { setError(failure.message); observer.current?.invalidate(); }
    finally { setWorking(false); }
  }
  async function cancel() {
    setWorking(true); setError("");
    try { await cancelAudit(running.id); observer.current?.invalidate(); }
    catch (failure) { setError(failure.message); }
    finally { setWorking(false); }
  }
  function refresh() { setRevision(value => value + 1); observer.current?.invalidate(); }
  function chooseView(value) { setView(value); setOffset(0); setResult(null); }
  async function download(scope) {
    setExporting(true); setError("");
    try { await exportAudit(scope, mode); }
    catch (failure) { setError(failure.message); }
    finally { setExporting(false); }
  }

  return <section className="hash-auditor" aria-label="Hash Auditor">
    <header className="hash-audit-header"><div><h1>Hash Auditor</h1><p>Read-only file inventory · SHA-256 and filesystem metadata</p></div>

    </header>
    <div className="hash-audit-setup">
      <label>Folders or drives
        <textarea aria-label="Folders or drives to audit" rows={3} value={rootsText} onChange={event => setRootsText(event.target.value)} disabled={Boolean(running) || working} spellCheck={false} placeholder={'C:\\Path\\To\\Folder\nE:\\AnotherFolder'} /></label>
      <div className="hash-audit-actions"><button type="button" disabled={Boolean(running) || working} onClick={browse}>Browse folders</button>
        <button type="button" className="hash-start" onClick={start} disabled={!status || Boolean(connectionError) || Boolean(running) || working || !folderPaths(rootsText).length}>{working && !running ? "Starting…" : "Start audit"}</button>
        {running && <button type="button" disabled={working || running.status === "cancelling"} onClick={cancel}>{running.status === "cancelling" ? "Stopping…" : "Cancel audit"}</button>}</div>
      <details><summary>Exclude folders</summary><label>Optional excluded paths<textarea aria-label="Excluded audit folders" rows={2} value={excludesText} onChange={event => setExcludesText(event.target.value)} disabled={Boolean(running) || working} spellCheck={false} /></label></details>
    </div>
    {(error || connectionError) && <p className="hash-error" role="alert">{error || connectionError}</p>}
    {latest && <div className="hash-audit-progress" role="status"><strong>{latest.status.replaceAll("_", " ")}</strong>
      <span>{latest.hashed.toLocaleString()} files hashed · {formatAuditBytes(latest.bytes_hashed)} read · {latest.skipped} skipped · {latest.errors} errors</span>
      <small>{latest.current_path || latest.message}</small><small>Started {auditDate(latest.started_at)}{latest.finished_at && ` · Finished ${auditDate(latest.finished_at)}`}</small>
    </div>}
    <div className="hash-catalog-toolbar"><div className="hash-audit-actions"><button type="button" aria-pressed={view === "matches"} onClick={() => chooseView("matches")}>Matches</button>
      <button type="button" aria-pressed={view === "inventory"} onClick={() => chooseView("inventory")}>Recorded files</button>
      <button type="button" onClick={refresh} disabled={loading}>Refresh results</button></div>
      <details className="hash-exports"><summary>{exporting ? "Preparing export…" : "Export"}</summary><button type="button" disabled={exporting} onClick={() => download("inventory")}>Full inventory CSV</button><button type="button" disabled={exporting} onClick={() => download("matches")}>Current match type CSV</button></details></div>
    <p className="hash-catalog-note">All recorded locations · {(status?.counts?.verified || 0).toLocaleString()} verified file records. Matches reflect the last recorded reads, not live monitoring.</p>
    {view === "matches" ? <label className="hash-mode">Match by<select aria-label="Hash match criteria" value={mode} onChange={event => { setMode(event.target.value); setOffset(0); setResult(null); }}>{matchModes.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      : <form className="hash-search" onSubmit={event => { event.preventDefault(); setSearch(searchDraft.trim()); setOffset(0); }}><input aria-label="Find recorded file path" placeholder="Find a recorded path…" value={searchDraft} onChange={event => setSearchDraft(event.target.value)} /><button type="submit">Find</button></form>}
    {mode !== "hash" && view === "matches" && <p className="hash-candidate">Metadata candidates are not proof of identical file contents. Compare the SHA-256 hashes to confirm content matches.</p>}
    {loading && <p role="status">Loading recorded results…</p>}
    {resultError && <p role="alert">{resultError}</p>}
    {!loading && result && <>
      {!result.total && <p className="hash-empty">{view === "matches" ? "No matching groups in the recorded inventory." : "No recorded files match this view."}{!latest && " Select folders and start an audit to build the inventory."}</p>}
      {view === "matches" ? result.groups?.map((group, index) => <MatchGroup key={`${mode}:${group.key}`} group={group} mode={mode} initiallyOpen={index === 0} />) : <FilesTable files={result.items || []} hashes />}
      <Pager offset={offset} limit={view === "matches" ? 20 : 100} total={result.total} setOffset={setOffset} />
    </>}
    {latest && <AuditIssues key={latest.id} scan={latest} />}
    {status?.scans?.length > 0 && <details className="hash-history"><summary>Audit history · {status.scans.length} recent audits</summary>
      {status.scans.map(scan => <article key={scan.id}><strong>{auditDate(scan.started_at)} · {scan.status.replaceAll("_", " ")}</strong><span>{scan.hashed} hashed · {scan.errors} errors · {scan.skipped} skipped</span><p>{scan.roots.join("\n")}</p>
        <button type="button" disabled={Boolean(running) || working} onClick={() => { setRootsText(scan.roots.join("\n")); setExcludesText(scan.excludes.join("\n")); }}>Use these folders</button>
        {scan.id !== latest?.id && <AuditIssues scan={scan} />}</article>)}</details>}
  </section>;
}
