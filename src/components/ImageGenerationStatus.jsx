import { useState } from "react";
import { useImageGeneration } from "../ImageGenerationContext";
import { usePromptQueue, QueueTimeSummary } from "./PromptQueue";
import { activeImageRequests } from "../imageProgress";
import ImageGenerationProgress from "./ImageGenerationProgress";
import ImageRequests from "./ImageRequests";

export default function ImageGenerationStatus({ active = true }) {
  const { requests, stop, generatedImages, batch } = useImageGeneration();
  const { jobs } = usePromptQueue();
  const [expanded, setExpanded] = useState(false);
  const finishedIds = [...(generatedImages || []).map(image => image.request_id),
    ...(batch?.slots || []).filter(slot => slot.status !== 'pending').map(slot => slot.id)];
  const pending = activeImageRequests(requests, jobs, finishedIds);
  const current = pending[0];
  if (!active) return null;
  if (!current) return <QueueTimeSummary images/>;
  return <section className="image-studio-status" aria-label="Generation progress">
    <div className="image-studio-status-heading"><strong>{current.batchLabel ? `${current.batchLabel} · ${current.status === 'queued' ? 'Queued' : current.status === 'cancelling' ? 'Stopping' : current.status === 'saving' ? 'Saving' : 'Generating'}` : current.status === "queued" ? "Image queued" : "Image generation"}</strong>
      <span>{pending.length > 1 ? `${pending.length - 1} more waiting` : ""}</span>
      <button type="button" onClick={() => stop(current.id)}>{current.status === "queued" ? "Cancel image" : "Stop image"}</button>
    </div>
    <ImageGenerationProgress key={current.id} requestId={current.id} reportedProgress={current.progress} status={current.status} />
    <QueueTimeSummary images/>
    {requests.length > 1 && <details onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>All image requests ({requests.length})</summary>
      {expanded && <ImageRequests />}
    </details>}
  </section>;
}
