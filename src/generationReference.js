import { MAX_IMAGE_STEPS } from './imageGenerationLimits';

export const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
export const REFERENCE_FIELDS = {appearance: 'Face and appearance', style: 'Style and palette', composition: 'Composition and pose', lighting: 'Lighting'};

export async function readReferenceImage(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a PNG, JPEG, or WebP image.');
  }
  if (!file.size || file.size > MAX_REFERENCE_BYTES) throw new Error('Choose an image up to 20 MiB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('This image could not be opened.'));
      image.src = url;
    });
    if (image.naturalWidth * image.naturalHeight > 24_000_000) throw new Error('Choose an image up to 24 megapixels.');
    return { file, url, width: image.naturalWidth, height: image.naturalHeight };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

export function referenceOptions(reference, strength, fit, steps) {
  if (!reference) return {};
  const amount = Number(strength);
  if (!Number.isFinite(amount) || amount < .05 || amount > 1) throw new Error('Change amount must be between 5% and 100%.');
  if (Math.floor(Number(steps) * amount) < 1) throw new Error('Increase Steps or Change amount to allow at least one image-to-image step.');
  if (!['contain', 'crop', 'edge'].includes(fit)) throw new Error('Choose how the reference fits the output.');
  return { strength: amount, source_fit: fit };
}

export const REFERENCE_PRESETS = [
  { id: 'likeness', label: 'Keep appearance', strength: .25, steps: 80, guidanceScale: 4.5 },
  { id: 'balanced', label: 'Balanced emulation', strength: .4, steps: 50, guidanceScale: 5.5 },
  { id: 'reinterpret', label: 'Reinterpret style', strength: .6, steps: 40, guidanceScale: 6 },
];

export function refinementSteps(strength, target = 20) {
  if (!Number.isFinite(strength) || strength < .05 || strength > 1) throw new Error('Choose a valid change amount.');
  target = Math.min(target, Math.floor(MAX_IMAGE_STEPS * strength));
  let steps = Math.ceil(target / strength);
  // Floating point rounding must not remove the final requested denoising step.
  while (Math.floor(steps * strength) < target) steps++;
  return steps;
}

export function referenceComparison(settings, strength) {
  referenceOptions({}, strength, 'edge', settings.steps);
  const seed = settings.seed === '' || settings.seed == null
    ? crypto.getRandomValues(new Uint32Array(1))[0] % 2147483648 : Number(settings.seed);
  const target = Math.max(20, Math.floor(Number(settings.steps) * strength));
  // Keep a bounded schedule, including for extreme user settings.
  const amounts = [...new Set([strength - .1, strength, strength + .1].map(value => Math.round(Math.max(.05, Math.min(1, value)) * 100) / 100))];
  const budget = Math.min(target, Math.floor(MAX_IMAGE_STEPS * Math.min(...amounts)));
  return amounts.map(amount => ({label: `Change ${Math.round(amount * 100)}% · seed ${seed}`,
    referenceStrength: amount, settings: {...settings, seed, steps: refinementSteps(amount, budget)}}));
}

export function appendReferencePrompt(prompt, analysis, selected) {
  const details = ['appearance', 'style', 'composition', 'lighting'].filter(key => selected.includes(key))
    .map(key => analysis[key]?.trim()).filter(Boolean);
  const addition = details.join(', ');
  if (!addition) throw new Error('Select at least one non-empty reference detail.');
  const current = (prompt || '').trim();
  const next = current.includes(addition) ? current : [current, addition].filter(Boolean).join('\n');
  if (next.length > 12000) throw new Error('Shorten the prompt or reference details to stay within 12,000 characters.');
  return next;
}
