import { appearanceThemes, appearanceVariables, defaultAppearance, normalizeAppearance } from './appearance';
import { previewDocument } from './codePreview';
import { stylingExamples, stylingExampleCSS } from './stylingLibrary';

export const DESIGN_DRAFT_KEY = 'local-ai-workstation-design-draft-v1';
export const DESIGN_PRESETS_KEY = 'local-ai-workstation-design-presets-v1';
export const designLayouts = { studio: 'Generation studio', dashboard: 'Dashboard cards', chat: 'Chat workspace' };
export const designWidths = { fluid: 'Fill space', tablet: 'Tablet · 768 px', phone: 'Phone · 390 px' };
export const designTemplates = [
  { id: 'studio', name: 'Studio', description: 'Soft violet, generous spacing.', appearance: { theme: 'slate', accent: 'violet', corners: 'soft', density: 'comfortable', surface: 'elevated', buttons: 'solid' } },
  { id: 'blueprint', name: 'Blueprint', description: 'Precise edges, cyan details.', appearance: { theme: 'midnight', accent: 'cyan', corners: 'sharp', density: 'compact', surface: 'outlined', buttons: 'outline' } },
  { id: 'paper', name: 'Paper', description: 'Light surfaces, quiet outlines.', appearance: { theme: 'paper', corners: 'rounded', density: 'comfortable', surface: 'outlined', buttons: 'soft' } },
  { id: 'forest', name: 'Forest', description: 'Green accents, flat panels.', appearance: { theme: 'forest', accent: 'green', corners: 'rounded', density: 'comfortable', surface: 'flat', buttons: 'soft' } },
  { id: 'editorial', name: 'Editorial', description: 'Plum and rose, serif type.', appearance: { theme: 'plum', accent: 'rose', font: 'georgia', corners: 'sharp', density: 'comfortable', surface: 'flat', buttons: 'solid' } },
  { id: 'contrast', name: 'High contrast', description: 'Clear boundaries, amber focus.', appearance: { theme: 'contrast', corners: 'sharp', density: 'compact', surface: 'outlined', buttons: 'outline', motion: 'reduced' } },
];
const choice = (catalog, value, fallback) => typeof value === 'string' && Object.hasOwn(catalog, value) ? value : fallback;
export function normalizeDesign(value, fallbackAppearance = defaultAppearance) {
  return {
    appearance: normalizeAppearance(value?.appearance ?? fallbackAppearance),
    layout: choice(designLayouts, value?.layout, 'studio'),
    width: choice(designWidths, value?.width, 'fluid'),
    pieces: Array.isArray(value?.pieces)
      ? [...new Set(value.pieces.filter(id => stylingExamples.some(example => example.id === id)))].slice(0, stylingExamples.length)
      : ['button-variants', 'labeled-input', 'feature-card'],
  };
}
export function loadDesign(appearance, storage = globalThis.localStorage) {
  try { return normalizeDesign(JSON.parse(storage?.getItem(DESIGN_DRAFT_KEY) || 'null'), appearance); }
  catch { return normalizeDesign(null, appearance); }
}
export function loadDesignPresets(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(DESIGN_PRESETS_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter(item => typeof item?.name === 'string' && item.name.trim()).slice(0, 30)
      .map(item => ({ name: item.name.trim().slice(0, 60), design: normalizeDesign(item.design) })) : [];
  } catch { return []; }
}
export function serializeDesign(design) { return JSON.stringify({ format: 'local-ai-workstation-design', version: 1, design: normalizeDesign(design) }, null, 2); }
export function parseDesign(text) {
  if (text.length > 100000) throw new Error('Choose a design file under 100 KB.');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('This file is not valid JSON.'); }
  if (value?.format !== 'local-ai-workstation-design' || value.version !== 1 || !value.design?.appearance || typeof value.design.appearance !== 'object')
    throw new Error('Choose a version 1 Local AI Workstation design file.');
  return normalizeDesign(value.design);
}

export function designCSS(value) {
  const { appearance } = normalizeDesign(value), tokens = appearanceVariables(appearance);
  const primary = appearance.buttons === 'outline' ? 'transparent' : appearance.buttons === 'soft' ? 'var(--accent-dim)' : 'var(--accent)';
  const primaryText = ['outline', 'soft'].includes(appearance.buttons) ? 'var(--accent)' : 'var(--on-accent)';
  return `/* Local AI Workstation · UI Playground */
:root { color-scheme: ${appearanceThemes[appearance.theme].scheme};
${Object.entries(tokens).map(([key, value]) => `  ${key}: ${value};`).join('\n')}
}
* { box-sizing: border-box; }
body { margin: 0; padding: var(--ui-space); background: var(--bg-primary); color: var(--text); font: 14px/1.5 var(--font-body); }
h1, h2, h3, p { margin: 0; } h1 { font-size: 21px; letter-spacing: -.025em; } h2 { font-size: 17px; } h3 { font-size: 14px; }
button, input, select, textarea { font: inherit; }
button, input:not([type=range]):not([type=checkbox]), select, textarea { border: 1px solid var(--border-active); border-radius: var(--ui-radius); padding: var(--ui-control-y) 12px; background: var(--bg-input); color: var(--text); max-width: 100%; }
button { cursor: pointer; } button:hover { border-color: var(--accent); } button:active { transform: translateY(1px); }
button.primary { background: ${primary}; color: ${primaryText}; border-color: var(--accent); }
button:disabled { opacity: .5; cursor: default; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
input, textarea, select { min-width: 0; } input[type=range] { width: 100%; } input { accent-color: var(--accent); }
label { display: grid; gap: 7px; color: var(--text-dim); font-size: 12px; } label.check { display: flex; align-items: center; }
.workspace { display: grid; gap: var(--ui-space); max-width: 1100px; margin: auto; }
.topbar, .row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.brand { display: flex; align-items: center; gap: 9px; font-weight: 650; } .mark { color: var(--accent); font-size: 23px; }
.badge { padding: 5px 10px; background: var(--accent-dim); color: var(--accent); border-radius: 30px; font-size: 11px; }
.card { display: grid; gap: var(--ui-space); padding: var(--ui-space); border: 1px solid ${appearance.surface === 'flat' ? 'transparent' : appearance.surface === 'outlined' ? 'var(--border-active)' : 'var(--border)'}; border-radius: var(--ui-radius); background: ${appearance.surface === 'outlined' ? 'var(--bg-primary)' : 'var(--bg-card)'}; box-shadow: var(--ui-card-shadow); }
.muted { color: var(--text-dim); font-size: 12px; } .eyebrow { color: var(--accent); font: 10px var(--font-mono); letter-spacing: .1em; }
.fields, .metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--ui-space); } .metrics strong { font-size: 28px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.message { padding: var(--ui-space); border-radius: var(--ui-radius); border: 1px solid var(--user-border); background: var(--user-bubble); }
code { font-family: var(--font-mono); color: var(--accent); } .swatches { display: flex; gap: 6px; } .swatches span { width: 24px; height: 24px; border: 1px solid var(--border); border-radius: 50%; }
@media (max-width: 460px) { .fields, .metrics { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
${appearance.motion === 'reduced' ? '* { animation: none !important; transition: none !important; }' : ''}`;
}

export function designHTML(value) {
  const { layout } = normalizeDesign(value);
  const head = '<header class="topbar"><div class="brand"><span class="mark" aria-hidden="true">◈</span> AI Workstation</div><span class="badge">Interactive preview</span></header>';
  const studio = `<section class="card"><div class="row"><div><p class="eyebrow">CREATE SOMETHING NEW</p><h1>Generation Studio</h1></div><span class="badge">Model ready</span></div>
<div><h3>Image Generation</h3><p class="muted">SDXL · 1024 × 1024</p></div>
<label>Prompt<textarea rows="2" placeholder="A quiet studio in the afternoon light…"></textarea></label>
<div class="fields"><label>Style<select><option>Cinematic</option><option>Illustration</option><option>Photographic</option></select></label><label>Guidance scale<input type="range" min="1" max="15" step=".5" value="7.5" aria-label="Preview guidance scale"></label></div>
<div class="row"><label class="check"><input type="checkbox" checked> Keep seed</label><div class="actions"><button type="button">Secondary</button><button type="button" class="primary">✧ Generate</button></div></div></section>`;
  const dashboard = `<section class="card"><p class="eyebrow">YOUR WORKSTATION</p><h1>Good afternoon.</h1><p class="muted">A place for your next idea.</p></section><div class="metrics"><section class="card"><span class="muted">Projects</span><strong>12</strong><span class="badge">3 in progress</span></section><section class="card"><span class="muted">Library</span><strong>248</strong><span class="muted">Ready to explore</span></section></div><section class="card"><div class="row"><h2>Recent work</h2><button class="primary">New project</button></div><div class="row"><span>Visual exploration</span><span class="badge">Draft</span></div><div class="row"><span>Interface concepts</span><button>Open</button></div></section>`;
  const chat = `<section class="card"><div class="row"><h1>A conversation starts here</h1><span class="badge">Local model</span></div><div class="message">Help me design a calmer workspace.</div><p>Start with a clear hierarchy, a restrained accent, and enough space between controls.</p><code>const idea = "Make room to create";</code><label>Your message<textarea rows="3" placeholder="Explore another idea…"></textarea></label><div class="actions"><button>Attach</button><button class="primary">Send message</button></div></section>`;
  return `<main class="workspace">${head}${{ studio, dashboard, chat }[layout]}<footer class="row"><span class="muted">Sample controls · no model request</span><div class="swatches" aria-label="Palette">${['accent', 'bg-card', 'text', 'green'].map(key => `<span style="background:var(--${key})"></span>`).join('')}</div></footer></main>`;
}

export function designDocument(value) {
  return previewDocument(designHTML(value), designCSS(value)).replace('<html>', '<html lang="en">')
    .replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Workstation design preview</title>');
}

export function designExampleCSS(example, value) {
  const { appearance } = normalizeDesign(value);
  return `${stylingExampleCSS(example, appearanceThemes[appearance.theme].scheme)}
${designCSS(value)}
:root { --bg: var(--bg-primary); --ink: var(--text); --muted: var(--text-dim); --surface: var(--bg-card); }
body { display: grid; place-items: center; min-height: 100vh; }
${appearance.corners !== 'default' ? 'button, input:not([type=checkbox]), select, .card { border-radius: var(--ui-radius); }' : ''}`;
}
