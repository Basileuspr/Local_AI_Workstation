import useTaskProgress from "../useTaskProgress";
import { formatImageEstimate, imageRemainingSeconds } from "../imageProgress";
import { QueueJobTiming, usePromptQueue } from './PromptQueue';

export default function ImageGenerationProgress({ requestId, reportedProgress, status }) {
  const measured = useTaskProgress(
    `image:${requestId}`, `/image-generation/progress/${encodeURIComponent(requestId)}`,
    750, status === undefined && !reportedProgress,
  );
  const progress = reportedProgress || measured.progress;
  const elapsed = reportedProgress?.elapsed_seconds ?? measured.elapsed;
  const unavailable = !reportedProgress && measured.unavailable;
  const queue = usePromptQueue();
  const job = queue.jobs.find(item => item.kind === 'image' && item.request_id === requestId);
  const historicalRemaining = queue.error ? null : queue.timing?.jobs[job?.id]?.remaining;
  const step = progress?.step || 0;
  const total = progress?.total_steps || 1;
  const remaining = unavailable ? null : imageRemainingSeconds(progress, elapsed);
  const waiting = status === 'queued' || progress?.phase?.startsWith("Waiting");
  const finishing = status === 'saving' || /Saving|Decoding|complete/i.test(progress?.phase || '');
  return <div className="image-generation-progress">
    <div>{unavailable ? "Progress connection unavailable" : progress?.phase || "Starting generation"} <span>{elapsed === null ? "Waiting for task timing" : `${elapsed.toFixed(1)}s ${unavailable ? "at last update" : waiting ? "waiting" : "elapsed"}`}</span></div>
    <progress aria-label="Image denoising steps" max={total} value={step || undefined} />
    <div className="image-generation-estimate" title="Estimate from generation steps; final image decoding and saving may take longer.">{remaining !== null ? formatImageEstimate(remaining)
      : unavailable ? "Time estimate unavailable" : waiting ? "Live step estimate starts when this image runs"
        : finishing || step > 0 && step === total ? "Finishing image output…"
          : Number.isFinite(historicalRemaining) ? formatImageEstimate(historicalRemaining)
            : step > 0 ? "Step timing unavailable" : "Estimating after the first generation step…"}</div>
    <small>{step > 0 ? `Denoising: ${step}/${total} steps (${Math.round(step / total * 100)}%)` : "Loading and preparation time is included."} {unavailable ? "Showing last reported progress." : step === total && "Finishing image output..."}</small>
    <QueueJobTiming requestId={requestId}/>
  </div>;
}
