import { apiUrl } from "./api";

export async function bridgeRequest(path = "", method = "GET", body) {
  let response;
  try { response = await fetch(apiUrl(`/bridge${path}`), {
    method, cache: "no-store", signal: AbortSignal.timeout(40000),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }); } catch (error) {
    throw new Error(error?.name === "TimeoutError" || error?.name === "AbortError"
      ? "The local bridge request timed out. Its outcome may be unknown; check job status before sending more work."
      : "Cannot reach the local app backend. Check startup status and logs.");
  }
  let value;
  try { value = await response.json(); }
  catch { throw new Error(`Bridge returned an unreadable response (${response.status}). Check the backend log.`); }
  if (!response.ok) throw new Error(typeof value.detail === "string" ? value.detail : "Bridge request could not be completed.");
  return value;
}

export const bridgePending = job => !["completed", "failed", "cancelled", "interrupted"].includes(job.status);
export const bridgeJobStatus = job => job.connection_error ? "Connection lost · execution status unknown" :
  job.cancel_requested && bridgePending(job) ? "Cancellation requested · awaiting worker" : job.status;
