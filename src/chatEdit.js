import { DEFAULT_ADJUSTMENTS } from "./imageEditor";

export const isEditCommand = text => /^\/edit(?:\s|$)/i.test(text.trim());
export function editCommandSettings(text) {
  const settings = { ...DEFAULT_ADJUSTMENTS };
  const instruction = text.replace(/^\/edit\b/i, "").trim().toLowerCase()
    .replace(/^retain (?:the )?image exact(?:ly)?\s*[,;]?\s*(?:but\s*)?/, "");
  if (!instruction) return settings;
  for (const clause of instruction.split(/\s*(?:,|;|\band\b)\s*/).filter(Boolean)) {
    if (/^(remove|reduce) red (hue|cast)\.?$/.test(clause)) settings.red = 60;
    else if (/^(increase|decrease) (contrast|exposure|saturation|brightness|highlights|shadows|whites|blacks|temperature|tint|vibrance|sharpness|clarity|vignette)\.?$/.test(clause)) {
      const [, direction, key] = clause.match(/^(increase|decrease) (contrast|exposure|saturation|brightness|highlights|shadows|whites|blacks|temperature|tint|vibrance|sharpness|clarity|vignette)/);
      settings[key] = (direction === "increase" ? 1 : -1) * (key === "exposure" ? .5 : 20);
    } else if (/^(remove|reduce) (image )?blur\.?$/.test(clause)) settings.deblur = 35;
    else if (/^refine (?:low[- ]resolution )?image\.?$/.test(clause)) settings.refinement = 40;
    else if (/^rotate (left|right|180)\.?$/.test(clause)) settings.rotation = clause.includes("left") ? 270 : clause.includes("180") ? 180 : 90;
    else throw new Error('This edit needs the controls: send /Edit alone. Supported phrases: reduce red hue, increase/decrease brightness, exposure, contrast, highlights, shadows, whites, blacks, temperature, tint, saturation, vibrance, sharpness, clarity or vignette; remove blur; refine image; rotate left/right/180.');
  }
  return settings;
}
