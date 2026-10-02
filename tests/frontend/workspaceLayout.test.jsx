import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WORKSPACE_LAYOUT_KEY, loadWorkspaceLayout, saveWorkspaceLayout, splitLimits } from "../../src/workspaceLayout";
import AppLayout from "../../src/components/AppLayout";

afterEach(() => vi.unstubAllGlobals());
function storage(saved) {
  const values = new Map([[WORKSPACE_LAYOUT_KEY, JSON.stringify(saved)]]);
  vi.stubGlobal("localStorage", { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) });
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  return values;
}
it("restores sidebar preferences and independent chat sizes for both arrangements", () => {
  storage({ sidebarCollapsed: true, sidebarWidth: 340, splits: { a: { horizontal: 65, vertical: 60 }, b: { horizontal: 40 } } });
  const layout = loadWorkspaceLayout();
  expect(layout).toEqual({ sidebarCollapsed: true, sidebarWidth: 340, splits: { a: { horizontal: 65, vertical: 60 }, b: { horizontal: 40 } } });
  saveWorkspaceLayout({ ...layout, sidebarWidth: 300 });
  expect(loadWorkspaceLayout().sidebarWidth).toBe(300);
});
it("rejects damaged values and bounds saved sizes so the controls remain usable", () => {
  storage({ sidebarWidth: 9000, sidebarCollapsed: "false", splits: { a: { horizontal: -1, vertical: 99 }, b: [], c: { horizontal: "65" } } });
  expect(loadWorkspaceLayout()).toEqual({ sidebarCollapsed: false, sidebarWidth: 480, splits: { a: { horizontal: 20, vertical: 80 } } });
  vi.stubGlobal("localStorage", { getItem: () => "bad json", setItem: () => { throw Error("denied"); } });
  expect(loadWorkspaceLayout()).toEqual({ sidebarCollapsed: false, sidebarWidth: 260, splits: {} });
  expect(() => saveWorkspaceLayout({})).not.toThrow();
  vi.stubGlobal("localStorage", { getItem: () => { throw Error("denied"); } });
  expect(loadWorkspaceLayout().sidebarWidth).toBe(260);
});
it("keeps both panes above their minimum dimensions even in a short window", () => {
  const beside = splitLimits(1000, "horizontal");
  expect(beside.available * beside.min / 100).toBeCloseTo(320);
  expect(beside.available * (100 - beside.max) / 100).toBeCloseTo(280);
  const short = splitLimits(300, "vertical");
  expect(short.available).toBe(480);
  expect(short.min).toBeCloseTo(short.max);
});
it("keeps hidden navigation mounted and exposes keyboard accessible dividers", () => {
  storage({ sidebarCollapsed: true });
  const html = renderToStaticMarkup(<AppLayout activeTab="chats" pinnedTab="markdown" sidebar={() => <textarea defaultValue="nav draft" />}>
    <div className="pane chat-pane" data-capture-tab="chats"><textarea defaultValue="chat draft" /></div>
    <div className="pane" data-capture-tab="markdown"><textarea defaultValue="tool draft" /></div>
  </AppLayout>);
  expect(html).toContain('class="sidebar-collapsed"');
  expect(html).toContain('aria-label="Show navigation"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('inert="" aria-hidden="true"');
  expect(html).toContain('role="separator" tabindex="0"');
  expect(html).toContain('aria-label="Resize chat and pinned pane"');
  expect(html.match(/nav draft/g)).toHaveLength(1);
  expect(html.match(/tool draft/g)).toHaveLength(1);
});
