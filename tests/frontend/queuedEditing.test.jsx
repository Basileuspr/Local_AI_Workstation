import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatSubmissionQueue } from "../../src/chatSubmissionQueue";
import { imageSizes, adjustNumber, seedMax } from "../../src/imageSettingsControls";
import ImageSettingsControls from "../../src/components/ImageSettingsControls";
import { defaultImageSettings } from "../../src/preferences";
import { uploadMany } from "../../src/imageWorkflowApi";

afterEach(() => vi.unstubAllGlobals());
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

describe("editable queued requests", () => {
  it("waits for the previous reply and takes updated context when a follow-up starts", async () => {
    const queue = new ChatSubmissionQueue();
    const gate = deferred(); const history = []; const read = vi.fn();
    queue.enqueue({ id: "first", label: "First", run: async () => { await gate.promise; history.push("earlier reply"); } });
    queue.enqueue({ id: "second", label: "Second", run: async () => read([...history]) });
    expect(queue.getSnapshot().map(job => job.status)).toEqual(["running", "waiting"]);
    expect(read).not.toHaveBeenCalled();
    gate.resolve();
    await vi.waitFor(() => expect(read).toHaveBeenCalledWith(["earlier reply"]));
    expect(queue.getSnapshot()).toEqual([]);
  });
  it("cancels one waiting prompt without cancelling other requests", async () => {
    const queue = new ChatSubmissionQueue(); const gate = deferred(); const cancelled = vi.fn(); const next = vi.fn();
    queue.enqueue({ id: "first", run: () => gate.promise });
    queue.enqueue({ id: "cancel", run: cancelled });
    queue.enqueue({ id: "next", run: next });
    queue.cancel("cancel"); gate.resolve();
    await vi.waitFor(() => expect(next).toHaveBeenCalled());
    expect(cancelled).not.toHaveBeenCalled();
  });
  it("reset aborts preparation and prevents all waiting prompts from starting", async () => {
    const queue = new ChatSubmissionQueue(); const gate = deferred(); const next = vi.fn(); let signal;
    queue.enqueue({ id: "first", run: async value => { signal = value; await gate.promise; } });
    queue.enqueue({ id: "second", run: next });
    queue.cancelAll(); expect(signal.aborted).toBe(true); gate.resolve();
    await vi.waitFor(() => expect(queue.getSnapshot()).toEqual([])); expect(next).not.toHaveBeenCalled();
  });
  it("continues after a failed request with a visible error callback", async () => {
    const queue = new ChatSubmissionQueue(); const onError = vi.fn(); const next = vi.fn();
    queue.enqueue({ id: "first", run: async () => { throw Error("missing chat"); }, onError });
    queue.enqueue({ id: "next", run: next });
    await vi.waitFor(() => expect(next).toHaveBeenCalled()); expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "missing chat" }));
  });
});

describe("generation control limits", () => {
  it("uses exact square and paired landscape/portrait ratios within API bounds", () => {
    for (const { width, height } of imageSizes) {
      expect(width % 8).toBe(0); expect(height % 8).toBe(0);
      expect(Math.min(width, height)).toBeGreaterThanOrEqual(512);
      expect(Math.max(width, height)).toBeLessThanOrEqual(1536);
      expect(width * height).toBeLessThanOrEqual(1024 * 1024);
      expect(imageSizes.some(item => item.width === height && item.height === width)).toBe(true);
    }
  });
  it("clamps jumps, preserves zero seeds, and avoids floating point drift", () => {
    expect(adjustNumber(58, 15, 1, 60)).toBe(60);
    expect(adjustNumber(2, -15, 1, 60)).toBe(1);
    expect(adjustNumber(5.6, 0.1, 1, 20)).toBe(5.7);
    expect(adjustNumber(seedMax - 2, 1000, 0, seedMax)).toBe(seedMax);
    expect(adjustNumber("", -1, 0, seedMax)).toBe(0);
    const html = renderToStaticMarkup(<ImageSettingsControls settings={defaultImageSettings} onChange={() => {}} />);
    expect(html).toContain('aria-label="Steps plus 15"');
    expect(html).toContain('aria-label="Guidance plus 0.1"');
    expect(html).toContain('max="2147483647"');
    expect(html).toContain('Portrait · 9:16');
  });
});

describe("multiple workflow references", () => {
  it("chains revisions, retains successes and continues after a bad file", async () => {
    const revisions = []; const saved = vi.fn(); let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
      revisions.push(options.body.get("revision")); calls++;
      if (calls === 2) return new Response(JSON.stringify({ detail: "Invalid image" }), { status: 400 });
      return new Response(JSON.stringify({ id: "w", revision: calls === 1 ? 2 : 3, assets: calls === 1 ? ["a"] : ["a", "b"] }));
    }));
    const result = await uploadMany({ id: "w", revision: 1, assets: [] }, ["a", "bad", "b"].map(name => new File(["png"], name)), saved);
    expect(revisions).toEqual(["1", "2", "2"]); expect(result.added).toBe(2);
    expect(result.failed).toEqual(["bad: Invalid image"]); expect(saved).toHaveBeenCalledTimes(2);
  });
  it("counts duplicate files and stops safely on revision conflict", async () => {
    const workflow = { id: "w", revision: 2, assets: ["a"] };
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(workflow)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Reload revision" }), { status: 409 }));
    vi.stubGlobal("fetch", fetch);
    const result = await uploadMany(workflow, ["a", "b", "c"].map(name => new File(["png"], name)));
    expect(result.duplicates).toBe(1); expect(result.added).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2); expect(result.failed[1]).toContain("remaining file(s) not uploaded");
  });
});
