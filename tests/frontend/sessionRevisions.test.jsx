import { afterEach, describe, expect, it, vi } from "vitest";
import { saveSession, updateSessionMetadata, appendSessionMessages } from "../../src/api";
import { persistSessionSummary } from "../../src/sessionPersistence";
import { reducer } from "../../src/useStore.jsx";

afterEach(() => vi.unstubAllGlobals());
const source = { id: "chat-a", revision: "rev-a", messages: [{ id: "old", content: "Old" }], memory_summary: "", summarized_message_count: 0 };

describe("session revision persistence", () => {
  it("sends explicit replacement revisions and surfaces a structured conflict without retry", async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ detail: {
      code: "session_conflict", message: "Reload this chat before saving", current_revision: "rev-b",
    } }) }));
    vi.stubGlobal("fetch", fetch);
    await expect(saveSession(source.id, source.messages, "model", { expectedRevision: source.revision }))
      .rejects.toMatchObject({ status: 409, code: "session_conflict", currentRevision: "rev-b", message: "Reload this chat before saving" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body).expected_revision).toBe("rev-a");
  });

  it("rename sends only metadata and additive replies send no stale summary", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => source }));
    vi.stubGlobal("fetch", fetch);
    await updateSessionMetadata(source.id, { title: "Renamed" });
    expect(fetch.mock.calls[0][1].method).toBe("PATCH");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ title: "Renamed" });
    await appendSessionMessages(source.id, [{ id: "reply", content: "Reply" }], "model");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ messages: [{ id: "reply", content: "Reply" }], model: "model" });
  });

  it("summary changes use the source revision and do not merge or retry a conflict", async () => {
    const error = Object.assign(new Error("Reload chat"), { status: 409 });
    const api = { updateSessionMetadata: vi.fn().mockRejectedValue(error) };
    await expect(persistSessionSummary(api, source, "Summary", 1)).rejects.toBe(error);
    expect(api.updateSessionMetadata).toHaveBeenCalledExactlyOnceWith("chat-a", {
      memorySummary: "Summary", summarizedMessageCount: 1, expectedRevision: "rev-a",
    });
  });

  it("a delayed metadata result preserves newer messages and cannot switch a navigated chat", () => {
    const history = [{ id: "newer", content: "Newer" }];
    const state = { currentSessionId: "chat-a", sessionRevision: "rev-a", conversationHistory: history, sessionTitle: "Old" };
    const saved = { ...source, revision: "rev-b", title: "Renamed", memory_summary: "Summary", summarized_message_count: 1 };
    const action = { type: "SESSION_METADATA_SAVED", payload: saved, expectedRevision: "rev-a" };
    expect(reducer(state, action).conversationHistory).toBe(history);
    const navigated = { ...state, currentSessionId: "chat-b" };
    expect(reducer(navigated, action)).toBe(navigated);
    const advanced = { ...state, sessionRevision: "newer-revision" };
    expect(reducer(advanced, action)).toBe(advanced);
    const renameResponse = { ...saved, previous_revision: "another-server-revision" };
    const renamed = reducer(state, { type: "SESSION_METADATA_SAVED", payload: renameResponse });
    expect(renamed.sessionTitle).toBe("Renamed");
    expect(renamed.sessionRevision).toBe(state.sessionRevision);
    expect(renamed.memorySummary).toBe(state.memorySummary);
  });
});
