export const DEFAULT_PARTS = ["body", "torso", "arm", "leg", "hand", "foot", "finger", "toe", "eye", "mouth"];
export const runActive = run => !!run && ["queued", "running", "cancelling"].includes(run.status);
export function newSelection(sourceId, part = "body", side = "unspecified") {
  return { source_id: sourceId, part, side, view: "unknown", detail: "", box: [0, 0, 1, 1], caption: "", notes: "", flags: [], export_mode: "both", state: "pending" };
}
export function selectionPayload(value) {
  return Object.fromEntries(Object.keys(newSelection(value.source_id)).map(key => [key, value[key]]));
}
export function focusFilters(reference) {
  return { part: reference.part, side: "", view: "", state: "", detail: reference.part === "custom" ? reference.detail : "" };
}
export function focusDescription(reference) {
  return reference.part === "buttocks" ? "How the glutes join the hips, lower back and upper thighs; the flow of the silhouette and consistent anatomy." : "The shape, visual treatment and how this area joins its surroundings.";
}
export function earlierFocus(item, reference) {
  return !!item.focus && !!reference && (item.focus.selection_id !== reference.id
    || item.focus.part !== reference.part || item.focus.detail !== reference.detail
    || item.focus.box.some((edge, i) => edge !== reference.box[i]));
}
export function expandBox(box, padding = .15) {
  const x = (box[2] - box[0]) * padding, y = (box[3] - box[1]) * padding;
  return dragBox([box[0] - x, box[1] - y], [box[2] + x, box[3] + y]);
}
export function dragBox(start, end) {
  const clamp = value => Math.max(0, Math.min(1, value));
  return [clamp(Math.min(start[0], end[0])), clamp(Math.min(start[1], end[1])), clamp(Math.max(start[0], end[0])), clamp(Math.max(start[1], end[1]))];
}
export function filterSelections(items, { part = "", side = "", view = "", state = "", sourceId = "", detail = "" } = {}) {
  return items.filter(item => (!part || item.part === part) && (!side || item.side === side) && (!view || item.view === view)
    && (!state || item.state === state) && (!sourceId || item.source_id === sourceId) && (!detail || item.detail === detail));
}
export function coverage(items) {
  const counts = {};
  for (const item of items) {
    if (item.state !== "accepted") continue;
    const key = `${item.part}:${item.view}`;
    // Multiple boxes on one source must not inflate the number of covered images.
    (counts[key] ||= new Set()).add(item.source_id);
  }
  return Object.fromEntries(Object.entries(counts).map(([key, sources]) => [key, sources.size]));
}
