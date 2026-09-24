import { ADJUSTMENT_CONTROLS, DEFAULT_ADJUSTMENTS } from './imageEditor';

export function newEditState(settings = {}) {
  return { settings: { ...DEFAULT_ADJUSTMENTS, ...settings }, anchor: { ...DEFAULT_ADJUSTMENTS }, stages: [], colorEdits: [],
    colorSamples: [{id:'sample-1',name:'Sample 1',color:'#e2b899'}] };
}
export function currentPass(edit) {
  return { ...Object.fromEntries(ADJUSTMENT_CONTROLS.map(({ key }) => {
    const delta = +(edit.settings[key] - edit.anchor[key]).toFixed(3);
    return [key, ['sharpness', 'deblur', 'refinement'].includes(key) ? Math.max(0, delta) : delta];
  })),
    rotation: ((edit.settings.rotation - edit.anchor.rotation) % 360 + 360) % 360, relative: true, colorEdits: edit.colorEdits };
}
export function editRecipe(edit) { return { ...currentPass(edit), stages: edit.stages.map(stage => stage.pass) }; }
export function hasCurrentPass(edit) { const pass = currentPass(edit); return Boolean(ADJUSTMENT_CONTROLS.some(c => pass[c.key]) || pass.rotation || pass.colorEdits.length); }
export function lockEditStage(edit) {
  if (!hasCurrentPass(edit)) return edit;
  return { ...edit, anchor: { ...edit.settings }, colorEdits: [],
    stages: [...edit.stages, { pass: currentPass(edit), beforeAnchor: edit.anchor, markers: { ...edit.settings } }] };
}
export function unlockEditStage(edit) {
  if (!edit.stages.length) return edit;
  const last = edit.stages.at(-1);
  if (last.repeated) return { ...edit, stages: edit.stages.slice(0, -1) };
  return { ...edit, settings: { ...last.markers }, anchor: { ...last.beforeAnchor }, colorEdits: last.pass.colorEdits || [], stages: edit.stages.slice(0, -1) };
}
export function repeatEditStage(edit) {
  if (!edit.stages.length || hasCurrentPass(edit)) return edit;
  const last = edit.stages.at(-1);
  return { ...edit, stages: [...edit.stages, { ...last, beforeAnchor: { ...edit.anchor }, markers: { ...edit.settings }, repeated: true }] };
}
