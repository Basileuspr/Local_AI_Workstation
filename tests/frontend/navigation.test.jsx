import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appTabs, loadNavigation, saveNavigation, NAVIGATION_STORAGE_KEY, REFRESH_NAVIGATION_KEY, loadStartupNavigation, rememberRefreshNavigation, clearRefreshNavigation } from "../../src/navigation";
import { StoreProvider, useStore, reducer } from "../../src/useStore";
import AppLayout from "../../src/components/AppLayout";

afterEach(() => vi.unstubAllGlobals());
function storage() {
  const values = new Map();
  const localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  vi.stubGlobal("localStorage", localStorage);
  const refreshValues = new Map();
  vi.stubGlobal("sessionStorage", { getItem: key => refreshValues.get(key) ?? null, setItem: (key, value) => refreshValues.set(key, value), removeItem: key => refreshValues.delete(key) });
  vi.stubGlobal("window", { localStorage, matchMedia: () => ({ matches: false }) });
  return localStorage;
}
function CurrentTab() { return <span>{useStore().activeSidebarTab}</span>; }

describe("persistent workspace navigation", () => {
  it.each(appTabs)("keeps %s available while fresh launches start on Chat", tab => {
    storage();
    saveNavigation(tab, "saved-chat");
    expect(loadNavigation()).toEqual({ tab, sessionId: "saved-chat" });
    expect(renderToStaticMarkup(<StoreProvider><CurrentTab /></StoreProvider>)).toContain(">chats<");
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
  it("uses only a one-time explicit Refresh marker and tolerates repeated initialization", () => {
    storage(); saveNavigation("images", "previous-chat");
    expect(loadStartupNavigation()).toEqual({ tab: "chats", sessionId: null });
    rememberRefreshNavigation("shortcuts", "refresh-chat");
    expect(loadStartupNavigation()).toEqual({ tab: "shortcuts", sessionId: "refresh-chat" });
    expect(loadStartupNavigation()).toEqual({ tab: "shortcuts", sessionId: "refresh-chat" });
    expect(renderToStaticMarkup(<StoreProvider><CurrentTab /></StoreProvider>)).toContain(">shortcuts<");
    clearRefreshNavigation();
    expect(loadStartupNavigation()).toEqual({ tab: "chats", sessionId: null });
  });
  it("falls back to a blank launch for damaged refresh storage", () => {
    storage(); sessionStorage.setItem(REFRESH_NAVIGATION_KEY, "invalid");
    expect(loadStartupNavigation()).toEqual({ tab: "chats", sessionId: null });
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("denied"); } });
    expect(loadStartupNavigation()).toEqual({ tab: "chats", sessionId: null });
    expect(() => rememberRefreshNavigation("chats", "old")).not.toThrow();
    expect(() => clearRefreshNavigation()).not.toThrow();
  });
  it("New Chat clears the selected conversation in memory and retains saved sessions", () => {
    const sessions = [{ id: "saved-chat", title: "Saved conversation" }];
    const state = { sessions, currentSessionId: "saved-chat", sessionRevision: "revision", conversationHistory: [{ role: "user", content: "Previous question" }],
      activeSidebarTab: "shortcuts", sessionTitle: "Saved conversation", memorySummary: "Old summary", summarizedMessageCount: 2,
      knowledgeScopes: { "saved-chat": { mode: "all", ids: [] } }, knowledgeMode: "all", chatDraftVersion: 0 };
    const blank = reducer(state, { type: "START_NEW_CHAT" });
    expect(blank).toMatchObject({ currentSessionId: null, sessionRevision: null, activeSidebarTab: "chats", conversationHistory: [], memorySummary: "", summarizedMessageCount: 0, knowledgeMode: "off", chatDraftVersion: 1 });
    expect(blank.sessions).toBe(sessions);
    expect(reducer(blank, { type: "START_NEW_CHAT" }).chatDraftVersion).toBe(2);
  });
});
