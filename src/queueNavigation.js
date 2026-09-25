export function queueDestination(job) {
  if (["chat", "image", "compact"].includes(job.kind)) {
    return { tab: job.kind === "image" && !job.session_id ? "generate" : "chats", sessionId: job.session_id || null, requestId: job.request_id || job.id };
  }
  if (["training", "analysis"].includes(job.kind)) return { tab: "lora", projectId: job.project_id };
  if (job.kind === "workflow") return { tab: "workflows", workflowId: job.project_id, scene: job.owner?.startsWith("scene:") };
  if (job.kind === "character-parts") return { tab: "character-parts", datasetId: job.project_id };
  if (job.kind === "embedding") return { tab: "knowledge" };
  return null;
}
