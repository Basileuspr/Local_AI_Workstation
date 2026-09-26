import { createMessageId } from "./messageIds";
const KEY = "local-ai-workstation-canvas-v1";
let current, past = [], future = [];
const listeners = new Set();
export function validateCanvas(value) {
  if (!value || !Array.isArray(value.objects) || value.objects.length > 300) throw new Error("Canvas supports up to 300 objects.");
  const ids = new Set();
  for (const item of value.objects) {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id)) throw new Error("Invalid canvas object ID.");
    ids.add(item.id);
    if (!["rect", "ellipse", "text", "line", "arrow", "pen"].includes(item.type)) throw new Error("Unsupported canvas object.");
    if (![item.x,item.y,item.width,item.height].every(n=>Number.isFinite(n)&&Math.abs(n)<=2400)) throw new Error("Invalid canvas coordinates.");
    if (typeof item.text !== "string" || item.text.length > 3000 || !/^#[a-f0-9]{6}$/i.test(item.color)) throw new Error("Invalid canvas text or color.");
    if (item.points && (item.points.length > 2000 || item.points.some(p=>!Array.isArray(p)||p.length!==2||!p.every(n=>Number.isFinite(n)&&Math.abs(n)<=2400)))) throw new Error("Drawing is too large or invalid.");
  }
  return value;
}
export function getCanvas() {
  if (!current) {
    const empty = { objects: [], revision: createMessageId(), selectedIds: [] };
    try { current = { ...empty, ...validateCanvas(JSON.parse(localStorage.getItem(KEY))) }; }
    catch { current = empty; }
  }
  return current;
}
export function subscribeCanvas(listener) { listeners.add(listener); return () => listeners.delete(listener); }
function notify() { for (const listener of listeners) listener(); }
function save(value) { localStorage.setItem(KEY, JSON.stringify(value)); current = value; notify(); }
export function selectCanvas(ids) { current = { ...getCanvas(), selectedIds: ids }; notify(); }
export function commitCanvas(objects) {
  const previous = getCanvas(), next = validateCanvas({ ...previous, objects, revision: createMessageId(), selectedIds: previous.selectedIds.filter(id=>objects.some(item=>item.id===id)) });
  localStorage.setItem(KEY, JSON.stringify(next));
  past = [...past.slice(-29), previous]; future = []; current = next; notify();
}
export function undoCanvas() { if (!past.length) return; const previous = getCanvas(), next = past.at(-1); save({ ...next, revision: createMessageId() }); past.pop(); future.push(previous); }
export function redoCanvas() { if (!future.length) return; const previous = getCanvas(), next = future.at(-1); save({ ...next, revision: createMessageId() }); future.pop(); past.push(previous); }
export function canvasContext() {
  const value = getCanvas(), objects = value.selectedIds.length ? value.objects.filter(item=>value.selectedIds.includes(item.id)) : value.objects;
  const context = { revision: value.revision, width: 1200, height: 800, selected_ids: value.selectedIds, objects };
  if (objects.length > 100 || JSON.stringify(context).length > 10000) throw new Error("Select fewer canvas objects before asking chat to work with them.");
  return context;
}
export function applyCanvasEdit(edit) {
  const current = getCanvas();
  const allowed = edit.allowed_ids || current.selectedIds;
  if (edit.revision !== current.revision) throw new Error("The canvas changed while chat was working. Your edits were preserved; ask chat to try again.");
  let objects = [...current.objects];
  for (const operation of edit.operations) {
    if (operation.op === "add") objects.push({ ...operation.item, id: createMessageId() });
    else {
      const index = objects.findIndex(item=>item.id===operation.id);
      if (index < 0 || (allowed.length && !allowed.includes(operation.id))) throw new Error("Chat tried to change an object outside the canvas selection.");
      if (operation.op === "remove") objects.splice(index,1);
      else if (operation.op === "update") objects[index] = { ...operation.item, id: operation.id };
      else throw new Error("Unsupported canvas edit.");
    }
  }
  commitCanvas(objects);
}
