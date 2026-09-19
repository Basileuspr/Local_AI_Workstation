import useTaskProgress from "../useTaskProgress";
import CpuPerformance from "./CpuPerformance";

export default function LoraAnalysisProgress({ projectId, requestId, total }) {
  const { progress, elapsed, unavailable } = useTaskProgress(
    `analysis:${projectId}:${requestId}`, `/lora/projects/${encodeURIComponent(projectId)}/analysis-progress`, 1000,
  );
  return <div className="image-generation-progress">
    <div>{progress?.completed || 0} / {progress?.total || total} images analyzed <span>{elapsed === null ? "Waiting for task timing" : `${Math.floor(elapsed / 60)}m ${Math.floor(elapsed % 60)}s ${unavailable ? "at last update" : "elapsed"}`}</span></div>
    <progress aria-label="Dataset images analyzed" value={progress ? progress.completed || 0 : undefined} max={progress?.total || total || 1} />
    <small>{unavailable ? "Progress connection unavailable; showing last reported progress." : progress ? `Processing up to ${progress.batch_size} images in this batch. Model loading and image encoding can take time.` : "Waiting for the analysis worker..."}</small>
    <CpuPerformance report={progress?.cpu_assistance} timings={progress?.timings} analysis />
  </div>;
}
