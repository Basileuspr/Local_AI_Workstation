// Preview mirrors the backend's deterministic constructor; the backend always
// recompiles and validates the authoritative prompt before saving or running.
export function scenePrompt(state) {
  const parts = [];
  const add = (label, value) => { if (value?.trim()) parts.push(`${label}: ${value.trim().replace(/\.+$/, "")}.`); };
  add("Visual style", state.visual_style);
  for (const key of ["name", "appearance", "clothing", "accessories"]) add(`Character ${key}`, state.character[key]);
  for (const [group, fields] of [
    ["environment", ["location", "background"]], ["camera", ["framing", "angle", "focal_length", "orientation", "position"]],
    ["lighting", ["source", "direction", "intensity", "style"]], ["body", ["stance", "left_arm", "right_arm", "left_hand", "right_hand", "wrist_rotation", "gaze", "orientation"]],
  ]) for (const key of fields) add(`${group[0].toUpperCase() + group.slice(1)} ${key.replaceAll("_", " ")}`, state[group][key]);
  for (const obj of state.objects) {
    const label = obj.name.trim() || obj.id;
    add("Visible object", label);
    for (const key of ["appearance", "position", "orientation", "contact", "progression"]) add(`${label} ${key}`, obj[key]);
  }
  add("Visible action", state.current_action);
  return parts.join(" ");
}

export const SCENE_FIELDS = [
  ["character", "Character", [["name", "Name"], ["appearance", "Appearance"], ["clothing", "Clothing"], ["accessories", "Accessories"]]],
  ["environment", "Environment", [["location", "Location"], ["background", "Background details"]]],
  ["camera", "Camera", [["framing", "Framing"], ["angle", "Angle"], ["focal_length", "Focal length"], ["orientation", "Orientation"], ["position", "Camera position"]]],
  ["lighting", "Lighting", [["source", "Source"], ["direction", "Direction"], ["intensity", "Intensity"], ["style", "Lighting style"]]],
  ["body", "Body and hands", [["stance", "Stance"], ["left_arm", "Left arm"], ["right_arm", "Right arm"], ["left_hand", "Left hand"], ["right_hand", "Right hand"], ["wrist_rotation", "Wrist rotation"], ["gaze", "Gaze"], ["orientation", "Body orientation"]]],
];

export function newSceneObject() {
  return { id: crypto.randomUUID().replaceAll("-", ""), name: "", appearance: "", position: "", orientation: "", contact: "", progression: "" };
}

export const DENOISE_PRESETS = [{label:"Small change · 0.25", value:.25}, {label:"Moderate change · 0.40", value:.4}];
