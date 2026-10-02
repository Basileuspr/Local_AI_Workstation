import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDispatch, useStore } from "../useStore";
import { createPromptIndexEntry } from "../api";
import { imagePromptIndexEntry, imagePromptIndexTitle } from "../imagePromptIndex";
import "./SaveImagePrompts.css";

function SavePromptPairDialog({ snapshot, onClose, onSaved }) {
  const dispatch = useDispatch();
  const dialog = useRef(null), inFlight = useRef(false);
  const [title, setTitle] = useState(() => imagePromptIndexTitle(snapshot));
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    const node = dialog.current;
    node.showModal();
    return () => node.close();
  }, []);
  async function save(event) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true); setError("");
    try {
      // Always create a new entry. Saving a small variation never replaces
      // another entry or writes to Index's separate editor draft.
      await createPromptIndexEntry(imagePromptIndexEntry(snapshot, title));
    } catch (failure) {
      setError(failure.message || "Could not save prompts. Please retry.");
      inFlight.current = false; setSaving(false);
      return;
    }
    dispatch({type:"SHOW_TOAST",payload:{message:"Prompt pair saved as a new Index entry",type:"success"}});
    onClose();
    onSaved?.();
  }
  return createPortal(<dialog ref={dialog} className="save-image-prompts-dialog" aria-labelledby="save-image-prompts-title"
    onCancel={event => { event.preventDefault(); if (!inFlight.current) onClose(); }}>
    <form onSubmit={save}>
      <h2 id="save-image-prompts-title">Save prompts to Index</h2>
      <label>Entry name<input autoFocus value={title} maxLength={120} disabled={saving} onChange={event => setTitle(event.target.value)} /></label>
      <label>Positive prompt<textarea readOnly value={snapshot.prompt || ""} /></label>
      <label>Negative prompt<textarea readOnly value={snapshot.negativePrompt || ""} placeholder="No negative prompt" /></label>
      {error && <p role="alert">{error}</p>}
      <div className="save-image-prompts-actions">
        <button type="button" disabled={saving} onClick={onClose}>Cancel</button>
        <button type="submit" disabled={saving || !title.trim()}>{saving ? "Saving…" : "Save new entry"}</button>
      </div>
    </form>
  </dialog>, document.body);
}

export default function SaveImagePrompts({ label = "Save prompts to Index", onSaved }) {
  const { imageSettings } = useStore();
  const [snapshot, setSnapshot] = useState(null);
  return <>
    <button type="button" className="save-image-prompts-button" disabled={!imageSettings.prompt.trim() && !imageSettings.negativePrompt.trim()}
      title="Save the current positive and negative prompts as a new Index entry"
      onClick={() => setSnapshot({prompt:imageSettings.prompt,negativePrompt:imageSettings.negativePrompt})}>{label}</button>
    {snapshot && <SavePromptPairDialog snapshot={snapshot} onClose={() => setSnapshot(null)} onSaved={onSaved} />}
  </>;
}
