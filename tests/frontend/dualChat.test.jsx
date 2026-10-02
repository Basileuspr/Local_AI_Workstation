import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { ChatSubmissionQueue } from "../../src/chatSubmissionQueue";
import { chatActivities } from "../../src/chatActivity";
import { ChatPaneProvider, DualChatProvider, useChatPane } from "../../src/ChatPane";
import { StoreProvider, ChatStoreProvider, useStore } from "../../src/useStore";
import { validChatPin } from "../../src/chatPins";
import { statusIndicator } from "../../src/serviceStatus";
import { chatModelChoice, saveChatModelChoice } from "../../src/chatModelChoices";

afterEach(() => vi.unstubAllGlobals());
it("keeps pane identity and store history distinct", () => {
  vi.stubGlobal("localStorage", { getItem: () => null });
  function Identity() { const pane = useChatPane(), state = useStore(); return <textarea id={pane.domId("chat-input")} aria-label={pane.label} defaultValue={state.sessionTitle} />; }
  const html = renderToStaticMarkup(<StoreProvider><DualChatProvider>
    <ChatPaneProvider id="primary" dual><Identity /></ChatPaneProvider>
    <ChatStoreProvider><ChatPaneProvider id="secondary" dual><Identity /></ChatPaneProvider></ChatStoreProvider>
  </DualChatProvider></StoreProvider>);
  expect(html).toContain('id="chat-input"'); expect(html).toContain('id="chat-input-secondary"');
  expect(html).toContain('aria-label="Chat A"'); expect(html).toContain('aria-label="Chat B"');
  expect(validChatPin({ kind: "chat", sessionId: "chat-b" })).toEqual({ kind: "chat", sessionId: "chat-b" });
  expect(validChatPin({ kind: "chat", sessionId: "../private" })).toBeNull();
});
it("serializes A, B, and A's follow-up with each submitted model unchanged", async () => {
  const queue = new ChatSubmissionQueue(), order = [];
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  queue.enqueue({ id: "a", pane_id: "primary", session_id: "a", model: "alpha", run: async () => { order.push("a:alpha"); await gate; } });
  queue.enqueue({ id: "b", pane_id: "secondary", session_id: "b", model: "beta", run: async () => { order.push("b:beta"); } });
  queue.enqueue({ id: "a2", pane_id: "primary", session_id: "a", model: "alpha", run: async () => { order.push("a2:alpha"); } });
  expect(order).toEqual(["a:alpha"]);
  expect(queue.getSnapshot().map(job => job.model)).toEqual(["alpha", "beta", "alpha"]);
  finish(); await vi.waitFor(() => expect(queue.getSnapshot()).toEqual([]));
  expect(order).toEqual(["a:alpha", "b:beta", "a2:alpha"]);
});
it("reports switching and queue position, then preserves saving after provider completion", () => {
  const submissions = [{ id: "b", request_id: "b", status: "running", stage: "preparing", model: "beta" },
    { id: "a2", status: "waiting", model: "alpha" }];
  const jobs = [{ request_id: "b", status: "running", stage: "switching_models", stage_detail: "Unloading alpha" }];
  let [active, waiting] = chatActivities(submissions, jobs);
  expect(active.statusLabel).toBe("Switching Models"); expect(waiting.queuePosition).toBe(1);
  expect(statusIndicator({ connected: true, hasModel: true, activity: active }).label).toBe("Switching Models");
  submissions[0].stage = "saving";
  [active] = chatActivities(submissions, jobs);
  expect(active.statusLabel).toBe("Saving Reply");
});
it("remembers independent model choices and tolerates unavailable storage/models", () => {
  const storage = new Map();
  vi.stubGlobal("localStorage", { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) });
  saveChatModelChoice("a", "alpha"); saveChatModelChoice("b", "beta");
  const models = [{ name: "alpha" }, { name: "beta" }];
  expect(chatModelChoice("a", "beta", "beta", models)).toBe("alpha");
  expect(chatModelChoice("b", "alpha", "alpha", models)).toBe("beta");
  expect(chatModelChoice("b", "beta", "alpha", [{ name: "alpha" }])).toBe("alpha");
  vi.stubGlobal("localStorage", { getItem: () => { throw Error("denied"); }, setItem: () => { throw Error("denied"); } });
  expect(() => saveChatModelChoice("a", "alpha")).not.toThrow();
});
