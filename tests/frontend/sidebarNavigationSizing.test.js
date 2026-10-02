import { afterEach, expect, it, vi } from "vitest";
import { loadSidebarMenuSizes, saveSidebarMenuSizes, normalizeSidebarMenuSizes, SIDEBAR_MENU_SIZE_KEY } from "../../src/sidebarNavigationSizing";
import { WORKSPACE_LAYOUT_KEY } from "../../src/workspaceLayout";
import { NAVIGATION_ORDER_KEY } from "../../src/navigationOrder";

afterEach(() => vi.unstubAllGlobals());
it("restores independent menu heights without changing pane sizes or tab order", () => {
  const values = new Map([[WORKSPACE_LAYOUT_KEY, '{"sidebarWidth":340}'], [NAVIGATION_ORDER_KEY, '{"sections":["images"]}']]);
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  saveSidebarMenuSizes({ workspace: 200, images: 96, viewers: 280 }, storage);
  expect(loadSidebarMenuSizes(storage)).toEqual({ workspace: 200, images: 96, characters: 136, viewers: 280 });
  expect(values.get(WORKSPACE_LAYOUT_KEY)).toBe('{"sidebarWidth":340}');
  expect(values.get(NAVIGATION_ORDER_KEY)).toBe('{"sections":["images"]}');
  expect(JSON.parse(values.get(SIDEBAR_MENU_SIZE_KEY)).viewers).toBe(280);
});
it("bounds stale or damaged preferences and drops unknown groups", () => {
  expect(normalizeSidebarMenuSizes({ workspace: 9000, images: -20, characters: "200", viewers: 192.6, deleted: 200 }))
    .toEqual({ workspace: 400, images: 64, characters: 136, viewers: 193 });
  expect(normalizeSidebarMenuSizes(null)).toEqual(normalizeSidebarMenuSizes());
  expect(loadSidebarMenuSizes({ getItem: () => "broken JSON" })).toEqual(normalizeSidebarMenuSizes());
});
it("keeps resizing usable when preference storage is unavailable", () => {
  const storage = { getItem: () => { throw Error("Unavailable"); }, setItem: () => { throw Error("Unavailable"); } };
  expect(loadSidebarMenuSizes(storage)).toEqual(normalizeSidebarMenuSizes());
  expect(() => saveSidebarMenuSizes({ images: 240 }, storage)).not.toThrow();
});
