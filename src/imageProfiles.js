import { defaultImageSettings } from './preferences';

export const imageProfileFields = ['prompt', 'negativePrompt', 'steps', 'guidanceScale', 'seed'];

export function imageProfileSettings(settings = {}) {
  return Object.fromEntries(imageProfileFields.map(key => [key, settings[key] ?? defaultImageSettings[key]]));
}

export function imageProfileChanged(profile, settings) {
  return !!profile && imageProfileFields.some(key => imageProfileSettings(profile.imageSettings)[key] !== imageProfileSettings(settings)[key]);
}
