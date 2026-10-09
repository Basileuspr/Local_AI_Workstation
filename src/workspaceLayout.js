export const WORKSPACE_LAYOUT_KEY = "local-ai-workstation-layout-v1";
export const DIVIDER_SIZE = 10;
export const SIDEBAR_DEFAULT = 260;
export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 640;
export const SPLIT_DEFAULTS = { horizontal: 50, vertical: 55 };

export function clampLayoutValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function loadWorkspaceLayout() {
  const defaults = { sidebarCollapsed: false, sidebarWidth: SIDEBAR_DEFAULT, splits: {} };
  try {
    const saved = JSON.parse(localStorage.getItem(WORKSPACE_LAYOUT_KEY));
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return defaults;
    const splits = Object.fromEntries(Object.entries(saved.splits || {}).flatMap(([id, sizes]) => {
      if (!sizes || typeof sizes !== "object" || Array.isArray(sizes)) return [];
      const valid = Object.fromEntries(Object.keys(SPLIT_DEFAULTS).flatMap(axis =>
        Number.isFinite(sizes[axis]) ? [[axis, clampLayoutValue(sizes[axis], 20, 80)]] : []));
      return Object.keys(valid).length ? [[id, valid]] : [];
    }));
    return {
      sidebarCollapsed: saved.sidebarCollapsed === true,
      sidebarWidth: Number.isFinite(saved.sidebarWidth)
        ? clampLayoutValue(saved.sidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX) : SIDEBAR_DEFAULT,
      splits,
    };
  } catch { return defaults; }
}

export function saveWorkspaceLayout(layout) {
  try { localStorage.setItem(WORKSPACE_LAYOUT_KEY, JSON.stringify(layout)); }
  catch { /* Layout controls still work when browser storage is unavailable. */ }
}

// horizontal = panes beside one another; vertical = panes stacked.
export function splitLimits(length, axis, secondChat = false) {
  const first = axis === "vertical" ? secondChat ? 320 : 280 : 320;
  const second = axis === "vertical" ? secondChat ? 400 : 200 : secondChat ? 320 : 280;
  const available = Math.max(length - DIVIDER_SIZE, first + second);
  return { min: Math.max(20, first / available * 100), max: Math.min(80, (1 - second / available) * 100), available };
}
