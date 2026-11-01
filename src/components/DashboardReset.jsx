import { useEffect, useRef, useState } from "react";
import ActionMenu from './ActionMenu';

export default function DashboardReset() {
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState("");
  const [exportNotice, setExportNotice] = useState("");
  const [resetting, setResetting] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(() => typeof window !== "undefined" ? localStorage.getItem("app-reset-notice") || "" : "");
  const [importReview, setImportReview] = useState(null);
  const [importPending, setImportPending] = useState(false);
  const [resetMode, setResetMode] = useState('reconnect');
  const [sections, setSections] = useState([]);
  const [keepPhoneSetup, setKeepPhoneSetup] = useState(true);
  const desktop = typeof window !== "undefined" && window.workstationDesktop;
  const dialog = useRef(null);
  const importDialog = useRef(null);
  useEffect(() => {
    if (saved && !dialog.current?.open) {
      dialog.current?.showModal();
      dialog.current?.querySelector('#reset-title')?.focus();
    }
  }, [saved]);
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
      if (!result.canceled) { setImportReview(result); }
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); setOperation(""); }
  }
  async function importBackup() {
    if (!importReview || busy) return;
    setBusy(true); setOperation("import"); setError("");
    try {
      const result = await desktop.importAppBackup(importReview.ticket, "IMPORT");
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
      const recovery = result.report.reset_options;
      setResetMode(recovery ? 'selected' : 'reconnect');
      setSections(recovery?.sections || []);
      setKeepPhoneSetup(recovery?.keep_mobile_setup ?? true);
      setStopped(Boolean(result.report.reset_pending));
      setSaved(result);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); setOperation(""); }
  }
  async function reset() {
    if (!saved || busy || (!legacyRecovery && !selectedSections.length)) return;
    setBusy(true); setResetting(true); setError("");
    try {
      const result = await desktop.resetAppData(saved.ticket, "RESET", Boolean(saved.report.keep_image_manager), resetOptions);
      if (result.error) { setStopped(Boolean(result.backendStopped)); throw new Error(result.error); }
      // The desktop also sends a completion event for the outer reset screen.
      window.location.reload();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); setResetting(false); }
  }
  const availableSections = saved?.report.reset_sections || [];
  const selectedSections = resetMode === 'selected' ? sections : availableSections.map(section => section.id);
  const legacyRecovery = saved?.report.reset_pending && !saved.report.reset_options;
  const resetOptions = legacyRecovery ? undefined : {sections: selectedSections, keep_mobile_setup: resetMode === 'reconnect' || (resetMode === 'selected' && sections.includes('mobile') && keepPhoneSetup)};
  const selectedFiles = availableSections.filter(section => selectedSections.includes(section.id)).reduce((total, section) => total + section.files, 0);
  return <section className="dashboard-card dashboard-reset" aria-label="App data reset">
    <h2>App data</h2>
    {notice && <p className="dashboard-notice" role="status">{notice} <button type="button" onClick={() => { localStorage.removeItem("app-reset-notice"); setNotice(""); }}>Dismiss</button></p>}

    <div className="tools-toolbar">
    <button type="button" disabled={!desktop?.exportAppBackup || busy || stopped || importPending} onClick={() => exportArchive("backup")}>{operation === "backup" ? "Saving and verifying backup…" : "EXPORT BACK-UP"}</button>
    <ActionMenu label="App data options" actions={[
      {label:'SAVE METADATA', disabled:!desktop?.exportResetInventory || busy || stopped || importPending, onClick:() => exportArchive('metadata')},
      {label:'IMPORT BACK-UP', disabled:!desktop?.prepareBackupImport || busy || stopped || importPending, onClick:reviewImport},
      {label:'RESET APP DATA & SANITIZE APPLICATION', danger:true, disabled:!desktop?.prepareAppReset || busy || stopped || importPending, onClick:reviewReset},
    ]}/>
    </div>
    {busy && !saved && !importReview && <p role="status">{{metadata:'Saving metadata…',backup:'Saving and verifying backup…',review:'Reviewing app data…','inspect-import':'Verifying backup…','recover-import':'Recovering…'}[operation] || 'Working with app data…'}</p>}
    {importPending && <p className="dashboard-notice" role="alert">An import was interrupted. Recover previous data before continuing. <button type="button" disabled={busy} onClick={recoverImport}>{operation === "recover-import" ? "Recovering…" : "Recover previous data"}</button></p>}

    {!desktop?.prepareBackupImport && <p className="dashboard-note">Fully quit and reopen the desktop app to use these features.</p>}
    {exportNotice && <p role="status" className="dashboard-notice">{exportNotice}</p>}
    {error && !saved && <p role="alert" className="dashboard-notice">{error}</p>}
    {importReview && <dialog ref={importDialog} className="reset-native-dialog" onCancel={event => { if (busy) event.preventDefault(); else { setImportReview(null); } }}>
      <section className="dashboard-card reset-confirmation" aria-labelledby="import-title">
        <h2 id="import-title">Import back-up</h2>
        <p className="dashboard-note">Verified backup: <strong>{importReview.archive}</strong></p>
        <p className="dashboard-note">Created {importReview.report.created_at}. Contains {importReview.report.files.toLocaleString()} data files; {importReview.report.bytes.toLocaleString()} bytes including desktop preferences.</p>
        <p className="dashboard-notice">This replaces current chats, media, LoRAs, and settings with the backup. It does not merge them. Image Manager and Media Manager keep their current catalogs. Your current app data and preferences will be retained in a recovery folder beside app data; its location is shown after import. Save edits and finish or cancel running work first.</p>
        {error && <p role="alert" className="dashboard-notice">{error}</p>}
        <div className="reset-actions"><button type="button" disabled={busy || stopped || importPending} onClick={importBackup}>{operation === "import" ? "Importing…" : "Import and replace app data"}</button><button type="button" disabled={busy} autoFocus onClick={() => { setImportReview(null); }}>Cancel</button>{importPending && <button type="button" disabled={busy} onClick={recoverImport}>Recover previous data</button>}</div>
        {operation === "import" && <p role="status" className="dashboard-note">Staging and verifying files, retaining current data, and restoring the backup…</p>}
      </section>
    </dialog>}
    {saved && <dialog ref={dialog} className="reset-native-dialog" onCancel={event => { if (busy || stopped) event.preventDefault(); else { setSaved(null); setError(""); } }}>
      <section className="dashboard-card reset-confirmation" role="dialog" aria-modal="true" aria-labelledby="reset-title">
        <h2 id="reset-title" tabIndex={-1}>{stopped ? "Complete interrupted reset" : "Reset app data & sanitize application"}</h2>
        {!legacyRecovery && <>
          <fieldset disabled={busy || stopped} className="reset-scope"><legend>What would you like to clear?</legend>
            <label><input type="radio" name="reset-scope" checked={resetMode === 'reconnect'} onChange={() => setResetMode('reconnect')} />Clear app data, keep phone setup</label>
            <p className="dashboard-note">Clears all sections below and revokes phone access. Keeps only the HTTPS address, listener port and certificate paths so you can start the connection and create a fresh invitation.</p>
            <label><input type="radio" name="reset-scope" checked={resetMode === 'full'} onChange={() => setResetMode('full')} />Clear all app data, including phone setup</label>
            <label><input type="radio" name="reset-scope" checked={resetMode === 'selected'} onChange={() => setResetMode('selected')} />Choose specific sections</label>
          </fieldset>
          <fieldset disabled={busy || stopped} className="reset-scope"><legend>{resetMode === 'selected' ? 'Select sections to sanitize' : 'Sections that will be sanitized'}</legend>
            {availableSections.map(section => <label key={section.id} className="reset-section"><input type="checkbox" checked={selectedSections.includes(section.id)} disabled={resetMode !== 'selected'} onChange={event => setSections(current => event.target.checked ? [...current, section.id] : current.filter(id => id !== section.id))} /><span><strong>{section.label}</strong> · {section.files.toLocaleString()} app-data files<small>{section.description}</small></span></label>)}
            {resetMode === 'selected' && sections.includes('mobile') && <label><input type="checkbox" checked={keepPhoneSetup} onChange={event => setKeepPhoneSetup(event.target.checked)} />Keep phone connection setup; revoke paired phones</label>}
          </fieldset>
          <p className="dashboard-note">{selectedFiles.toLocaleString()} app-data files in the selected sections at review time. Desktop storage is additional and includes saved canvas and drafts. Unselected app-data files stay in place. Related copies can remain in other sections; deleting media can leave missing attachments in retained chats.</p>
        </>}
        {legacyRecovery && <p className="dashboard-notice">Finish the original full reset with its original retention choices.</p>}
        <p className="dashboard-note">Installed base models and files outside app data remain, including external libraries, exports, backups, separate browser profiles and import recovery folders. This does not securely erase disks or Windows/Git history.</p>
        <p className="dashboard-note">Image Manager keeps its folders, catalog, tags, favorites, hidden state and recoverable external Trash automatically, like Media Manager. App-data reset and backup import do not replace these catalogs. Images stored inside app data are deleted when App media and documents is selected.</p>
        <p className="dashboard-notice">Permanent deletion cannot be undone. No backup is created automatically. Choose Keep app data and use EXPORT BACK-UP first if you want a recovery copy. SAVE METADATA cannot restore deleted content.</p>
        {error && <p role="alert" className="dashboard-notice">{error}</p>}
        <div className="reset-actions"><button type="button" disabled={busy || (!legacyRecovery && !selectedSections.length)} onClick={reset}>{resetting ? "Resetting…" : stopped ? "Retry reset" : "Permanently sanitize selected data"}</button><button type="button" disabled={busy || stopped} autoFocus onClick={() => { setSaved(null); setError(""); }}>Keep app data</button></div>
        {resetting && <p role="status" className="dashboard-note">Closing the backend, clearing app data, and reopening a fresh session…</p>}
      </section>
    </dialog>}
  </section>;
}
