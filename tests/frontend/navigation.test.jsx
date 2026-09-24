import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appTabs, loadNavigation, saveNavigation, NAVIGATION_STORAGE_KEY } from "../../src/navigation";
import { StoreProvider, useStore } from "../../src/useStore";
import AppLayout from "../../src/components/AppLayout";

afterEach(() => vi.unstubAllGlobals());
function storage() {
  const values = new Map();
  const localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("window", { localStorage, matchMedia: () => ({ matches: false }) });
  return localStorage;
}
function CurrentTab() { return <span>{useStore().activeSidebarTab}</span>; }

describe("persistent workspace navigation", () => {
  it.each(appTabs)("restores %s on store initialization and shows its refresh control", tab => {
    storage();
    saveNavigation(tab, "saved-chat");
    expect(loadNavigation()).toEqual({ tab, sessionId: "saved-chat" });
    expect(renderToStaticMarkup(<StoreProvider><CurrentTab /></StoreProvider>)).toContain(`>${tab}<`);
    const markup = renderToStaticMarkup(<AppLayout activeTab={tab} sidebar={() => null} onRefresh={() => {}} />);
    expect(markup).toContain('class="workspace-refresh"');
    expect(markup).toContain('aria-label="Refresh ');
  });
  it("falls back safely for damaged and obsolete navigation", () => {
    const local = storage();
    local.setItem(NAVIGATION_STORAGE_KEY, "invalid JSON");
    expect(loadNavigation()).toEqual({ tab: "chats", sessionId: null });
    local.setItem(NAVIGATION_STORAGE_KEY, JSON.stringify({ tab: "removed-tab", sessionId: {} }));
    expect(loadNavigation()).toEqual({ tab: "chats", sessionId: null });
  });
  it("works without browser storage", () => {
    vi.stubGlobal("localStorage", { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } });
    expect(loadNavigation().tab).toBe("chats");
    expect(() => saveNavigation("images", null)).not.toThrow();
  });
});
