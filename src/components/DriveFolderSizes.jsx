import { useEffect, useRef, useState } from "react";

const colors = ["#4fc3f7", "#a78bfa", "#5eead4", "#f6c453", "#fb923c", "#f472b6", "#818cf8", "#a3e635"];
export function folderBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unavailable";
  const unit = Math.min(4, Math.floor(Math.log2(Math.max(1, bytes)) / 10));
  return `${(bytes / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: unit ? 2 : 0 })} ${["B", "KiB", "MiB", "GiB", "TiB"][unit]}`;
}

export function FolderSpaceResults({ report, status }) {
  if (!report) return null;
  const total = report.total_bytes;
  const folders = [...report.folders].sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  const segments = folders.slice(0, 8).map((row, index) => ({ ...row, color: colors[index] }));
  const remaining = folders.slice(8).reduce((sum, row) => sum + row.bytes, 0);
  if (remaining) segments.push({ name: "Other folders", bytes: remaining, color: "#7890a5" });
  if (report.root_files.bytes) segments.push({ ...report.root_files, color: "#b8c4d0" });
  const share = bytes => total > 0 ? `${(bytes / total * 100).toFixed(1)}%` : "—";
  function description(row) {
    const details = [];
    if (row.status === "pending") details.push(status === "running" ? "Waiting" : "Not scanned");
    if (row.status === "scanning") details.push(status === "running" ? "Scanning…" : "Partial");
    if (row.errors) details.push(`${row.errors.toLocaleString()} unreadable items`);
    if (row.skipped_links) details.push(`${row.skipped_links.toLocaleString()} links / placeholders skipped`);
    if (row.shared_files) details.push(`${row.shared_files.toLocaleString()} shared files counted elsewhere`);
    return details.join(" · ");
  }
  return <>
    <div className="folder-space-summary"><strong>{folderBytes(total)}</strong><span>counted across {report.files.toLocaleString()} files</span></div>
    {total > 0 && <div className="folder-space-bar" role="img" aria-label="Share of scanned file sizes by folder. Exact values are in the list below.">
      {segments.filter(item => item.bytes > 0).map((item, index) => <span key={index} style={{ width: `${item.bytes / total * 100}%`, background: item.color }} title={`${item.name}: ${folderBytes(item.bytes)} (${share(item.bytes)})`} />)}
    </div>}
    <p className="dashboard-note">Largest to smallest · Percentages are shares of scanned file sizes, not total drive capacity.</p>
    <div className="folder-space-table-wrap">
      <table className="folder-space-table"><thead><tr><th scope="col">Top-level folder</th><th scope="col">File size</th><th scope="col">Share</th></tr></thead>
        <tbody>{folders.map((row, index) => <tr key={row.name}>
          <th scope="row"><span className="folder-space-name"><i aria-hidden="true" style={{ background: colors[index] || "#7890a5" }} />{row.name}</span>{description(row) && <small>{description(row)}</small>}</th>
          <td>{row.status === "pending" || row.status === "skipped" || (row.errors && !row.files) ? "—" : folderBytes(row.bytes)}</td><td>{share(row.bytes)}</td>
        </tr>)}</tbody>
        <tfoot><tr><th scope="row">Files in drive root{description(report.root_files) && <small>{description(report.root_files)}</small>}</th><td>{folderBytes(report.root_files.bytes)}</td><td>{share(report.root_files.bytes)}</td></tr></tfoot>
      </table>
    </div>
    {!folders.length && status === "complete" && <p className="dashboard-note">No top-level folders were found.</p>}
    {(report.errors > 0 || report.skipped_links > 0 || status === "canceled") && <p className="dashboard-notice" role="status">Partial coverage: {report.errors.toLocaleString()} unreadable items; {report.skipped_links.toLocaleString()} links or placeholders skipped.{status === "canceled" ? " The scan was canceled; unfinished folders are incomplete." : ""}</p>}
    <p className="dashboard-note">Shared hardlinks are counted once, under the first location scanned. Links, junctions, and cloud placeholders are skipped. File sizes can differ from space used on disk because of compression, sparse files, filesystem overhead, inaccessible files, and changes during the scan.</p>
    <p className="dashboard-note">{status === "complete" ? "Finished" : "Last update"}: {new Date(report.sampled_at).toLocaleString()}</p>
  </>;
}

export default function DriveFolderSizes({ root }) {
  const [open, setOpen] = useState(false);
  const [job, setJob] = useState(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef(null), latestJob = useRef(null), generation = useRef(0);
  const desktop = typeof window !== "undefined" ? window.workstationDesktop : null;
  const running = starting || job?.status === "running";
  function update(value) { latestJob.current = value; setJob(value); }
  useEffect(() => { if (open && !dialog.current?.open) dialog.current?.showModal(); }, [open]);
  useEffect(() => () => {
    generation.current++;
    if (latestJob.current?.status === "running") desktop?.cancelDriveFolderScan?.(latestJob.current.id).catch(() => {});
  }, [desktop]);
  useEffect(() => {
    if (!open || job?.status !== "running") return;
    const attempt = generation.current;
    let stopped = false, timer;
    async function poll() {
      try {
        const value = await desktop.driveFolderScanStatus(job.id);
        if (stopped || attempt !== generation.current) return;
        if (!value.id) throw new Error(value.error || "Folder scan is unavailable.");
        update(value);
        if (value.error) setError(value.error);
        if (value.status === "running") timer = setTimeout(poll, 600);
      } catch (failure) {
        if (!stopped && attempt === generation.current) {
          setError(failure.message);
          update({ ...latestJob.current, status: "error" });
          desktop.cancelDriveFolderScan(job.id).catch(() => {});
        }
      }
    }
    timer = setTimeout(poll, 300);
    return () => { stopped = true; clearTimeout(timer); };
  }, [open, job?.id, job?.status, desktop]);

  async function start() {
    const attempt = ++generation.current;
    setOpen(true); setStarting(true); setError(""); update(null);
    try {
      if (!desktop?.scanDriveFolders) throw new Error("Fully quit and reopen the desktop app to scan folder sizes.");
      const value = await desktop.scanDriveFolders(root);
      if (attempt !== generation.current) {
        if (value.id) await desktop.cancelDriveFolderScan(value.id);
        return;
      }
      if (value.error) throw new Error(value.error);
      update(value);
    } catch (failure) { if (attempt === generation.current) setError(failure.message); }
    finally { if (attempt === generation.current) setStarting(false); }
  }
  async function cancel() {
    generation.current++; setStarting(false);
    const current = latestJob.current;
    if (current?.status === "running") {
      try { update(await desktop.cancelDriveFolderScan(current.id)); }
      catch { setError("Could not cancel the scan. Close the desktop app to stop its worker."); }
    }
  }
  function close() { void cancel(); setOpen(false); }
  return <>
    <button type="button" onClick={() => job?.report ? setOpen(true) : start()} aria-label={`Show top-level folder sizes on ${root}`} title="Scan top-level folders and sort by size">Folder sizes</button>
    {open && <dialog ref={dialog} className="folder-space-dialog" aria-labelledby={`folder-space-title-${root[0]}`} onCancel={event => { event.preventDefault(); close(); }}>
      <header className="folder-space-header"><div><h2 id={`folder-space-title-${root[0]}`}>Folder sizes · {root}</h2><p>Top-level folders, including all files inside them</p></div><button type="button" onClick={close} aria-label="Close folder sizes">Close</button></header>
      <div className="folder-space-body">
        {running && <p className="dashboard-note" role="status">{starting || !job?.report ? "Starting read-only scan…" : `Scanning ${job.report.current_folder || root} · ${job.report.files.toLocaleString()} files counted…`} Large drives can take several minutes.</p>}
        {error && <p className="dashboard-notice" role="alert">{error}</p>}
        <FolderSpaceResults report={job?.report} status={job?.status} />
      </div>
      <footer className="folder-space-footer"><span>Read-only · Closing stops an active scan</span>{running ? <button type="button" onClick={cancel}>Cancel scan</button> : <button type="button" onClick={start}>Rescan</button>}</footer>
    </dialog>}
  </>;
}
