import { seedMax } from "./imageSettingsControls";

export function hasImageSeed(seed) {
  return Number.isInteger(seed) && seed >= 0 && seed <= seedMax;
}
