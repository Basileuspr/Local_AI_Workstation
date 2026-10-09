import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CHAT_PINS_KEY, WORKSPACE_PINS_KEY, loadChatPins, loadWorkspacePins, validChatPin, validWorkspacePin, workspaceVisible, pinnableTabs } from "../../src/chatPins";
import { checklistItems } from "../../src/markdownTasks";
import ChatChecklistEditor from "../../src/components/ChatChecklistEditor";
import AppLayout from "../../src/components/AppLayout";

afterEach(() => vi.unstubAllGlobals());
it("restores separate chat pins and rejects obsolete or unsafe destinations", () => {
  vi.stubGlobal("localStorage", { getItem: key => key === CHAT_PINS_KEY ? JSON.stringify({
    a: { kind: "tool", tab: "canvas" }, b: { kind: "document", artifactId: "a".repeat(32) },
    c: { kind: "tool", tab: "chats" }, d: { kind: "tool", tab: "https://example.com" },
  }) : null });
  expect(loadChatPins()).toEqual({ a: { kind: "tool", tab: "canvas" }, b: { kind: "document", artifactId: "a".repeat(32) } });
  expect(validChatPin({ kind: "document", artifactId: "../escape" })).toBeNull();
});
it("keeps chat and only the pinned workspace visible, while normal navigation still works", () => {
  const pin = { kind: "tool", tab: "canvas" };
  expect(workspaceVisible("chats", pin, "chats")).toBe(true);
  expect(workspaceVisible("chats", pin, "canvas")).toBe(true);
  expect(workspaceVisible("chats", pin, "audio")).toBe(false);
  expect(workspaceVisible("audio", pin, "canvas")).toBe(false);
  expect(workspaceVisible("audio", pin, "audio")).toBe(true);
  expect(pinnableTabs).not.toContain("chats");
});
it("works with unavailable or damaged pin storage", () => {
  vi.stubGlobal("localStorage", { getItem: () => "bad json" }); expect(loadChatPins()).toEqual({});
  vi.stubGlobal("localStorage", { getItem: () => { throw Error("denied"); } }); expect(loadChatPins()).toEqual({});
});
it("restores independent workspace pairs without accepting self pins, attachments or obsolete tabs", () => {
  vi.stubGlobal("localStorage", { getItem: key => key === WORKSPACE_PINS_KEY ? JSON.stringify({
    generate: { kind: "tool", tab: "browser" }, browser: { kind: "tool", tab: "chats" },
    audio: { kind: "tool", tab: "audio" }, chats: { kind: "tool", tab: "generate" },
    canvas: { kind: "document", artifactId: "a".repeat(32) }, obsolete: { kind: "tool", tab: "browser" },
    markdown: { kind: "tool", tab: "https://example.com" },
  }) : null });
  expect(loadWorkspacePins()).toEqual({ generate: { kind: "tool", tab: "browser" }, browser: { kind: "tool", tab: "chats" } });
  expect(loadChatPins()).toEqual({});
  expect(validWorkspacePin("generate", { kind: "tool", tab: "generate" })).toBeNull();
  vi.stubGlobal("localStorage", { getItem: () => "bad json" }); expect(loadWorkspacePins()).toEqual({});
  vi.stubGlobal("localStorage", { getItem: () => { throw Error("denied"); } }); expect(loadWorkspacePins()).toEqual({});
});
it("shows only Generate and Browser while keeping a separate chat pin intact", () => {
  const chatPin = { kind: "tool", tab: "canvas" }, workspacePin = { kind: "tool", tab: "browser" };
  for (const tab of ["generate", "browser", "chats", "canvas", "audio"])
    expect(workspaceVisible("generate", chatPin, tab, workspacePin)).toBe(["generate", "browser"].includes(tab));
  expect(workspaceVisible("chats", chatPin, "canvas", workspacePin)).toBe(true);
  expect(workspaceVisible("chats", chatPin, "browser", workspacePin)).toBe(false);
  expect(workspaceVisible("browser", chatPin, "chats", { kind: "tool", tab: "chats" })).toBe(true);
});
it("extracts only editable tasks, retaining original line numbers", () => {
  expect(checklistItems("# List\r\n- [ ] Milk\r\n~~~\r\n- [ ] Code\r\n~~~\r\n  + [X] Nested"))
    .toEqual([{ line_index: 1, text: "Milk", checked: false }, { line_index: 5, text: "Nested", checked: true }]);
  const html = renderToStaticMarkup(<ChatChecklistEditor content="- [ ] Milk" onSave={() => {}} onCancel={() => {}} />);
  expect(html).toContain('aria-label="Checklist item 1"'); expect(html).toContain("Add item"); expect(html).toContain("Save list");
});
it("lays out pinned panes without rendering a second copy of the tool", () => {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  const html = renderToStaticMarkup(<AppLayout activeTab="chats" pinnedTab="markdown" pinnedTitle="Markdown Viewer" sidebar={() => null}>
    <div className="pane chat-pane" data-capture-tab="chats"><textarea defaultValue="chat draft" /></div>
    <div className="pane" data-capture-tab="markdown"><textarea defaultValue="tool draft" /></div>
  </AppLayout>);
  expect(html).toContain('class="workspace-panes split-chat"');
  expect(html.match(/tool draft/g)).toHaveLength(1);
  expect(html).toContain('aria-label="Close side pane"');
});
