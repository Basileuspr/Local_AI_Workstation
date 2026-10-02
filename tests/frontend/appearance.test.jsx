import { afterEach, describe, expect, it, vi } from "vitest";
import { appearanceColors, appearanceThemes, applyAppearance, defaultAppearance, normalizeAppearance } from "../../src/appearance";
import { clearPreferences, loadPreferences, pickPreferences, savePreferences } from "../../src/preferences";
import { reducer } from "../../src/useStore";

afterEach(() => vi.unstubAllGlobals());
function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
function contrast(a, b) { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return (values[0] + .05) / (values[1] + .05); }

describe("application appearance", () => {
  it.each([null, "invalid", { theme: "removed", font: "url(remote-font)", codeFont: "__proto__" }])("falls back safely for obsolete or invalid preferences: %j", value => {
    expect(normalizeAppearance(value)).toEqual(defaultAppearance);
  });
  it("persists independent font and theme choices and resets only appearance", () => {
    const values = new Map();
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    vi.stubGlobal("window", { localStorage: storage }); vi.stubGlobal("localStorage", storage);
    const state = { appearance: defaultAppearance, selectedModel: "existing-model", conversationHistory: [{ content: "Keep this" }] };
    const updated = reducer(state, { type: "SET_APPEARANCE", payload: { theme: "paper", font: "georgia", codeFont: "courier", contrast: 125 } });
    savePreferences(pickPreferences(updated));
    expect(loadPreferences().appearance).toEqual({ theme: "paper", font: "georgia", codeFont: "courier", contrast: 125 });
    const contrastReset = reducer(updated, { type: "SET_APPEARANCE", payload: { contrast: 100 } });
    expect(contrastReset.appearance).toEqual({ theme: "paper", font: "georgia", codeFont: "courier", contrast: 100 });
    const reset = reducer(updated, { type: "RESET_APPEARANCE" });
    expect(reset.appearance).toEqual(defaultAppearance);
    expect(reset.selectedModel).toBe("existing-model");
    expect(reset.conversationHistory).toBe(state.conversationHistory);
    clearPreferences();
    expect(loadPreferences().appearance).toEqual(defaultAppearance);
  });
  it("defaults older preferences and bounds invalid contrast values", () => {
    expect(normalizeAppearance({ theme: "paper", font: "georgia" })).toMatchObject({ theme: "paper", font: "georgia", contrast: 100 });
    for (const value of [NaN, Infinity, "150", null]) expect(normalizeAppearance({ contrast: value }).contrast).toBe(100);
    expect(normalizeAppearance({ contrast: -20 }).contrast).toBe(75);
    expect(normalizeAppearance({ contrast: 900 }).contrast).toBe(150);
    expect(normalizeAppearance({ contrast: 123 }).contrast).toBe(125);
  });
  it.each(Object.entries(appearanceThemes))("%s adjusts contrast independently while keeping text readable", (id, theme) => {
    expect(appearanceColors({ theme: id, contrast: 100 })).toEqual(theme.colors);
    const softer = appearanceColors({ theme: id, contrast: 75 });
    const stronger = appearanceColors({ theme: id, contrast: 150 });
    expect(contrast(softer.border, theme.colors["bg-primary"])).toBeLessThan(contrast(theme.colors.border, theme.colors["bg-primary"]));
    expect(contrast(stronger.border, theme.colors["bg-primary"])).toBeGreaterThan(contrast(theme.colors.border, theme.colors["bg-primary"]));
    for (let level = 75; level <= 150; level += 5) {
      const colors = appearanceColors({ theme: id, contrast: level });
      for (const surface of ["bg-primary", "bg-surface", "bg-card", "bg-input", "bg-sidebar", "user-bubble"]) {
        expect(colors[surface]).toBe(theme.colors[surface]);
        for (const text of ["text", "text-dim", "text-muted"]) expect(contrast(colors[text], colors[surface])).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(appearanceThemes[id].colors).toEqual(appearanceColors({ theme: id, contrast: 100 }));
  });
  it("applies palette tokens without filtering the UI or changing fonts", () => {
    const values = new Map(), root = { dataset: {}, style: { setProperty: (key, value) => values.set(key, value) } };
    applyAppearance({ theme: "paper", font: "georgia", codeFont: "courier", contrast: 140 }, root);
    expect(root.dataset).toEqual({ theme: "paper", uiContrast: "140" });
    expect(root.style.colorScheme).toBe("light");
    expect(root.style.filter).toBeUndefined();
    expect(values.get("--bg-primary")).toBe(appearanceThemes.paper.colors["bg-primary"]);
    expect(values.get("--font-body")).toContain("Georgia");
    expect(values.get("--border")).toBe(appearanceColors({ theme: "paper", contrast: 140 }).border);
    expect(values.has("filter")).toBe(false);
  });
  it.each(Object.entries(appearanceThemes))("%s keeps body text and accents readable on its surfaces", (_, theme) => {
    for (const surface of ["bg-primary", "bg-surface", "bg-card", "bg-input", "bg-sidebar", "user-bubble"]) {
      for (const text of ["text", "text-dim", "text-muted"]) expect(contrast(theme.colors[text], theme.colors[surface])).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(theme.colors.accent, theme.colors["accent-dim"])).toBeGreaterThanOrEqual(4.5);
  });
});
