export const chatStageLabels = {
  queued: "Queued", preparing: "Preparing Chat", checking_model: "Checking Models",
  switching_models: "Switching Models", loading_model: "Loading Model", responding: "Responding",
  preparing_model: "Preparing Model",
  creating_document: "Creating Document", compacting: "Compacting Context", saving: "Saving Reply",
  cancelling: "Stopping Request",
};
export const chatStageLabel = stage => chatStageLabels[stage] || "Running Request";

export function chatActivities(submissions, jobs) {
  return submissions.map((submission, index) => {
    const backend = [...jobs].reverse().find(job => job.request_id === submission.request_id
      && ["queued", "running", "cancelling"].includes(job.status));
    // A completed backend job must not overwrite frontend saving progress.
    const stage = submission.status === "waiting" ? "queued"
      : submission.stage === "saving" ? "saving"
      : submission.stage === "cancelling" || backend?.status === "cancelling" ? "cancelling"
      : ["preparing", "queued", "compacting"].includes(submission.stage) && backend
        ? backend.status === "queued" ? "queued" : backend.stage || submission.stage
        : submission.stage || backend?.stage;
    return { ...submission, model: submission.stage === "compacting" && backend?.model ? backend.model : submission.model,
      stage, statusLabel: chatStageLabel(stage),
      detail: submission.status === "waiting" ? `Waiting behind ${index} earlier request${index === 1 ? "" : "s"}`
        : stage === submission.stage ? submission.stage_detail || backend?.stage_detail || "Preparing the request"
          : backend?.stage_detail || submission.stage_detail || "Preparing the request",
      queuePosition: submission.status === "waiting" ? index : backend?.position };
  });
}
