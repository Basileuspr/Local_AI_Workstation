import GeneratedImagePreview from "./GeneratedImagePreview";
import { imageSourceUrl as apiUrl } from "../imageSources";
import ImageSeedControls from "./ImageSeedControls";
import {usePromptQueue} from './PromptQueue';
import {useImageRemoval} from './ImageRemovalControls';
import {formatImageEstimate, imageRemainingSeconds} from '../imageProgress';
import {formatQueueTime} from '../queueTiming';

export default function ImageBatchOutput({ batch, requests = [], onOpen, onEdit, onCopy, onRemove, onReference, editDisabled, copying }) {
  const removal = useImageRemoval(batch.slots.filter(slot => slot.image), slots => onRemove?.(slots.map(slot => slot.image)), {label:'batch images', scope:batch.id});
  const count = batch.slots.length;
  const columns = Math.min(4, Math.ceil(Math.sqrt(count)));
  const {jobs, timing, error} = usePromptQueue();
  const byRequest = new Map(jobs.filter(job=>job.kind==='image').map(job=>[job.request_id,{...job,queueId:job.id}]));
  for (const request of requests) byRequest.set(request.id, {...byRequest.get(request.id), ...request});
  const currentIndex = batch.slots.findIndex(slot => slot.status === 'pending' && byRequest.get(slot.id)?.status === 'running' && byRequest.get(slot.id)?.stage !== 'saving');
  const finished = batch.slots.every(slot => slot.status !== 'pending');
  const finishes = batch.slots.filter(slot => slot.status === 'pending').map(slot => timing?.jobs[byRequest.get(slot.id)?.queueId]?.finish);
  const remaining = finishes.length && finishes.every(value => Number.isFinite(value)) ? Math.max(...finishes) : null;
  return <section className="image-batch-output" aria-label="Batch output">
    <p className="image-batch-output-heading" role="status">{finished ? 'Batch finished' : 'Batch'} · {batch.slots.filter(slot => slot.status === "complete").length} / {count} images ready{currentIndex >= 0 ? ` · Generating image ${currentIndex + 1} of ${count}` : ''}</p>
    {!finished && !error && remaining !== null && <p>Estimated batch remaining: {formatQueueTime(remaining)}</p>}
    {onRemove && removal.toolbar}
    <div className="image-batch-output-grid" style={{ "--batch-columns": columns, "--batch-rows": Math.ceil(count / columns) }}>
      {batch.slots.map((slot, index) => {
        const job=byRequest.get(slot.id), progress=job?.progress;
        const label=`Image ${index+1} of ${count}`;
        const waiting=slot.status==='pending' ? job?.status==='saving' || job?.stage==='saving' ? 'Saving image…' : job?.status==='running' ? progress?.phase || 'Generating…' : job?.status==='cancelling' ? 'Stopping…' : job?.status==='completed' ? 'Saving image…' : job?.status==='queued' ? `Queued${job.position ? ` · waiting position ${job.position}` : ''}` : 'Waiting for image…' : null;
        const remaining = imageRemainingSeconds(progress, progress?.elapsed_seconds);
        return <article className="image-batch-output-tile" key={slot.id} aria-label={`Batch image ${index + 1}`}>
        <strong className="image-batch-item-counter">{label}{slot.image ? ' · Ready' : ''}</strong>
        {slot.image ? <>
          {onRemove && removal.controls(slot, `batch image ${index + 1}`)}
          <GeneratedImagePreview key={slot.image.url} className="image-batch-output-preview" src={apiUrl(slot.image.url)} alt={`Batch image ${index + 1}`} onOpen={onOpen ? () => onOpen(slot.image) : undefined} />
          <div className="image-batch-output-actions">
            {onReference && <button type="button" disabled={editDisabled} onClick={() => onReference(slot.image)}>Use as reference</button>}
            <button type="button" disabled={editDisabled} onClick={() => onEdit(slot.image)}>Edit Image</button>
            <button type="button" disabled={copying} onClick={() => onCopy(slot.image)}>Copy Image</button>
          </div>
          <ImageSeedControls seed={slot.image.seed} showMissing />
          {slot.image.output_warning && <small role="alert">{slot.image.output_warning}</small>}
        </> : <div className="image-batch-output-placeholder">
          <span>{slot.status === "removed" ? "Removed from selection" : slot.status === "failed" ? "Failed" : slot.status === "stopped" ? "Stopped" : slot.status === "deleted" ? "Deleted" : waiting}</span>
          {slot.status==='pending' && job?.status==='running' && <>
            <progress aria-label={`${label} generation progress`} max={progress?.total_steps || 1} value={progress?.step || undefined}/>
            {progress?.step > 0 && progress?.total_steps > 0 && <small>{progress.step} / {progress.total_steps} steps · {Math.round(progress.step/progress.total_steps*100)}%</small>}
            {remaining !== null && <small>{formatImageEstimate(remaining)}</small>}
          </>}
          {slot.status === "failed" && <small role="alert">{slot.error}</small>}
        </div>}
      </article>;})}
    </div>
  </section>;
}
