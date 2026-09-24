import { useEffect, useRef, useState } from "react";
import * as api from "../imageLibraryApi";
import { processBatch, batchFeedback } from "../bulkActions";

export function FolderEditor({ folder, onClose, onSaved }) {
  const dialog = useRef(null);
  const [name, setName] = useState(folder?.name || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { dialog.current.showModal(); }, []);
  return <dialog ref={dialog} className="collection-dialog" aria-label={folder ? "Rename image folder" : "New image folder"} onCancel={event => { if (busy) event.preventDefault(); }} onClose={onClose}>
    <form onSubmit={async event => { event.preventDefault(); if (busy) return; setBusy(true); try { const saved = await api.folder(name, folder?.id); api.changed(); onSaved(saved); } catch (failure) { setError(failure.message); } finally { setBusy(false); } }}>
      <h2>{folder ? "Rename folder" : "New folder"}</h2>
      <label>Folder name<input autoFocus value={name} maxLength={120} onChange={event => setName(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button disabled={busy || !name.trim()}>Save folder</button></footer>
    </form>
  </dialog>;
}

export default function FileImagesDialog({ images, folders, onClose, createNew = false }) {
  const dialog = useRef(null);
  const [destination, setDestination] = useState(createNew ? "" : folders[0]?.id || "");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const remaining = useRef(images);
  useEffect(() => { dialog.current.showModal(); }, []);
  async function save(event) {
    event.preventDefault(); if (busy) return;
    setBusy(true);
    try {
      const id = newName.trim() ? (await api.folder(newName)).id : destination;
      if (!id) throw new Error("Choose a folder or enter a new folder name");
      setDestination(id); setNewName("");
      const result = await processBatch(remaining.current, async image => {
        if (image.file && !image.session_id && !image.library && !image.run) {
          const uploaded = await api.upload([image.file]);
          const saved = uploaded.images[0];
          if (!saved) throw new Error(uploaded.errors?.[0]?.error || "Could not save this image.");
          return api.importSource({ kind: "library", id: saved.id }, id);
        }
        return api.importSource(api.sourceFor(image), id);
      });
      remaining.current = result.failed.map(item => item.item);
      setFeedback(batchFeedback(result, "Added to folder:")); api.changed();
      if (!result.failed.length) onClose();
    } catch (error) { setFeedback(error.message); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="collection-dialog" aria-label="Add images to folder" onCancel={event => { if (busy) event.preventDefault(); }} onClose={onClose}>
    <form onSubmit={save}><h2>Add {images.length} image(s) to a folder</h2>
      {!createNew && <label>Choose folder<select value={destination} onChange={event => setDestination(event.target.value)}><option value="">Choose…</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>}
      <label>{createNew ? "New folder name" : "Or create a folder"}<input autoFocus={createNew} value={newName} maxLength={120} onChange={event => setNewName(event.target.value)} placeholder="Folder name" /></label>
      <p>Folder images are saved copies with links to their source. Removing a source chat won't remove these copies.</p>
      {feedback && <p role="status">{feedback}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>Close</button><button disabled={busy || (createNew && !newName.trim() && !destination)}>{busy ? "Saving…" : "Add to folder"}</button></footer>
    </form>
  </dialog>;
}
