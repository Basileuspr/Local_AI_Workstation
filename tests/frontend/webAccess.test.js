import { describe, expect, it, vi } from "vitest";
import { buildWebSourceMessage, createWebChat } from "../../src/webAccess";
import { buildContextMessages } from "../../src/contextMemory";

vi.mock("../../src/api", () => ({
  apiUrl: (path) => path,
  createSession: vi.fn(async () => ({ id: "new-session" })),
  saveSession: vi.fn(async (id, messages, model, options) => ({ id, messages, model, title: options.title })),
}));

const source = { id: "source", title: "Solar energy", url: "https://en.wikipedia.org/wiki/Solar_energy", fetched_at: "2026-09-07T00:00:00Z", attribution: "Wikipedia contributors", revision: 123, content_hash: "hash", text: "a".repeat(9000) };

describe("web source chats", () => {
  it("bounds text and keeps source provenance through chat context serialization", () => {
    const message = buildWebSourceMessage(source);
    const [context] = buildContextMessages([message], "", 0);
    expect(context.content).toContain(source.url);
    expect(context.content).toContain(source.fetched_at);
    expect(context.content).toContain("Revision: 123");
    expect(context.content).toContain("excerpt only");
    expect(context.content).not.toContain("a".repeat(6001));
    expect(context.role).toBe("user");
    expect(message.webSource.contentHash).toBe("hash");
  });

  it("creates and saves a separate chat with the selected local model", async () => {
    const chat = await createWebChat(source, "my-local-model");
    expect(chat.id).toBe("new-session");
    expect(chat.model).toBe("my-local-model");
    expect(chat.title).toBe("Web: Solar energy");
    expect(chat.messages[0].content).toContain("[Web source snapshot]");
  });
});
