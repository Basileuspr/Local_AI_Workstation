import useTaskProgress from "../useTaskProgress";

export default function ImageGenerationProgress({ requestId }) {
  const { progress, elapsed, unavailable } = useTaskProgress(
    `image:${requestId}`, `/image-generation/progress/${encodeURIComponent(requestId)}`,
  );
  const step = progress?.step || 0;
  const total = progress?.total_steps || 1;
  return <div className="image-generation-progress">
    <div>{unavailable ? "Progress connection unavailable" : progress?.phase || "Starting generation"} <span>{elapsed === null ? "Waiting for task timing" : `${elapsed.toFixed(1)}s ${unavailable ? "at last update" : "elapsed"}`}</span></div>
    <progress aria-label="Image denoising steps" max={total} value={step || undefined} />
    <small>{step > 0 ? `Denoising: ${step}/${total} steps (${Math.round(step / total * 100)}%)` : "Loading and preparation time is included."} {unavailable ? "Showing last reported progress." : step === total && "Finishing image output..."}</small>
  </div>;
}
