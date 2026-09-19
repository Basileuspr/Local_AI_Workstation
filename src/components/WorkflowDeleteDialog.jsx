import { useEffect, useRef, useState } from "react";
import * as workflows from "../imageWorkflowApi";
import * as images from "../imageLibraryApi";

export default function WorkflowDeleteDialog({ items, onDeleted, onClose, onRefresh }) {
  const dialog = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsPin, setNeedsPin] = useState(false);
  const [pin, setPin] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function remove(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    let token;
    try {
      if (needsPin) token = (await images.request("/vault/unlock-for-deletion", "POST", { pin })).token;
      const result = await workflows.remove(items, token);
      images.changed();
      localStorage.setItem("workflows-deleted", JSON.stringify({ ...result, at: Date.now() }));
      await onDeleted(result);
    } catch (failure) {
      if (failure.status === 423) setNeedsPin(true);
      setError(failure.message);
      images.changed();
      await onRefresh?.();
    } finally {
      if (token) await images.request("/vault/lock", "POST", undefined, token).catch(() => {});
      setPin(""); setBusy(false);
    }
  }
  return <dialog ref={dialog} className="collection-dialog" aria-label="Delete image workflows" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <form onSubmit={remove}>
      <h2>Delete {items.length === 1 ? "image workflow" : `${items.length} image workflows`}?</h2>
      <p>Remove the selected workflows, their attached assets, processing history, generated outputs, and stitched images from app storage. This cannot be undone.</p>
      <ul>{items.map(item => <li key={item.id}>{item.name}</li>)}</ul>
      <p>Saved copies in your image collections stay saved, with their workflow links removed. Folders used only by these workflows are removed. Shared folders and independent branches keep their content; branch links are detached.</p>
      <p>Unsaved edits to deleted workflows will be discarded. Finish or stop queued workflow runs first.</p>
      {needsPin && <label>Locked Images PIN<input type="password" inputMode="numeric" pattern="[0-9]{4,12}" minLength={4} maxLength={12} autoComplete="off" value={pin} onChange={event => setPin(event.target.value)} required disabled={busy} /><small>Your PIN is needed to remove links inside encrypted image records. Images remain locked.</small></label>}
      {error && <p className="workflow-error" role="alert">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="danger" disabled={busy}>{busy ? "Deleting…" : "Delete workflows"}</button></footer>
    </form>
  </dialog>;
}
