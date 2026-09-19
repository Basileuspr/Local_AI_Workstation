import ProtectedImage from "../ImagePrivacy";
import { useRef, useState } from "react";
import * as api from "../imageWorkflowApi";

export default function WorkflowExportControls({ record, busy = false, onKeepStitched, onCreated }) {
  const [layout, setLayout] = useState("grid");
  const [composite, setComposite] = useState(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  if (["queued", "running", "cancelling"].includes(record.status) || !record.outputs?.length) return null;

  async function act(action) {
    if (lock.current) return;
    lock.current = true;
    setWorking(true); setError(""); setNotice("");
    try { await action(); }
    catch (err) { setError(err.message || "Could not export workflow images"); }
    finally { lock.current = false; setWorking(false); }
  }

  return <section className="workflow-export" aria-label="Save workflow images">
    <p>All {record.outputs.length} images from this run are saved in Images → Workflow Images.</p>
    <div className="workflow-actions">
      <button type="button" disabled={busy || working} onClick={() => act(async () => {
        await api.downloadImages(record.workflow_id, record.id); setNotice("ZIP download started.");
      })}>Save all images (ZIP)</button>
      <label>Stitch layout <select aria-label="Stitch layout" value={layout} disabled={working}
        onChange={event => { setLayout(event.target.value); setComposite(null); setNotice(""); }}>
        <option value="grid">Grid</option><option value="row">Horizontal row</option><option value="column">Vertical column</option>
      </select></label>
      <button type="button" disabled={busy || working} onClick={() => act(async () => {
        const result = await api.stitch(record.workflow_id, record.id, layout);
        setComposite(result); onCreated?.(); setNotice("Stitched image saved in Workflow Images. Preview it below or save the PNG.");
      })}>Stitch images</button>
    </div>
    <small>Stage order is preserved. Images fit without cropping; large composites are scaled to fit reference-image limits. ZIP keeps the originals.</small>
    {working && <p role="status">Preparing images…</p>}
    {error && <p className="workflow-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {composite && <figure>
      <ProtectedImage src={api.stitchedUrl(record.workflow_id, record.id, composite.layout)} alt={`Stitched workflow in ${composite.layout} layout`} />
      <figcaption>{composite.width} × {composite.height} · stages in reading order</figcaption>
      <div className="workflow-actions">
        <button type="button" disabled={busy || working} onClick={() => act(async () => {
          await api.downloadStitched(record.workflow_id, record.id, composite.layout); setNotice("PNG download started.");
        })}>Save stitched PNG</button>
        {onKeepStitched && <button type="button" disabled={busy || working} onClick={() => act(async () => {
          await onKeepStitched(composite.layout); setNotice("Stitched image kept as a workflow reference.");
        })}>Keep stitched as reference</button>}
      </div>
    </figure>}
  </section>;
}
