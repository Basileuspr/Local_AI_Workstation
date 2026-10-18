import { expect, it } from "vitest";
import { canApplyMobileSession } from "../../src/useMobileSync";

const message = { id: "original", role: "user", content: "Keep this" };
const state = { currentSessionId: "chat", sessionRevision: "before", conversationHistory: [message], isGenerating: false };
const incoming = { id: "chat", revision: "after", messages: [message, { id: "mobile", role: "assistant", content: "Mobile response" }] };
it("synchronizes additive phone results into an unchanged desktop view", () => {
  expect(canApplyMobileSession(state, state, incoming)).toBe(true);
});
it("preserves local edits, streaming work, navigation and changes during reload", () => {
  expect(canApplyMobileSession(state, { ...state, isGenerating: true }, incoming)).toBe(false);
  expect(canApplyMobileSession(state, { ...state, currentSessionId: "another" }, incoming)).toBe(false);
  expect(canApplyMobileSession(state, { ...state, sessionRevision: "edited" }, incoming)).toBe(false);
  expect(canApplyMobileSession(state, { ...state, conversationHistory: [...state.conversationHistory] }, incoming)).toBe(false);
  expect(canApplyMobileSession(state, state, { ...incoming, messages: [{ ...message, content: "Changed remotely" }] })).toBe(false);
  const draft = { ...state, conversationHistory: [...state.conversationHistory, { id: "draft", role: "user", content: "Unsaved" }] };
  expect(canApplyMobileSession(draft, draft, incoming)).toBe(false);
});
