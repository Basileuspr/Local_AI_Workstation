import { apiUrl } from "./api";

export async function bridgeRequest(path = "", method = "GET", body) {
  const response = await fetch(apiUrl(`/bridge${path}`), {
    method, cache: "no-store", signal: AbortSignal.timeout(40000),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value.detail === "string" ? value.detail : "Bridge request could not be completed.");
  return value;
}

export const bridgePending = job => !["completed", "failed", "cancelled", "interrupted"].includes(job.status);
export const bridgeJobStatus = job => job.connection_error ? "Connection lost · execution status unknown" :
  job.cancel_requested && bridgePending(job) ? "Cancellation requested · awaiting worker" : job.status;
