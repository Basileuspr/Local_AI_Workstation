import { apiUrl } from "./api";
import { readPollingJson, sharedPollingObserver } from "./polling";
import { busyRuntime, inventoryDelay, pendingImages, pendingQueue, runtimeDelay, serviceDelay } from "./pollingPolicies";

export const statusObserver = () => sharedPollingObserver("status", {
  read: options => readPollingJson(apiUrl("/status"), options), interval: serviceDelay,
});
export const runtimeObserver = () => sharedPollingObserver("runtime", {
  read: options => readPollingJson(apiUrl("/runtime/status"), options), interval: runtimeDelay, active: busyRuntime,
});
export const queueObserver = () => sharedPollingObserver("queue", {
  read: options => readPollingJson(apiUrl("/queue"), options),
  interval: (value, context) => inventoryDelay("queue", value, context), active: pendingQueue,
});
export const imageTasksObserver = clientId => sharedPollingObserver(`image-tasks:${clientId}`, {
  read: options => readPollingJson(apiUrl(`/image-generation/tasks?client_id=${encodeURIComponent(clientId)}`), options),
  interval: (value, context) => inventoryDelay("images", value, context), active: pendingImages,
});
export const mobileImageTasksObserver = () => sharedPollingObserver("mobile-image-tasks", {
  read: options => readPollingJson(apiUrl("/mobile/image-tasks"), options),
  interval: (value, context) => context.failures ? inventoryDelay("images", value, context) : context.hidden ? 10000 : 2000,
  active: pendingImages,
});
