import { afterEach, expect, it, vi } from "vitest";
import { loadSidebarMenuSizes, saveSidebarMenuSizes, normalizeSidebarMenuSizes, SIDEBAR_MENU_SIZE_KEY,
  loadSidebarNavigationSize, saveSidebarNavigationSize, normalizeSidebarNavigationSize, SIDEBAR_NAVIGATION_SIZE_KEY } from "../../src/sidebarNavigationSizing";
import { WORKSPACE_LAYOUT_KEY } from "../../src/workspaceLayout";
import { NAVIGATION_ORDER_KEY } from "../../src/navigationOrder";

afterEach(() => vi.unstubAllGlobals());
it("restores independent menu heights without changing pane sizes or tab order", () => {
  const values = new Map([[WORKSPACE_LAYOUT_KEY, '{"sidebarWidth":340}'], [NAVIGATION_ORDER_KEY, '{"sections":["images"]}']]);
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  saveSidebarMenuSizes({ workspace: 200, images: 96, viewers: 280 }, storage);
  expect(loadSidebarMenuSizes(storage)).toEqual({ workspace: 200, images: 96, characters: 136, learning: 136, viewers: 280 });
  expect(values.get(WORKSPACE_LAYOUT_KEY)).toBe('{"sidebarWidth":340}');
  expect(values.get(NAVIGATION_ORDER_KEY)).toBe('{"sections":["images"]}');
  expect(JSON.parse(values.get(SIDEBAR_MENU_SIZE_KEY)).viewers).toBe(280);
});
it("bounds stale or damaged preferences and drops unknown groups", () => {
  expect(normalizeSidebarMenuSizes({ workspace: 9000, images: -20, characters: "200", viewers: 192.6, deleted: 200 }))
    .toEqual({ workspace: 800, images: 64, characters: 136, learning: 136, viewers: 193 });
  expect(normalizeSidebarMenuSizes(null)).toEqual(normalizeSidebarMenuSizes());
  expect(loadSidebarMenuSizes({ getItem: () => "broken JSON" })).toEqual(normalizeSidebarMenuSizes());
});
it("keeps resizing usable when preference storage is unavailable", () => {
  const storage = { getItem: () => { throw Error("Unavailable"); }, setItem: () => { throw Error("Unavailable"); } };
  expect(loadSidebarMenuSizes(storage)).toEqual(normalizeSidebarMenuSizes());
  expect(() => saveSidebarMenuSizes({ images: 240 }, storage)).not.toThrow();
  expect(loadSidebarNavigationSize(storage)).toEqual({ height: null, expanded: false });
  expect(() => saveSidebarNavigationSize({ height: 700, expanded: true }, storage)).not.toThrow();
});
it("remembers tab pane expansion and a custom height separately from menu sizes", () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  saveSidebarMenuSizes({ workspace: 560 }, storage);
  saveSidebarNavigationSize({ height: 710, expanded: true }, storage);
  expect(loadSidebarNavigationSize(storage)).toEqual({ height: 710, expanded: true });
  expect(loadSidebarMenuSizes(storage).workspace).toBe(560);
  expect(values.has(SIDEBAR_NAVIGATION_SIZE_KEY)).toBe(true);
  expect(normalizeSidebarNavigationSize({ height: -20, expanded: "true" })).toEqual({ height: 180, expanded: false });
  expect(loadSidebarNavigationSize({ getItem: () => 'broken JSON' })).toEqual({ height: null, expanded: false });
});
