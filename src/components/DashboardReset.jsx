import { useEffect, useRef, useState } from "react";

export default function DashboardReset() {
  const [saved, setSaved] = useState(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState("");
  const [exportNotice, setExportNotice] = useState("");
  const [resetting, setResetting] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(() => typeof window !== "undefined" ? localStorage.getItem("app-reset-notice") || "" : "");
  const [importReview, setImportReview] = useState(null);
  const [importPending, setImportPending] = useState(false);
  const desktop = typeof window !== "undefined" && window.workstationDesktop;
  const dialog = useRef(null);
  const importDialog = useRef(null);
  useEffect(() => { if (saved && !dialog.current?.open) dialog.current?.showModal(); }, [saved]);
  useEffect(() => { if (importReview && !importDialog.current?.open) importDialog.current?.showModal(); }, [importReview]);
  useEffect(() => {
    let canceled = false;
    desktop?.backupImportStatus?.().then(result => {
      if (canceled) return;
      setImportPending(Boolean(result.pending));
      if (result.error) setError(result.error);
    }).catch(failure => { if (!canceled) setError(failure.message); });
    return () => { canceled = true; };
  }, [desktop]);
  async function reviewImport() {
    setBusy(true); setOperation("inspect-import"); setError("");
    try {
      const result = await desktop.prepareBackupImport();
      if (result.error) throw new Error(result.error);
      if (!result.canceled) { setImportReview(result); setConfirmation(""); }
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); setOperation(""); }
  }
  async function importBackup() {
    if (confirmation !== "IMPORT" || !importReview) return;
    setBusy(true); setOperation("import"); setError("");
    try {
      const result = await desktop.importAppBackup(importReview.ticket, confirmation);
      if (result.error) {
        setStopped(Boolean(result.backendStopped));
        const status = await desktop.backupImportStatus();
        setImportPending(Boolean(status.pending));
        throw new Error(result.error);
      }
      window.location.reload();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); setOperation(""); }
  }
  async function recoverImport() {
    setBusy(true); setOperation("recover-import"); setError("");
    try {
      const result = await desktop.recoverBackupImport();
      if (result.error) throw new Error(result.error);
      window.location.reload();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); setOperation(""); }
  }
  async function exportArchive(kind) {
    setBusy(true); setOperation(kind); setError(""); setExportNotice("");
    try {
      const result = await (kind === "backup" ? desktop.exportAppBackup() : desktop.exportResetInventory());
      if (result.verified && result.archive) setExportNotice(`Backup saved and verified: ${result.archive}`);
      if (result.error) throw new Error(result.error);
      if (!result.canceled) setExportNotice(`${kind === "backup" ? "Backup saved and verified" : "Metadata saved and verified"}: ${result.archive}`);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); setOperation(""); }
  }
  async function reviewReset() {
    setBusy(true); setOperation("review"); setError("");
    try {
      const result = await desktop.prepareAppReset();
      if (result.error) throw new Error(result.error);
      setSaved(result); setConfirmation("");
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); setOperation(""); }
  }
  async function reset() {
    if (confirmation !== "RESET" || !saved) return;
    setBusy(true); setResetting(true); setError("");
    try {
      const result = await desktop.resetAppData(saved.ticket, confirmation);
      if (result.error) { setStopped(Boolean(result.backendStopped)); throw new Error(result.error); }
      // The desktop also sends a completion event for the outer reset screen.
      window.location.reload();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); setResetting(false); }
  }
  return <section className="dashboard-card dashboard-reset" aria-label="App data reset">
    <h2>App data</h2>
    {notice && <p className="dashboard-notice" role="status">{notice} <button type="button" onClick={() => { localStorage.removeItem("app-reset-notice"); setNotice(""); }}>Dismiss</button></p>}
    <p className="dashboard-note"><strong>Save metadata</strong> creates a lightweight ZIP of file counts, storage totals, and basic numeric settings. It excludes personal content, filenames, paths, media, buttons, and model files. It cannot restore app data.</p>
    <button type="button" disabled={!desktop?.exportResetInventory || busy || stopped || importPending} onClick={() => exportArchive("metadata")}>{operation === "metadata" ? "Saving metadata…" : "SAVE METADATA"}</button>
    <p className="dashboard-note"><strong>Reset app data &amp; sanitize application</strong> permanently clears chats, all stored media (including Hidden and Locked), faces, character parts, workflows, LoRAs and training data, memory, Index entries, knowledge base, app-data logs, trash, and recovery copies. Personal settings, custom profiles, prompt buttons, and image tags are also removed.</p>
    <button type="button" disabled={!desktop?.prepareAppReset || busy || stopped || importPending} onClick={reviewReset}>{operation === "review" ? "Reviewing app data…" : "RESET APP DATA & SANITIZE APPLICATION"}</button>
    <p className="dashboard-note"><strong>Export back-up</strong> saves app data, stored media, LoRA artifacts, and desktop preferences in a verified private ZIP with file hashes and recovery instructions. It includes locked images. Save edits and finish or cancel queued/running jobs first; the backend pauses during export. Installed base models, app code, external files, external logs, and unsaved edits are excluded.</p>
    <button type="button" disabled={!desktop?.exportAppBackup || busy || stopped || importPending} onClick={() => exportArchive("backup")}>{operation === "backup" ? "Saving and verifying backup…" : "EXPORT BACK-UP"}</button>
    <p className="dashboard-note"><strong>Import back-up</strong> verifies an exported backup, then replaces current app data and desktop preferences after your confirmation. Current data and preferences are retained in a separate recovery folder. Metadata-only ZIPs cannot be imported. Base models and external files must already be available separately.</p>
    <button type="button" disabled={!desktop?.prepareBackupImport || busy || stopped || importPending} onClick={reviewImport}>{operation === "inspect-import" ? "Verifying backup…" : "IMPORT BACK-UP"}</button>
    {importPending && <p className="dashboard-notice" role="alert">An import was interrupted. Recover previous data before continuing. <button type="button" disabled={busy} onClick={recoverImport}>{operation === "recover-import" ? "Recovering…" : "Recover previous data"}</button></p>}
    <p className="dashboard-note">Reset keeps the installed app and base models. Original files, exports, backups, import recovery folders, and logs outside app data stay on disk. Sanitizing app storage does not securely erase disks, Git history, or Windows history. Close other clients connected to the backend before reset, backup, or import.</p>
    {!desktop?.prepareBackupImport && <p className="dashboard-note">Fully quit and reopen the desktop app to use these features.</p>}
    {exportNotice && <p role="status" className="dashboard-notice">{exportNotice}</p>}
    {error && !saved && <p role="alert" className="dashboard-notice">{error}</p>}
    {importReview && <dialog ref={importDialog} className="reset-native-dialog" onCancel={event => { if (busy) event.preventDefault(); else { setImportReview(null); setConfirmation(""); } }}>
      <section className="dashboard-card reset-confirmation" aria-labelledby="import-title">
        <h2 id="import-title">Import back-up</h2>
        <p className="dashboard-note">Verified backup: <strong>{importReview.archive}</strong></p>
        <p className="dashboard-note">Created {importReview.report.created_at}. Contains {importReview.report.files.toLocaleString()} data files; {importReview.report.bytes.toLocaleString()} bytes including desktop preferences.</p>
        <p className="dashboard-notice">This replaces current chats, media, LoRAs, and settings with the backup. It does not merge them. Your current data and preferences will be retained in a recovery folder beside app data; its location is shown after import. Save edits and finish or cancel running work first.</p>
        <label>Type IMPORT to replace current app data<input aria-label="Confirm backup import" autoComplete="off" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} /></label>
        {error && <p role="alert" className="dashboard-notice">{error}</p>}
        <div className="reset-actions"><button type="button" disabled={busy || stopped || importPending || confirmation !== "IMPORT"} onClick={importBackup}>{operation === "import" ? "Importing…" : "Import and replace app data"}</button><button type="button" disabled={busy} onClick={() => { setImportReview(null); setConfirmation(""); }}>Cancel</button>{importPending && <button type="button" disabled={busy} onClick={recoverImport}>Recover previous data</button>}</div>
        {operation === "import" && <p role="status" className="dashboard-note">Staging and verifying files, retaining current data, and restoring the backup…</p>}
      </section>
    </dialog>}
    {saved && <dialog ref={dialog} className="reset-native-dialog" onCancel={event => { if (busy || stopped) event.preventDefault(); else { setSaved(null); setConfirmation(""); setError(""); } }}>
      <section className="dashboard-card reset-confirmation" role="dialog" aria-modal="true" aria-labelledby="reset-title">
        <h2 id="reset-title">{stopped ? "Complete interrupted reset" : "Reset app data & sanitize application"}</h2>
        <p className="dashboard-note">{Object.values(saved.report.inventory).reduce((total, group) => total + group.files, 0)} files currently inventoried. Reset clears all current app data in the categories above, including locked images, recovery copies, and custom buttons.</p>
        <p className="dashboard-notice">Permanent deletion cannot be undone. No backup is created automatically. Choose Keep app data and use EXPORT BACK-UP first if you want a recovery copy. SAVE METADATA cannot restore deleted content.</p>
        <label>Type RESET to permanently clear app data<input aria-label="Confirm app data reset" autoComplete="off" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} /></label>
        {error && <p role="alert" className="dashboard-notice">{error}</p>}
        <div className="reset-actions"><button type="button" disabled={busy || confirmation !== "RESET"} onClick={reset}>{resetting ? "Resetting…" : stopped ? "Retry reset" : "Permanently reset app data"}</button><button type="button" disabled={busy || stopped} onClick={() => { setSaved(null); setConfirmation(""); setError(""); }}>Keep app data</button></div>
        {resetting && <p role="status" className="dashboard-note">Closing the backend, clearing app data, and reopening a fresh session…</p>}
      </section>
    </dialog>}
  </section>;
}
