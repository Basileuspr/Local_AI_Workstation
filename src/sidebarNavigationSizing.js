import { navigationSections } from "./navigationOrder";
import { clampLayoutValue } from "./workspaceLayout";

export const SIDEBAR_MENU_SIZE_KEY = "local-ai-workstation-sidebar-menu-sizes-v1";
export const SIDEBAR_MENU_DEFAULT = 136;
export const SIDEBAR_MENU_MIN = 64;
export const SIDEBAR_MENU_MAX = 800;
export const SIDEBAR_NAVIGATION_SIZE_KEY = "local-ai-workstation-sidebar-navigation-size-v1";
export const SIDEBAR_NAVIGATION_MIN = 180;

export function normalizeSidebarNavigationSize(value) {
  return {
    height: Number.isFinite(value?.height) ? Math.round(clampLayoutValue(value.height, SIDEBAR_NAVIGATION_MIN, 4000)) : null,
    expanded: value?.expanded === true,
  };
}

export function loadSidebarNavigationSize(storage = globalThis.localStorage) {
  try { return normalizeSidebarNavigationSize(JSON.parse(storage?.getItem(SIDEBAR_NAVIGATION_SIZE_KEY) || "null")); }
  catch { return normalizeSidebarNavigationSize(); }
}

export function saveSidebarNavigationSize(value, storage = globalThis.localStorage) {
  try { storage?.setItem(SIDEBAR_NAVIGATION_SIZE_KEY, JSON.stringify(normalizeSidebarNavigationSize(value))); }
  catch { /* Expansion and resizing remain usable without browser storage. */ }
}

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
