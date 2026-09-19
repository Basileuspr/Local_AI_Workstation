import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteSession } from "../../src/api";

afterEach(() => vi.unstubAllGlobals());

describe("chat deletion responses", () => {
  it("surfaces a read-only rejection instead of reporting success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ detail: "Read-only UI mirror: changes and generation are disabled." }),
    }));
    await expect(deleteSession("chat-1")).rejects.toThrow("Read-only UI mirror");
  });

  it("reports failure even when the server does not return JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new SyntaxError("Invalid JSON"); },
    }));
    await expect(deleteSession("chat-1")).rejects.toThrow("Could not delete the chat");
  });

  it("accepts successful deletion without requiring a response body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 204 }));
    await expect(deleteSession("chat-1")).resolves.toBeUndefined();
  });
});
