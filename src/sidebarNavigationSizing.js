import { navigationSections } from "./navigationOrder";
import { clampLayoutValue } from "./workspaceLayout";

export const SIDEBAR_MENU_SIZE_KEY = "local-ai-workstation-sidebar-menu-sizes-v1";
export const SIDEBAR_MENU_DEFAULT = 136;
export const SIDEBAR_MENU_MIN = 64;
export const SIDEBAR_MENU_MAX = 400;

export function normalizeSidebarMenuSizes(value) {
  return Object.fromEntries(navigationSections.filter(section => section.icon).map(section => [section.id,
    Number.isFinite(value?.[section.id])
      ? Math.round(clampLayoutValue(value[section.id], SIDEBAR_MENU_MIN, SIDEBAR_MENU_MAX)) : SIDEBAR_MENU_DEFAULT]));
}

export function loadSidebarMenuSizes(storage = globalThis.localStorage) {
  try { return normalizeSidebarMenuSizes(JSON.parse(storage?.getItem(SIDEBAR_MENU_SIZE_KEY) || "null")); }
  catch { return normalizeSidebarMenuSizes(); }
}

export function saveSidebarMenuSizes(value, storage = globalThis.localStorage) {
  try { storage?.setItem(SIDEBAR_MENU_SIZE_KEY, JSON.stringify(normalizeSidebarMenuSizes(value))); }
  catch { /* Resizing remains usable when browser storage is unavailable. */ }
}
