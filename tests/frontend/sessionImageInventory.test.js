import { afterEach, expect, it, vi } from "vitest";
import { listSessionImageInventory, listSessionImages } from "../../src/api";

afterEach(() => vi.unstubAllGlobals());

it("retrieves visible and hidden history in one request with usable image URLs", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    images: [{ id: "visible", url: "/sessions/chat/images/by-id/m/p" }],
    hidden_images: [{ id: "hidden", url: "/sessions/chat/images/by-id/m/h" }],
  }) });
  vi.stubGlobal("fetch", fetch);
  const inventory = await listSessionImageInventory();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toContain("/sessions/images?include_hidden=true");
  expect(inventory.images[0].id).toBe("visible");
  expect(inventory.hiddenImages[0].id).toBe("hidden");
  expect(inventory.images[0].url).toMatch(/\/sessions\/chat\/images\/by-id\/m\/p$/);
});

it("preserves the existing single-group API contract", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ images: [] }) });
  vi.stubGlobal("fetch", fetch);
  expect(await listSessionImages(true)).toEqual([]);
  expect(fetch.mock.calls[0][0]).toContain("/sessions/images?hidden=true");
});

it("rejects a failed combined refresh so history consumers retain existing images", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  await expect(listSessionImageInventory()).rejects.toThrow("Could not load chat images");
});
