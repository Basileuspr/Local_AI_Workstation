import ProtectedImage from "../ImagePrivacy";
import * as api from "../characterPartsApi";

export default function CharacterFocus({ dataset, reference, catalog, description, onDescription, onEdit, onClear, onDraw, disabled }) {
  if (!reference) return <section className="character-focus" aria-label="Choose a focus">
    <h2>Focus on an area you like</h2>
    <p>Start with buttocks / glutes, or draw around any area of an image. Keep enough of the hips, lower back and upper thighs to judge how the form joins the character.</p>
    <p>Use the crop as your temporary reference, suggest that region in other images, then compare and accept the examples you want.</p>
    <button className="character-primary" disabled={disabled} onClick={onDraw}>Select area &amp; focus</button>
  </section>;
  const source = dataset.sources.find(item => item.id === reference.source_id);
  return <section className="character-focus has-reference" aria-label="Current focus">
    <div className="character-focus-images">
      <figure><ProtectedImage src={api.cropUrl(dataset.id, reference.id, dataset.revision)} alt="Focus reference crop" /><figcaption>Reference crop</figcaption></figure>
      <figure><ProtectedImage src={api.sourceUrl(dataset.id, reference.source_id, true)} alt="Focus reference in the full character" /><figcaption>Full image context</figcaption></figure>
    </div>
    <div className="character-focus-content"><h2>Focus: {catalog.parts[reference.part]}{reference.detail ? ` · ${reference.detail}` : ""}</h2>
      <p>{source?.name} · {catalog.views[reference.view]}</p>
      <label>What to look for<textarea maxLength={1000} rows={2} value={description} onChange={event => onDescription(event.target.value)} /></label>
      <p className="character-help">Suggestions use this crop as a visual reference. Review the comparison notes and original context before accepting.</p>
      <div className="character-actions"><button disabled={disabled} onClick={onEdit}>Adjust reference</button><button disabled={disabled} onClick={onClear}>Clear focus</button></div>
    </div>
  </section>;
}
