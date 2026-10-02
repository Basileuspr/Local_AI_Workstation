import { afterEach, expect, it, vi } from "vitest";
import { exportThinkingTrace, loadThinkingTrace, mergeTracePage } from "../../src/thinkingTrace";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("loads incremental trace pages without truncating or duplicating history", async () => {
  const text = 'Full trace 🧠\n'.repeat(40000);
  const first = mergeTracePage({ content: '', offset: 0, revision: '' }, { content: text, offset: 0, next_offset: 123, revision: 'a' });
  const second = mergeTracePage(first, { content: 'Last token', offset: 123, next_offset: 133, revision: 'a' });
  expect(second.content).toBe(text + 'Last token');
  expect(mergeTracePage(second, { content: 'New', offset: 0, next_offset: 3, revision: 'b' }).content).toBe('New');
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: 'tail' }) });
  vi.stubGlobal('fetch', fetch);
  await expect(loadThinkingTrace({ offset: 123, revision: 'a' })).resolves.toEqual({ content: 'tail' });
  expect(fetch.mock.calls[0][0]).toContain('/thinking/trace?offset=123&revision=a');
  expect(fetch.mock.calls[0][1].cache).toBe('no-store');
});

it("reports read and export failures instead of announcing a download", async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
  await expect(loadThinkingTrace()).rejects.toThrow('Could not load thinking trace (503)');
  await expect(exportThinkingTrace()).rejects.toThrow('Could not export thinking trace (503)');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob([]) }));
  await expect(exportThinkingTrace()).rejects.toThrow('No thinking trace');
});

it("downloads the full text with a filename and preserves the backend log", async () => {
  vi.useFakeTimers();
  const blob = new Blob(['A full trace 🧠']);
  const fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
  const link = { click: vi.fn(), remove: vi.fn() };
  const createObjectURL = vi.fn(() => 'blob:test'), revokeObjectURL = vi.fn();
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('document', { createElement: () => link, body: { appendChild: vi.fn() } });
  vi.stubGlobal('window', { setTimeout });
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  await exportThinkingTrace();
  expect(createObjectURL).toHaveBeenCalledWith(blob);
  expect(link.download).toMatch(/^thinking-trace-.*\.txt$/);
  expect(link.click).toHaveBeenCalledOnce();
  expect(link.remove).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toContain('/thinking/export');
  vi.advanceTimersByTime(60000);
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
});
