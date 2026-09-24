import { useEffect, useRef, useState } from "react";
import { dragBox, expandBox, earlierFocus } from "../characterParts";
import * as api from "../characterPartsApi";
import ProtectedImage from "../ImagePrivacy";

export default function CharacterRegionEditor({ initial, source, dataset, catalog, reference, onFocus, onSave, onClose }) {
  const [draft, setDraft] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const dialog = useRef(null), drag = useRef(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  function point(event) { const rect = event.currentTarget.getBoundingClientRect(); return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height]; }
  function change(value) { setDraft(current => ({ ...current, ...value })); }
  const box = draft.box, valid = box.every(Number.isFinite) && box[0] < box[2] && box[1] < box[3] && box.every(value => value >= 0 && value <= 1);
  const named = draft.part !== "custom" || !!draft.detail.trim();
  async function save(state, focus = false) {
    setBusy(true); setError("");
    try { const saved = await onSave({ ...draft, state }); if (focus) onFocus(saved); onClose(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="character-dialog character-region-editor" aria-label="Review character region" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><div><h2>{initial.id ? "Review selection" : "Add a selection"}</h2><p>{source.name} · {source.width} × {source.height}</p></div><button type="button" disabled={busy} onClick={onClose}>Close</button></header>
    <div className="character-editor-grid">
      <div><p className="character-help">Drag a rectangle around the region, or set its edges below. The full source remains available.</p>
        <div className="character-crop-canvas" style={{ aspectRatio: `${source.width} / ${source.height}`, maxWidth: `calc(max(260px, 100dvh - 240px) * ${source.width / source.height})` }}><ProtectedImage rotateView={false} src={api.sourceUrl(dataset.id, source.id)} alt={source.name} />
        <svg viewBox={`0 0 ${source.width} ${source.height}`} role="img" aria-label="Source image with editable crop rectangle"
          onPointerDown={event => { if (busy) return; drag.current = point(event); event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={event => { if (drag.current) change({ box: dragBox(drag.current, point(event)) }); }}
          onPointerUp={event => { if (drag.current) { const next = dragBox(drag.current, point(event)); if (next[0] < next[2] && next[1] < next[3]) change({ box: next }); drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); } }}
          onPointerCancel={() => { drag.current = null; }}>
          {valid && <rect x={box[0] * source.width} y={box[1] * source.height} width={(box[2] - box[0]) * source.width} height={(box[3] - box[1]) * source.height} />}
        </svg></div>
        <div className="character-box-fields">{["Left", "Top", "Right", "Bottom"].map((label, index) => <label key={label}>{label} %<input type="number" min="0" max="100" step="0.1" value={Number((box[index] * 100).toFixed(2))} onChange={event => change({ box: box.map((value, i) => i === index ? Number(event.target.value) / 100 : value) })} /></label>)}</div>
        {valid ? <p className="character-help">Crop: {Math.ceil(box[2] * source.width) - Math.floor(box[0] * source.width)} × {Math.ceil(box[3] * source.height) - Math.floor(box[1] * source.height)} pixels. Crops keep their original resolution.</p> : <p role="alert">Draw a rectangle with a positive width and height inside the image.</p>}
        <button type="button" disabled={busy || !valid} onClick={() => change({ box: expandBox(box) })}>Include more surroundings</button>
        {valid && <details className="character-crop-preview"><summary>Preview crop</summary><div style={{ aspectRatio: `${(box[2] - box[0]) * source.width} / ${(box[3] - box[1]) * source.height}` }}><ProtectedImage rotateView={false} src={api.sourceUrl(dataset.id, source.id)} alt="Current crop preview" style={{ width: `${100 / (box[2] - box[0])}%`, transform: `translate(-${box[0] * 100}%, -${box[1] * 100}%)` }} /></div></details>}
      </div>
      <fieldset disabled={busy} className="character-editor-fields">
        {reference && reference.id !== initial.id && <figure className="character-compare-reference"><ProtectedImage src={api.cropUrl(dataset.id, reference.id, dataset.revision)} alt="Reference for comparison" /><figcaption>Compare with your focus reference</figcaption></figure>}
        <label>Body region<select value={draft.part} onChange={event => change({ part: event.target.value })}>{Object.entries(catalog.parts).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>Anatomical side<select value={draft.side} onChange={event => change({ side: event.target.value })}>{Object.entries(catalog.sides).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>Viewing angle<select value={draft.view} onChange={event => change({ view: event.target.value })}>{Object.entries(catalog.views).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>{draft.part === "custom" ? "Selection name" : "Specific detail"}<input required={draft.part === "custom"} maxLength={100} value={draft.detail} onChange={event => change({ detail: event.target.value })} placeholder={draft.part === "custom" ? "e.g. hip-to-thigh transition, jacket folds" : "e.g. index finger, big toe, open palm"} /></label>
        {!named && <p className="character-help">Name this area so it can be found and compared in other images.</p>}
        <label>Include in training export<select value={draft.export_mode} onChange={event => change({ export_mode: event.target.value })}><option value="both">Full image and crop</option><option value="full">Full image only</option><option value="crop">Crop only</option></select></label>
        <label>Crop caption<textarea rows={3} maxLength={2000} value={draft.caption} onChange={event => change({ caption: event.target.value })} placeholder="Describe only what is visible in this crop. Include your trigger word if needed." /></label>
        <label>Review notes<textarea rows={2} maxLength={2000} value={draft.notes} onChange={event => change({ notes: event.target.value })} /></label>
        {earlierFocus(initial, reference) && <p className="character-help">These analysis notes used an earlier reference. Compare this crop with your current focus above.</p>}
        {draft.flags.length > 0 && <p className="character-flags">Suggested quality flags: {draft.flags.join(" · ")}</p>}
        {initial.origin === "vision" && <p className="character-help">Check the box, anatomical side and viewing angle before accepting this suggestion.</p>}
      </fieldset>
    </div>
    {error && <p className="character-error" role="alert">{error}</p>}
    <footer><button disabled={busy || !valid || !named} onClick={() => save("pending")}>Save for later</button><button disabled={busy || !valid || !named} onClick={() => save("rejected")}>Reject</button>{onFocus && <button className="character-primary" disabled={busy || !valid || !named} onClick={() => save(draft.state, true)}>Use as focus</button>}<button disabled={busy || !valid || !named} onClick={() => save("accepted")}>{busy ? "Saving…" : "Accept selection"}</button></footer>
  </dialog>;
}
