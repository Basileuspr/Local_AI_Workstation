import { useEffect, useRef, useState } from "react";

export default function DashboardReset() {
  const [saved, setSaved] = useState(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(() => typeof window !== "undefined" ? localStorage.getItem("app-reset-notice") || "" : "");
  const desktop = typeof window !== "undefined" && window.workstationDesktop;
  const dialog = useRef(null);
  useEffect(() => { if (saved && !dialog.current?.open) dialog.current?.showModal(); }, [saved]);
  async function exportInventory() {
    setBusy(true); setError("");
    try {
      const result = await desktop.exportResetInventory();
      if (result.error) throw new Error(result.error);
      if (!result.canceled) { setSaved(result); setConfirmation(""); }
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
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
    <h2>Metadata ZIP &amp; reset</h2>
    {notice && <p className="dashboard-notice" role="status">{notice} <button type="button" onClick={() => { localStorage.removeItem("app-reset-notice"); setNotice(""); }}>Dismiss</button></p>}
    <p className="dashboard-note">Save a ZIP of file counts, storage totals, and basic numeric settings. It excludes chat text, prompts, images, filenames, paths, training artifacts, and user-created buttons. <strong>This is an inventory, not a restorable backup.</strong></p>
    <p className="dashboard-note">Then choose whether to permanently clear app data: chats, all image collections (including Hidden and Locked), blobs, generated images, workflows, LoRAs, training data, memory, Index entries, knowledge base, logs, trash, and recovery backups. Prompt phrase buttons, custom profile buttons, and image tag buttons are preserved.</p>
    <p className="dashboard-note">Installed base models and original files or exports outside the app data folder stay on disk. This clears app storage; it does not securely erase disks, external backups, or Windows history. Finish or cancel running and queued jobs first.</p>
    <button type="button" disabled={!desktop?.exportResetInventory || busy || stopped} onClick={exportInventory}>{busy && !resetting ? "Saving inventory…" : "Save metadata ZIP & review reset"}</button>
    {!desktop?.exportResetInventory && <p className="dashboard-note">Open or restart the desktop app to use this feature.</p>}
    {error && !saved && <p role="alert" className="dashboard-notice">{error}</p>}
    {saved && <dialog ref={dialog} className="reset-native-dialog" onCancel={event => { if (busy || stopped) event.preventDefault(); else { setSaved(null); setConfirmation(""); setError(""); } }}>
      <section className="dashboard-card reset-confirmation" role="dialog" aria-modal="true" aria-labelledby="reset-title">
        <h2 id="reset-title">{stopped ? "Complete interrupted reset" : "Inventory saved — review reset"}</h2>
        <p className="dashboard-note">ZIP saved and verified: <strong>{saved.archive}</strong></p>
        <p className="dashboard-note">{Object.values(saved.report.inventory).reduce((total, group) => total + group.files, 0)} files inventoried. Counts reflect the time of export. Reset clears all current app data in the categories above, including locked images and recovery copies. Your user-created buttons remain.</p>
        <p className="dashboard-notice">Permanent deletion cannot be undone using this metadata ZIP. Original files and exports outside app storage remain.</p>
        <label>Type RESET to permanently clear app data<input aria-label="Confirm app data reset" autoComplete="off" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} /></label>
        {error && <p role="alert" className="dashboard-notice">{error}</p>}
        <div className="reset-actions"><button type="button" disabled={busy || confirmation !== "RESET"} onClick={reset}>{resetting ? "Resetting…" : stopped ? "Retry reset" : "Permanently reset app data"}</button><button type="button" disabled={busy || stopped} onClick={() => { setSaved(null); setConfirmation(""); setError(""); }}>Keep app data</button></div>
        {resetting && <p role="status" className="dashboard-note">Closing the backend, clearing app data, and reopening a fresh session…</p>}
      </section>
    </dialog>}
  </section>;
}
