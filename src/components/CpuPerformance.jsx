const seconds = (value) => typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}s` : "—";

export default function CpuPerformance({ report, timings, analysis = false }) {
  if (!report?.mode && !Object.keys(timings || {}).length) return null;
  return <div className="lora-cpu-performance" aria-label={analysis ? "Analysis performance" : "Training performance"}>
    {report?.mode && <p>CPU Assistance: {report.mode} · up to {report.workers} preparation workers · {(report.budget_bytes / 1024 ** 2).toFixed(0)} MiB preload budget</p>}
    {analysis ? <p>Preparation wait: {seconds(report?.preparation_wait_seconds)} · Vision requests: {seconds(timings?.vision_seconds)}</p>
      : <p>Initial preparation: {seconds(timings?.preparation_seconds)} · Training input wait: {seconds(timings?.input_wait_seconds)} · Training steps: {seconds(timings?.training_seconds)}</p>}
    {report?.preparation_worker_seconds != null && <p>CPU preparation work: {seconds(report.preparation_worker_seconds)} (summed across workers; can overlap model work).</p>}
    {report?.serial_fallbacks > 0 && <p>{report.serial_fallbacks} preparation items ran without preloading to respect the budget or available RAM.</p>}
  </div>;
}
