import { describe, expect, it, vi } from "vitest";
import { buildWebSourceMessage, createWebChat, startWebImport, webImageUrl } from "../../src/webAccess";
import { buildContextMessages } from "../../src/contextMemory";

vi.mock("../../src/api", () => ({
  apiUrl: (path) => path,
  createSession: vi.fn(async () => ({ id: "new-session" })),
  appendSessionMessages: vi.fn(async (id, messages, model) => {
    webSaved = { id, messages, model }; return webSaved;
  }),
  updateSessionMetadata: vi.fn(async (id, options) => ({ ...webSaved, id, title: options.title })),
}));
let webSaved;

const source = { id: "source", title: "Solar energy", url: "https://en.wikipedia.org/wiki/Solar_energy", fetched_at: "2026-09-07T00:00:00Z", attribution: "Wikipedia contributors", revision: 123, content_hash: "hash", text: "a".repeat(9000) };

describe("web source chats", () => {
  it("saves ordered local image references without sending all panels to the model", async () => {
    const images = [1, 2].map(index => ({ id: `web-${index}`, name: `Panel ${index}`,
      src: `blob:${String(index).repeat(64)}`, source_url: `https://cdn.example.com/${index}.png` }));
    const chat = await createWebChat({ ...source, images, image_warnings: ["Image 3: not found"] }, "local");
    const message = chat.messages[0];
    expect(message.imagePreviews.map(image => image.src)).toEqual(images.map(image => image.src));
    expect(message.imagePreviews[0].source_url).toBe(images[0].source_url);
    expect(message.content).toContain("2 saved in page order");
    expect(message.content).toContain("Image 3: not found");
    expect(buildContextMessages([message], "", 0)[0].images).toBeUndefined();
    expect(webImageUrl(images[0].src)).toBe(`/web/images/${"1".repeat(64)}`);
    expect(webImageUrl("https://remote.example.com/pixel.png")).toBe("");
  });

  it("sends the explicit image option to the backend", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: "job" }) }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await startWebImport(source.url, false);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ url: source.url, include_images: false });
    } finally { vi.unstubAllGlobals(); }
  });
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
