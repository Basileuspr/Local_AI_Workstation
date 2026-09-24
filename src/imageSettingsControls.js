// SDXL-sized presets within the local API's 512–1536, multiple-of-eight limits.
export const imageSizes = [
  { label: "Small square · 1:1", width: 512, height: 512 },
  { label: "Medium square · 1:1", width: 768, height: 768 },
  { label: "Square · 1:1", width: 1024, height: 1024 },
  { label: "Landscape · 4:3", width: 1152, height: 864 },
  { label: "Landscape · 3:2", width: 1152, height: 768 },
  { label: "Landscape · 16:9", width: 1280, height: 720 },
  { label: "Portrait · 3:4", width: 864, height: 1152 },
  { label: "Portrait · 2:3", width: 768, height: 1152 },
  { label: "Portrait · 9:16", width: 720, height: 1280 },
];
export const seedMax = 2147483647;
export function adjustNumber(value, delta, min, max) {
  const base = Number(value);
  return Math.min(max, Math.max(min, Math.round(((Number.isFinite(base) ? base : min) + delta) * 100) / 100));
}
