// Local fonts and complete palettes; no font downloads or arbitrary CSS.
export const interfaceFonts = {
  segoe: { label: "Segoe UI (default)", family: "'Segoe UI', system-ui, sans-serif" },
  system: { label: "System font", family: "system-ui, sans-serif" },
  arial: { label: "Arial", family: "Arial, Helvetica, sans-serif" },
  calibri: { label: "Calibri", family: "Calibri, 'Segoe UI', sans-serif" },
  verdana: { label: "Verdana", family: "Verdana, Geneva, sans-serif" },
  georgia: { label: "Georgia", family: "Georgia, 'Times New Roman', serif" },
};
export const codeFonts = {
  consolas: { label: "Consolas (default)", family: "'Consolas', 'Cascadia Mono', monospace" },
  cascadia: { label: "Cascadia Mono", family: "'Cascadia Mono', 'Consolas', monospace" },
  courier: { label: "Courier New", family: "'Courier New', Courier, monospace" },
};

const dark = {
  "bg-primary": "#080c14", "bg-surface": "#0e1420", "bg-card": "#141c28", "bg-input": "#111923", "bg-sidebar": "#0b1018",
  border: "#1e2d3d", "border-active": "#2e4a62", accent: "#4fc3f7", "accent-dim": "#14303f",
  green: "#66bb6a", "green-dim": "#122a1a", red: "#ef5350", yellow: "#f6c453", orange: "#ffb74d", "orange-dim": "#2a1f0e",
  text: "#d8dee6", "text-dim": "#97a9ba", "text-muted": "#91a4b6", "user-bubble": "#162236", "user-border": "#1e3450",
};
export const appearanceThemes = {
  midnight: { label: "Midnight", scheme: "dark", colors: dark },
  slate: { label: "Slate", scheme: "dark", colors: { ...dark, "bg-primary": "#14161a", "bg-surface": "#1b1e24", "bg-card": "#23272f", "bg-input": "#1c2027", "bg-sidebar": "#171a20", border: "#383e49", "border-active": "#626d7f", accent: "#a8c7fa", "accent-dim": "#29394f", "user-bubble": "#283342", "user-border": "#4b5d75", "text-dim": "#adb6c4", "text-muted": "#a2adbd" } },
  forest: { label: "Forest", scheme: "dark", colors: { ...dark, "bg-primary": "#0b1411", "bg-surface": "#101d18", "bg-card": "#172820", "bg-input": "#14221b", "bg-sidebar": "#0d1914", border: "#294637", "border-active": "#456c56", accent: "#8bd5a6", "accent-dim": "#244333", "user-bubble": "#1b3529", "user-border": "#3e624c", text: "#deebe3", "text-dim": "#a0b9a9", "text-muted": "#99b2a2" } },
  plum: { label: "Plum", scheme: "dark", colors: { ...dark, "bg-primary": "#140f1c", "bg-surface": "#1c1527", "bg-card": "#271e35", "bg-input": "#21192e", "bg-sidebar": "#181120", border: "#423153", "border-active": "#69547e", accent: "#d3a6f5", "accent-dim": "#493156", "user-bubble": "#362443", "user-border": "#674778", text: "#ebe0f3", "text-dim": "#baa7cb", "text-muted": "#b4a1c5" } },
  paper: { label: "Paper (light)", scheme: "light", colors: {
    "bg-primary": "#f7f8fb", "bg-surface": "#ffffff", "bg-card": "#eef1f6", "bg-input": "#ffffff", "bg-sidebar": "#e9edf4",
    border: "#c3cad6", "border-active": "#8997ad", accent: "#1256a1", "accent-dim": "#dce9fa",
    green: "#216a35", "green-dim": "#e0f0e4", red: "#b42323", yellow: "#725200", orange: "#874500", "orange-dim": "#fff0dc",
    text: "#202b3b", "text-dim": "#4d5c70", "text-muted": "#526176", "user-bubble": "#e1ebfa", "user-border": "#b3c9e8",
  } },
  contrast: { label: "High contrast", scheme: "dark", colors: {
    "bg-primary": "#000000", "bg-surface": "#080808", "bg-card": "#111111", "bg-input": "#000000", "bg-sidebar": "#000000",
    border: "#8c8c8c", "border-active": "#ffffff", accent: "#ffe066", "accent-dim": "#302900",
    green: "#96ffae", "green-dim": "#052610", red: "#ff9797", yellow: "#ffe066", orange: "#ffc58a", "orange-dim": "#33200b",
    text: "#ffffff", "text-dim": "#e6e6e6", "text-muted": "#d4d4d4", "user-bubble": "#161616", "user-border": "#aaaaaa",
  } },
};
export const uiContrastRange = { min: 75, max: 150, step: 5, default: 100 };
export const defaultAppearance = { theme: "midnight", font: "segoe", codeFont: "consolas", contrast: uiContrastRange.default };
const validKey = (catalog, value, fallback) => typeof value === "string" && Object.hasOwn(catalog, value) ? value : fallback;
export function normalizeAppearance(value) {
  value = value && typeof value === "object" ? value : {};
  return {
    theme: validKey(appearanceThemes, value.theme, defaultAppearance.theme),
    font: validKey(interfaceFonts, value.font, defaultAppearance.font),
    codeFont: validKey(codeFonts, value.codeFont, defaultAppearance.codeFont),
    contrast: typeof value.contrast === "number" && Number.isFinite(value.contrast)
      ? Math.max(uiContrastRange.min, Math.min(uiContrastRange.max, Math.round(value.contrast / uiContrastRange.step) * uiContrastRange.step))
      : defaultAppearance.contrast,
  };
}

const rgb = color => color.slice(1).match(/../g).map(channel => parseInt(channel, 16));
function mixColor(from, to, amount) {
  const target = rgb(to);
  return "#" + rgb(from).map((channel, index) => Math.round(channel + (target[index] - channel) * amount).toString(16).padStart(2, "0")).join("");
}
function luminance(color) {
  const channels = rgb(color).map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
function readableText(candidate, original, surfaces) {
  const readable = color => surfaces.every(surface => {
    const light = luminance(color), background = luminance(surface);
    return (Math.max(light, background) + .05) / (Math.min(light, background) + .05) >= 4.5;
  });
  if (readable(candidate)) return candidate;
  // Allow softer text while retaining legibility on all of the theme's surfaces.
  let low = 0, high = 1;
  for (let iteration = 0; iteration < 12; iteration++) {
    const amount = (low + high) / 2;
    if (readable(mixColor(candidate, original, amount))) high = amount; else low = amount;
  }
  return mixColor(candidate, original, high);
}

export function appearanceColors(value) {
  const appearance = normalizeAppearance(value), theme = appearanceThemes[appearance.theme];
  const colors = { ...theme.colors };
  if (appearance.contrast === uiContrastRange.default) return colors;
  const stronger = appearance.contrast > uiContrastRange.default;
  const amount = stronger ? (appearance.contrast - 100) / 50 : (100 - appearance.contrast) / 25;
  const target = stronger ? (theme.scheme === "dark" ? "#ffffff" : "#000000") : colors["bg-primary"];
  const surfaces = ["bg-primary", "bg-surface", "bg-card", "bg-input", "bg-sidebar", "user-bubble"].map(key => colors[key]);
  for (const key of ["text", "text-dim", "text-muted"]) {
    const mixed = mixColor(colors[key], target, amount * (stronger ? .45 : .16));
    colors[key] = stronger ? mixed : readableText(mixed, colors[key], surfaces);
  }
  for (const key of ["border", "border-active", "user-border"])
    colors[key] = mixColor(colors[key], target, amount * (stronger ? .6 : .3));
  for (const key of ["accent", "green", "red", "yellow", "orange"])
    colors[key] = mixColor(colors[key], target, amount * (stronger ? .2 : .12));
  return colors;
}

export function applyAppearance(value, root = document.documentElement) {
  const appearance = normalizeAppearance(value), theme = appearanceThemes[appearance.theme];
  root.dataset.theme = appearance.theme;
  root.dataset.uiContrast = String(appearance.contrast);
  root.style.colorScheme = theme.scheme;
  // Change UI palette tokens rather than filtering the window or its media.
  for (const [key, color] of Object.entries(appearanceColors(appearance))) root.style.setProperty(`--${key}`, color);
  root.style.setProperty("--font-body", interfaceFonts[appearance.font].family);
  root.style.setProperty("--font-mono", codeFonts[appearance.codeFont].family);
}
