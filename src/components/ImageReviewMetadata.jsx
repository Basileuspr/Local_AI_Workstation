import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as api from "../imageLibraryApi";
import ImageTagButtons from "./ImageTagButtons";

const ImageReviewMetadata = forwardRef(function ImageReviewMetadata({ image, tags, onSaved, onTagsChanged, disabled }, ref) {
  const initial = image.annotations?.caption || "";
  const [caption, setCaption] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const draft = useRef(initial), persisted = useRef(initial), chain = useRef(Promise.resolve()), alive = useRef(true);
  const latest = useRef(image); latest.current = image;
  const onSavedRef = useRef(onSaved); onSavedRef.current = onSaved;
  function saveCaption() {
    const value = draft.current;
    const request = chain.current.catch(() => {}).then(async () => {
      if (value === persisted.current) return;
      if (alive.current) { setSaving(true); setError(""); }
      try {
        const updated = await api.edit(image.id, { caption: value });
        persisted.current = value;
        if (alive.current) { setSaved(value); onSavedRef.current({ id: updated.id, annotations: updated.annotations }); }
      } catch (failure) { if (alive.current) setError(failure.message); throw failure; }
      finally { if (alive.current) setSaving(false); }
    });
    chain.current = request;
    return request;
  }
  useImperativeHandle(ref, () => ({ save: saveCaption }));
  useEffect(() => {
    const timer = setTimeout(() => { saveCaption().catch(() => {}); }, 600);
    return () => clearTimeout(timer);
  }, [caption]);
  useEffect(() => { alive.current = true; return () => { saveCaption().catch(() => {}); alive.current = false; }; }, []);
  async function toggle(id, added = false) {
    const current = latest.current.tag_ids || [];
    const tag_ids = added ? [...new Set([...current, id])] : current.includes(id) ? current.filter(value => value !== id) : [...current, id];
    const updated = await api.edit(image.id, { tag_ids });
    latest.current = { ...latest.current, ...updated };
    if (alive.current) onSavedRef.current({ id: updated.id, tag_ids: updated.tag_ids });
  }
  return <div className="review-metadata">
    <label>Caption / identity notes<textarea className="review-caption" aria-label="Image caption" rows={2} maxLength={10000} value={caption} disabled={disabled} onChange={event => { draft.current = event.target.value; setCaption(event.target.value); }} placeholder="Add a caption or identity notes…" /></label>
    <div className="review-caption-status"><span role="status">{saving ? "Saving caption…" : caption === saved ? "Caption saved" : "Unsaved caption"}</span><button type="button" disabled={disabled || saving || caption === saved} onClick={() => saveCaption().catch(() => {})}>Save caption</button></div>
    {error && <p role="alert">{error}</p>}
    <ImageTagButtons tags={tags} selected={image.tag_ids || []} onToggle={toggle} onCreated={tag => toggle(tag.id, true)} onChanged={onTagsChanged} disabled={disabled} />
  </div>;
});
export default ImageReviewMetadata;
