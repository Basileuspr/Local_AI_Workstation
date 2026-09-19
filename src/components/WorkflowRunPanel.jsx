import ProtectedImage from "../ImagePrivacy";
import * as api from "../imageWorkflowApi";
import { runIsActive } from "../imageWorkflow";
import WorkflowExportControls from "./WorkflowExportControls";

export default function WorkflowRunPanel({ record, busy, onStop, onKeep, onUseText, onKeepStitched }) {
  if (!record) return null;
  const active = runIsActive(record);
  return <section className="workflow-card workflow-run" aria-label="Workflow execution">
    <h2>Run · {record.status}</h2>
    <p role="status">{record.phase}{record.stage_number > 0 ? ` · stage ${record.stage_number} of ${record.stage_count}` : ""}</p>
    {record.total_steps > 0 && <><progress aria-label="Current stage progress" value={record.step} max={record.total_steps} /><p>{record.step} / {record.total_steps} steps</p></>}
    <p className="workflow-muted">Run seed: {record.seed}. Later stages use successive seeds.</p>
    {record.error && <p className="workflow-error" role="alert">{record.error}</p>}
    {active && <button type="button" disabled={record.status === "cancelling"} onClick={onStop}>{record.status === "cancelling" ? "Stopping safely…" : "Stop workflow"}</button>}
    {!active && (record.outputs.length > 0 || record.stage_results.length > 0) && <>
      <WorkflowExportControls key={`${record.workflow_id}:${record.id}`} record={record} busy={busy} onKeepStitched={onKeepStitched} />
      <p>Review these results. Keep an image as a reference before using it in a later scene.</p>
      {record.outputs.map(output => <figure key={output.id}>
        <a href={api.outputUrl(record.workflow_id, record.id, output.id)} target="_blank" rel="noreferrer"><ProtectedImage alt={`Workflow result, ${output.width} by ${output.height}`} src={api.outputUrl(record.workflow_id, record.id, output.id)} /></a>
        <figcaption>{output.width} × {output.height}</figcaption>
        <button type="button" disabled={busy || record.accepted_output_ids.includes(output.id)} onClick={() => onKeep(output)}>{record.accepted_output_ids.includes(output.id) ? "Kept as reference" : "Keep as reference"}</button>
      </figure>)}
      {record.stage_results.filter(result => result.text).map(result => <div key={result.stage_id}>
        <h3>Description / OCR result</h3><p className="workflow-result-text">{result.text}</p>
        <button type="button" disabled={busy} onClick={() => onUseText(result.text)}>Use as positive prompt</button>
      </div>)}
    </>}
  </section>;
}
