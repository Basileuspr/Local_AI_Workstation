import { useImageGeneration } from "../ImageGenerationContext";
import { QueueRequestStatus } from "./PromptQueue";
import ImageGenerationProgress from "./ImageGenerationProgress";

export default function ImageRequests({ active = true }) {
  const { requests, stop } = useImageGeneration();
  if (!active || !requests.length) return null;
  return <div className="image-requests" aria-label="Submitted image requests">
    {requests.map(request => <article key={request.id}>
      <div><span title={request.prompt}>{request.label&&<strong>{request.label}<br/></strong>}{request.prompt}</span><button type="button" onClick={() => stop(request.id)}>Stop image request</button></div>
      <QueueRequestStatus requestId={request.id} kind="image" />
      <ImageGenerationProgress requestId={request.id} />
    </article>)}
  </div>;
}
