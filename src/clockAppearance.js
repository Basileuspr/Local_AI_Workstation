import { appearanceThemes, codeFonts, interfaceFonts } from './appearance';

export const CLOCK_APPEARANCE_KEY = 'local-ai-workstation-clock-v1';
export const clockFonts = {
  inherit: { label: 'Match app font', family: 'var(--font-body)' },
  ...Object.fromEntries(Object.entries({ ...interfaceFonts, ...codeFonts }).map(([id, font]) =>
    [id, { ...font, label: font.label.replace(' (default)', '') }])),
};
export const clockThemes = { inherit: { label: 'Match app theme' }, ...appearanceThemes };
export const clockStyles = { plain: 'Plain', badge: 'Rounded badge', glow: 'Digital glow', terminal: 'Terminal' };
export const clockSizes = [12, 14, 16, 18, 20, 24];
export const defaultClockAppearance = {
  theme: 'inherit', font: 'inherit', style: 'plain', size: 12, bold: false,
  customColors: false, textColor: '#4fc3f7', backgroundColor: '#141c28',
  format: 'system', seconds: true, date: false,
};

const choice = (catalog, value, fallback) => typeof value === 'string' && Object.hasOwn(catalog, value) ? value : fallback;
const color = (value, fallback) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
export function normalizeClockAppearance(value) {
  const d = defaultClockAppearance;
  value = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    theme: choice(clockThemes, value.theme, d.theme), font: choice(clockFonts, value.font, d.font),
    style: choice(clockStyles, value.style, d.style), size: clockSizes.includes(value.size) ? value.size : d.size,
    bold: value.bold === true, customColors: value.customColors === true,
    textColor: color(value.textColor, d.textColor), backgroundColor: color(value.backgroundColor, d.backgroundColor),
    format: ['system', '12', '24'].includes(value.format) ? value.format : d.format,
    seconds: value.seconds !== false, date: value.date === true,
  };
}
export function loadClockAppearance(storage) {
  try { return normalizeClockAppearance(JSON.parse((storage ?? globalThis.localStorage)?.getItem(CLOCK_APPEARANCE_KEY) || 'null')); }
  catch { return { ...defaultClockAppearance }; }
}
export function saveClockAppearance(value, storage) {
  try { (storage ?? globalThis.localStorage)?.setItem(CLOCK_APPEARANCE_KEY, JSON.stringify(normalizeClockAppearance(value))); }
  catch { /* Styling remains usable when local preference storage is unavailable. */ }
}
export function clockAppearanceVariables(value) {
  const a = normalizeClockAppearance(value), palette = clockThemes[a.theme].colors;
  const plain = a.style === 'plain';
  return {
    '--clock-font': clockFonts[a.font].family, '--clock-size': `${a.size}px`, '--clock-weight': a.bold ? 700 : 400,
    '--clock-text': a.customColors ? a.textColor : palette?.accent || (plain ? 'var(--text-dim)' : 'var(--accent)'),
    '--clock-background': a.customColors ? a.backgroundColor : palette?.['bg-card'] || (plain ? 'transparent' : 'var(--bg-card)'),
    '--clock-border': palette?.['border-active'] || 'var(--border-active)',
  };
}
export function clockTimeOptions(value) {
  const a = normalizeClockAppearance(value);
  return { hour: a.format === '24' ? '2-digit' : 'numeric', minute: '2-digit', ...(a.seconds ? { second: '2-digit' } : {}),
    ...(a.format === 'system' ? {} : { hourCycle: a.format === '24' ? 'h23' : 'h12' }) };
}
