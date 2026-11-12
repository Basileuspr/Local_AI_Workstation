import {formatQueueTime} from '../queueTiming';
import {usePromptQueue, QueueJobTiming} from './PromptQueue';

export default function MediaGenerationProgress({job, unavailable = false, age = 0}) {
  const queue = usePromptQueue();
  const queued = queue.jobs.find(item => item.kind === 'media-generation' && item.request_id === job.id);
  const progress = job.progress || {};
  const status = queued?.status === 'cancelling' && !queue.error ? 'cancelling' : job.status;
  const waiting = status === 'queued', stopping = status === 'cancelling';
  const phase = waiting ? `Waiting in Prompt Queue${job.position ? ` · #${job.position}` : ''}`
    : stopping ? 'Stopping safely…' : progress.phase || job.phase || 'Preparing generation';
  const elapsed = waiting ? progress.waiting_seconds : progress.elapsed_seconds;
  const step = progress.step ?? job.step ?? 0, total = progress.total_steps ?? job.total_steps ?? 0;
  const remaining = progress.estimated_remaining_seconds;
  const historicalRemaining = queue.error ? null : queue.timing?.jobs[queued?.id]?.remaining;
  const finishing = /Decoding|Saving|Validating/.test(phase);
  return <div className="media-generation-progress" aria-label="Generation progress">
    <p role="status">{phase}</p>
    <progress aria-label="Media generation steps" max={total || 1} value={stopping ? undefined : step || undefined}/>
    <p>{Number.isFinite(elapsed) ? `${formatQueueTime(elapsed + (unavailable ? 0 : age))} ${unavailable ? 'at last update' : waiting ? 'waiting' : 'elapsed'}` : 'Waiting for task timing'}
      {step > 0 && !waiting && ` · ${step}/${total} generation steps (${Math.round(step / total * 100)}%)`}</p>
    <p>{unavailable ? 'Time estimate unavailable · showing last reported progress'
      : stopping ? 'Waiting for the worker to exit and release the GPU'
        : waiting ? 'Generation estimate starts when this request runs'
          : finishing ? 'Finishing output; decoding and saving can take additional time'
            : Number.isFinite(remaining) && remaining > 0 ? `Estimated ${formatQueueTime(remaining)} of generation remaining; decoding and saving add time`
              : step > 0 && step === total ? 'Generation steps finished; preparing output'
                : Number.isFinite(historicalRemaining) && historicalRemaining > 0 ? `Estimated ${formatQueueTime(historicalRemaining)} remaining from matching completed runs`
                : 'Estimating after the first generation step; model loading and preparation may take several minutes'}</p>
    {progress.detail && <small>{progress.detail}</small>}
    {!unavailable && progress.last_activity_seconds >= 30 && <small>No new runtime progress for {formatQueueTime(progress.last_activity_seconds)}. The worker may still be computing or transferring model data.</small>}
    {queued && waiting && <QueueJobTiming jobId={queued.id}/>}
  </div>;
}
