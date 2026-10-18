import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useMobileSync } from "../../src/useMobileSync";
import * as api from "../../src/api";

let listener, root;
vi.mock("../../src/polling", () => ({ createPollingObserver: () => ({ subscribe: value => { listener = value; return () => {}; } }), readPollingJson: vi.fn() }));
vi.mock("../../src/api", () => ({ apiUrl: path => path, listSessions: vi.fn(), listSessionImages: vi.fn(), loadSession: vi.fn() }));
const original = { id: "one", role: "user", content: "Original" };
const state = { currentSessionId: "chat", conversationHistory: [original], sessionRevision: "before", isGenerating: false };
function Probe({ state, dispatch }) { useMobileSync(state, dispatch); return null; }
beforeEach(() => {
  const dom = parseHTML('<html><body><main id="root"></main></body></html>');
  vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.document); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(dom.document.getElementById("root"));
  vi.clearAllMocks();
  api.listSessions.mockResolvedValue([{ id: "chat" }]); api.listSessionImages.mockResolvedValue([]);
  api.loadSession.mockResolvedValue({ id: "chat", title: "Chat", revision: "after", messages: [original, { id: "phone", role: "assistant", content: "Phone result" }] });
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it("defers phone synchronization until desktop generation finishes", async () => {
  const dispatch = vi.fn();
  await act(async () => root.render(<Probe state={{ ...state, isGenerating: true }} dispatch={dispatch} />));
  await act(async () => listener.data({ revision: "mobile-change" }));
  expect(api.loadSession).not.toHaveBeenCalled();
  await act(async () => root.render(<Probe state={state} dispatch={dispatch} />));
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "SET_SESSION", payload: expect.objectContaining({ revision: "after" }) }));
});
it("retries a failed synchronization on the next observation without another edit", async () => {
  const dispatch = vi.fn(); api.listSessionImages.mockRejectedValueOnce(new Error("temporarily offline"));
  await act(async () => root.render(<Probe state={state} dispatch={dispatch} />));
  await act(async () => listener.data({ revision: "same-change" }));
  expect(dispatch).not.toHaveBeenCalled();
  await act(async () => listener.data({ revision: "same-change" }));
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "SET_SESSION" }));
});
