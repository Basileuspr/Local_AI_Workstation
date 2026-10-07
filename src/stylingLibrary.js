import { previewDocument } from './codePreview';

export const stylingCategories = ['Buttons', 'Forms', 'Layouts', 'Effects', 'Typography', 'Animations'];

// Authored, offline examples. Each snippet includes its own markup and styles.
export const stylingExamples = [
  {
    id: 'button-variants', category: 'Buttons', title: 'Button essentials',
    description: 'Primary, outline, and quiet actions with hover and keyboard focus states.',
    tags: ['primary', 'secondary', 'outline', 'focus', 'hover'],
    html: '<div class="actions">\n  <button class="primary" type="button">Get started</button>\n  <button class="outline" type="button">Explore</button>\n  <button class="quiet" type="button">Later</button>\n</div>',
    css: `.actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.actions button { padding: 10px 14px; border-radius: 8px; border: 1px solid transparent; cursor: pointer; transition: background .2s, transform .2s; }
.primary { background: var(--accent); color: var(--on-accent); font-weight: 650; }
.primary:hover { filter: brightness(1.1); transform: translateY(-2px); }
.outline { background: transparent; color: var(--accent); border-color: var(--accent) !important; }
.outline:hover { background: var(--surface); }
.quiet { background: transparent; color: var(--muted); }
.quiet:hover { color: var(--ink); }`,
  },
  {
    id: 'pill-buttons', category: 'Buttons', title: 'Pills & badges',
    description: 'Rounded filter buttons paired with small status and count badges.',
    tags: ['pill', 'rounded', 'badge', 'count', 'filter'],
    html: '<div class="pills">\n  <button class="pill active" type="button" aria-pressed="true">All <span>12</span></button>\n  <button class="pill" type="button">Saved <span>4</span></button>\n  <span class="badge">New</span>\n</div>',
    css: `.pills { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.pill { padding: 9px 13px; border: 1px solid var(--border); border-radius: 999px; color: var(--ink); background: var(--surface); cursor: pointer; }
.pill span { margin-left: 5px; color: var(--muted); }
.pill.active { border-color: var(--accent); color: var(--accent); }
.pill:hover { border-color: var(--accent); }
.badge { border-radius: 4px; background: var(--accent); color: var(--on-accent); font-size: 11px; font-weight: 650; padding: 4px 7px; }`,
  },
  {
    id: 'icon-button', category: 'Buttons', title: 'Icon with a label',
    description: 'An inline SVG icon and text stay aligned inside a compact action.',
    tags: ['svg', 'icon', 'alignment', 'download'],
    html: '<button class="icon-action" type="button">\n  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg>\n  Save example\n</button>',
    css: `.icon-action { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 16px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--ink); cursor: pointer; }
.icon-action svg { flex-shrink: 0; }
.icon-action:hover { color: var(--accent); border-color: var(--accent); }`,
  },
  {
    id: 'button-states', category: 'Buttons', title: 'Action states',
    description: 'A clear destructive action alongside a visibly unavailable button.',
    tags: ['danger', 'disabled', 'destructive', 'state'],
    html: '<div class="actions">\n  <button class="danger" type="button">Remove item</button>\n  <button class="unavailable" type="button" disabled>Unavailable</button>\n</div>',
    css: `.actions { display: flex; flex-wrap: wrap; gap: 10px; }
.actions button { padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border); }
.danger { color: #ffb9ba; background: #732833; border-color: #b34959 !important; cursor: pointer; }
.danger:hover { background: #903444; }
.unavailable:disabled { background: var(--surface); color: var(--muted); opacity: .45; cursor: not-allowed; }`,
  },
  {
    id: 'labeled-input', category: 'Forms', title: 'Labeled text field',
    description: 'A readable label, useful hint, and a focus ring around a text input.',
    tags: ['input', 'text', 'label', 'focus', 'accessible'],
    html: '<label class="field" for="display-name">\n  Display name\n  <input id="display-name" placeholder="Your name" aria-describedby="name-hint">\n  <small id="name-hint">How your name appears on your profile.</small>\n</label>',
    css: `.field { display: grid; gap: 8px; width: min(100%, 280px); font-weight: 600; }
.field input { width: 100%; border: 1px solid var(--border); border-radius: 8px; padding: 11px 12px; background: var(--surface); color: var(--ink); }
.field input::placeholder { color: var(--muted); }
.field input:focus { outline: 2px solid var(--accent); outline-offset: 2px; }
.field small { color: var(--muted); font-size: 11px; font-weight: 400; }`,
  },
  {
    id: 'select-checkbox', category: 'Forms', title: 'Select & checkbox',
    description: 'Native controls keep familiar keyboard behavior while matching the palette.',
    tags: ['select', 'dropdown', 'checkbox', 'native'],
    html: '<div class="form-stack">\n  <label>Theme <select><option>Midnight</option><option>Daylight</option><option>Forest</option></select></label>\n  <label class="check"><input type="checkbox" checked> Remember my choice</label>\n</div>',
    css: `.form-stack { display: grid; gap: 14px; width: min(100%, 260px); }
.form-stack label { display: grid; gap: 7px; }
.form-stack select { padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--ink); }
.form-stack .check { display: flex; gap: 8px; align-items: center; color: var(--muted); font-size: 12px; }
.check input { accent-color: var(--accent); width: 16px; height: 16px; }`,
  },
  {
    id: 'toggle-switch', category: 'Forms', title: 'CSS toggle switch',
    description: 'Click the label or press Space to change this styled checkbox.',
    tags: ['toggle', 'switch', 'checkbox', 'transition'],
    html: '<label class="toggle">\n  <input type="checkbox" checked>\n  <span class="track" aria-hidden="true"></span>\n  Enable notifications\n</label>',
    css: `.toggle { display: inline-flex; align-items: center; gap: 12px; position: relative; cursor: pointer; }
.toggle input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.track { width: 42px; height: 24px; flex-shrink: 0; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); transition: background .2s; }
.track::after { content: ''; display: block; width: 18px; height: 18px; margin: 2px; border-radius: 50%; background: var(--muted); transition: transform .2s; }
.toggle input:checked + .track { background: var(--accent); }
.toggle input:checked + .track::after { transform: translateX(18px); background: var(--on-accent); }
.toggle input:focus-visible + .track { outline: 2px solid var(--accent); outline-offset: 3px; }`,
  },
  {
    id: 'responsive-grid', category: 'Layouts', title: 'Responsive grid',
    description: 'Cards automatically wrap to fit the available width with CSS Grid.',
    tags: ['grid', 'responsive', 'cards', 'auto-fit'],
    html: '<div class="grid">\n  <article><strong>01</strong><span>Plan</span></article>\n  <article><strong>02</strong><span>Build</span></article>\n  <article><strong>03</strong><span>Review</span></article>\n</div>',
    css: `.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(90px, 100%), 1fr)); gap: 10px; width: 100%; }
.grid article { display: grid; gap: 12px; padding: 16px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.grid strong { color: var(--accent); font-size: 22px; }
.grid span { color: var(--muted); font-size: 12px; }`,
  },
  {
    id: 'flex-toolbar', category: 'Layouts', title: 'Wrapping toolbar',
    description: 'Flexbox keeps actions together and allows them to wrap on small screens.',
    tags: ['flex', 'flexbox', 'toolbar', 'responsive', 'wrap'],
    html: '<div class="toolbar">\n  <strong>My project</strong>\n  <div class="toolbar-actions"><button type="button">Preview</button><button type="button">Publish</button></div>\n</div>',
    css: `.toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; width: 100%; padding: 14px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.toolbar-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.toolbar button { border: 1px solid var(--border); border-radius: 6px; padding: 7px 10px; color: var(--ink); background: transparent; cursor: pointer; }
.toolbar button:last-child { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }`,
  },
  {
    id: 'feature-card', category: 'Layouts', title: 'Feature card',
    description: 'Padding, hierarchy, and a restrained border make a card easy to scan.',
    tags: ['card', 'spacing', 'hierarchy', 'border'],
    html: '<article class="feature">\n  <span class="eyebrow">WORKSPACE</span>\n  <h2>Make room for ideas.</h2>\n  <p>A small space for your next big project.</p>\n</article>',
    css: `.feature { width: min(100%, 300px); padding: 24px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
.eyebrow { font-size: 10px; letter-spacing: .15em; font-weight: 650; color: var(--accent); }
.feature h2 { margin: 10px 0 8px; font-size: 22px; line-height: 1.2; }
.feature p { margin: 0; line-height: 1.6; color: var(--muted); font-size: 12px; }`,
  },
  {
    id: 'gradient-card', category: 'Effects', title: 'Gradient accent',
    description: 'A two-color gradient gives a simple heading a distinct background.',
    tags: ['gradient', 'color', 'background'],
    html: '<section class="gradient-card">\n  <span>COLOR STUDY</span>\n  <h2>A fresh perspective.</h2>\n</section>',
    css: `.gradient-card { width: 100%; padding: 28px; border-radius: 16px; background: linear-gradient(135deg, #85e8ca, #8db9ff); color: #132e43; }
.gradient-card span { font-size: 10px; font-weight: 650; letter-spacing: .12em; }
.gradient-card h2 { font-size: 26px; line-height: 1.1; margin: 12px 0 0; max-width: 220px; }`,
  },
  {
    id: 'glass-card', category: 'Effects', title: 'Glass panel',
    description: 'A translucent panel blurs a colorful background beneath it.',
    tags: ['glass', 'blur', 'backdrop-filter', 'transparency'],
    html: '<div class="glass-stage">\n  <article class="glass"><strong>A softer layer.</strong><p>Blur, light, and a translucent surface.</p></article>\n</div>',
    css: `.glass-stage { width: 100%; padding: 24px; border-radius: 14px; background: radial-gradient(circle at 10% 20%, #386de0, transparent 65%), radial-gradient(circle at 90% 80%, #813bb6, transparent 60%), #142441; }
.glass { padding: 22px; border-radius: 12px; border: 1px solid #ffffff38; background: #ffffff18; backdrop-filter: blur(12px); color: #f1f5ff; }
.glass p { margin: 8px 0 0; color: #d4deef; font-size: 12px; line-height: 1.5; }`,
  },
  {
    id: 'hover-lift', category: 'Effects', title: 'Hover lift',
    description: 'Hover or focus the card to see a small lift and a softer shadow.',
    tags: ['hover', 'transition', 'transform', 'shadow', 'focus'],
    html: '<button class="lift" type="button">\n  <span class="mark">↗</span>\n  <strong>Explore something new</strong>\n  <span class="hint">Hover or focus this card</span>\n</button>',
    css: `.lift { display: grid; gap: 9px; width: min(100%, 280px); padding: 22px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); color: var(--ink); text-align: left; cursor: pointer; transition: transform .2s, box-shadow .2s, border-color .2s; }
.lift:hover, .lift:focus-visible { transform: translateY(-5px); box-shadow: 0 16px 32px #0004; border-color: var(--accent); }
.mark { color: var(--accent); font-size: 24px; }
.hint { color: var(--muted); font-size: 11px; }`,
  },
  {
    id: 'type-hierarchy', category: 'Typography', title: 'Type hierarchy',
    description: 'An eyebrow, heading, and body text give each line a clear purpose.',
    tags: ['font', 'type', 'heading', 'text', 'spacing'],
    html: '<article class="type-sample">\n  <span class="eyebrow">A SMALL BEGINNING</span>\n  <h2>Ideas take shape.</h2>\n  <p>Use a clear heading and give the supporting text room to breathe.</p>\n</article>',
    css: `.type-sample { max-width: 300px; }
.eyebrow { font-size: 10px; letter-spacing: .14em; font-weight: 650; color: var(--accent); }
.type-sample h2 { font-size: clamp(24px, 8vw, 34px); line-height: 1.08; letter-spacing: -.04em; margin: 10px 0; }
.type-sample p { margin: 0; font-size: 12px; line-height: 1.7; color: var(--muted); }`,
  },
  {
    id: 'code-block', category: 'Typography', title: 'Code & inline labels',
    description: 'Monospace type and an inset panel make a small code sample readable.',
    tags: ['code', 'monospace', 'pre', 'snippet'],
    html: '<div class="code-sample">\n  <p>Adjust the <code>border-radius</code> value.</p>\n  <pre><code>.card {\n  border-radius: 12px;\n  padding: 24px;\n}</code></pre>\n</div>',
    css: `.code-sample { width: 100%; font-size: 12px; }
.code-sample p { color: var(--muted); line-height: 1.6; }
.code-sample code { font-family: ui-monospace, Consolas, monospace; color: var(--accent); }
.code-sample p code { padding: 2px 4px; border-radius: 4px; background: var(--surface); }
.code-sample pre { padding: 16px; margin: 12px 0 0; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); overflow: auto; line-height: 1.7; }`,
  },
  {
    id: 'fade-in', category: 'Animations', title: 'Fade & rise',
    description: 'Opacity and a short upward movement introduce a card smoothly.',
    tags: ['animation', 'keyframes', 'fade', 'slide', 'opacity'],
    html: '<article class="reveal"><span>✦</span><strong>Here comes an idea.</strong><p>A gentle entrance animation.</p></article>',
    css: `.reveal { width: min(100%, 280px); padding: 22px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); animation: reveal 2.8s ease-in-out infinite; }
.reveal span { display: block; color: var(--accent); font-size: 22px; margin-bottom: 10px; }
.reveal p { color: var(--muted); margin: 8px 0 0; font-size: 12px; }
@keyframes reveal { 0%, 100% { opacity: .35; transform: translateY(12px); } 35%, 75% { opacity: 1; transform: translateY(0); } }`,
  },
  {
    id: 'loading-spinner', category: 'Animations', title: 'Loading spinner',
    description: 'A colored border rotates around a circle using one keyframe.',
    tags: ['animation', 'loading', 'spinner', 'rotate', 'keyframes'],
    html: '<div class="loading" role="status">\n  <span class="spinner" aria-hidden="true"></span>\n  Preparing your workspace…\n</div>',
    css: `.loading { display: grid; justify-items: center; gap: 18px; color: var(--muted); font-size: 12px; text-align: center; }
.spinner { width: 38px; height: 38px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }`,
  },
  {
    id: 'pulse-status', category: 'Animations', title: 'Pulsing status',
    description: 'An expanding ring draws gentle attention to an active status.',
    tags: ['animation', 'pulse', 'status', 'ring', 'keyframes'],
    html: '<div class="status"><span class="dot" aria-hidden="true"></span> Workspace is ready</div>',
    css: `.status { display: flex; align-items: center; gap: 14px; font-size: 13px; }
.dot { width: 10px; height: 10px; flex-shrink: 0; border-radius: 50%; background: var(--accent); animation: pulse 2s ease-out infinite; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 #78dfc780; } 100% { box-shadow: 0 0 0 12px #78dfc700; } }`,
  },
  {
    id: 'bouncing-dots', category: 'Animations', title: 'Bouncing dots',
    description: 'Small animation delays create a sequence from three identical dots.',
    tags: ['animation', 'loading', 'dots', 'delay', 'stagger'],
    html: '<div class="dots" role="status" aria-label="Loading">\n  <span></span><span></span><span></span>\n</div>',
    css: `.dots { display: flex; align-items: center; gap: 8px; min-height: 40px; }
.dots span { width: 10px; height: 10px; background: var(--accent); border-radius: 50%; animation: bounce 1.2s ease-in-out infinite; }
.dots span:nth-child(2) { animation-delay: .15s; }
.dots span:nth-child(3) { animation-delay: .3s; }
@keyframes bounce { 0%, 80%, 100% { transform: translateY(0); opacity: .5; } 40% { transform: translateY(-12px); opacity: 1; } }`,
  },
  {
    id: 'progress-sweep', category: 'Animations', title: 'Progress sweep',
    description: 'A moving bar suggests an activity whose completion time is unknown.',
    tags: ['animation', 'progress', 'loading', 'transform'],
    html: '<div class="progress-demo" role="status">\n  <span>Working on your next idea…</span>\n  <div class="progress" aria-hidden="true"><span></span></div>\n</div>',
    css: `.progress-demo { display: grid; gap: 14px; width: min(100%, 280px); color: var(--muted); font-size: 12px; }
.progress { height: 6px; overflow: hidden; border-radius: 999px; background: var(--border); }
.progress span { display: block; width: 40%; height: 100%; background: var(--accent); border-radius: inherit; animation: sweep 1.8s ease-in-out infinite; }
@keyframes sweep { from { transform: translateX(-100%); } to { transform: translateX(350%); } }`,
  },
];

export function filterStylingExamples({ query = '', category = 'All' } = {}) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return stylingExamples.filter(example => (category === 'All' || example.category === category)
    && terms.every(term => `${example.title} ${example.category} ${example.description} ${example.tags.join(' ')}`.toLocaleLowerCase().includes(term)));
}

export function stylingExampleCSS(example, theme = 'dark') {
  const colors = theme === 'light'
    ? 'color-scheme: light; --bg: #edf3f9; --ink: #172638; --muted: #52657a; --surface: #fff; --border: #c5d2df; --accent: #138369; --on-accent: #fff;'
    : 'color-scheme: dark; --bg: #101926; --ink: #e5edf8; --muted: #a0b1c7; --surface: #192637; --border: #34465d; --accent: #85e8ca; --on-accent: #092d29;';
  return `/* Preview palette and shared base styles. */
:root { ${colors} }
* { box-sizing: border-box; }
body { margin: 0; padding: 20px; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--ink); font: 14px system-ui, sans-serif; }
button, input, select { font: inherit; }
button:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

/* ${example.title} */
${example.css}

/* Honor the device's reduced-motion preference. */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}`;
}

export function stylingExampleDocument(example, { theme = 'dark', motion = true } = {}) {
  const pause = motion ? '' : '\n*, *::before, *::after { animation-play-state: paused !important; transition: none !important; }';
  const title = example.title.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  return previewDocument(example.html, stylingExampleCSS(example, theme) + pause)
    .replace('<html>', '<html lang="en">')
    .replace('<meta charset="utf-8">', `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>`);
}
