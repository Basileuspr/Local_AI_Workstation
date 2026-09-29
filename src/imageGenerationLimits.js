// Application limits shared by Generate, chat, workflows, and scenes.
export const MAX_IMAGE_STEPS = 200;
export const MAX_IMAGE_GUIDANCE = 30;
export const DEFAULT_RESOLUTION_LIMITS = { min_side: 256, standard_max_side: 1536, extended_max_side: 2048 };
export function imageSizeLimits(allowLongWait, limits = DEFAULT_RESOLUTION_LIMITS) {
  limits = limits || DEFAULT_RESOLUTION_LIMITS;
  return { min: limits.min_side ?? 256, max: allowLongWait ? (limits.extended_max_side ?? 2048) : (limits.standard_max_side ?? 1536) };
}
