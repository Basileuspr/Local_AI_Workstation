import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTaskProgressCache, taskElapsedSeconds, taskProgressCache } from "../../src/taskProgress";
import ImageGenerationProgress from "../../src/components/ImageGenerationProgress";
import LoraAnalysisProgress from "../../src/components/LoraAnalysisProgress";

afterEach(() => vi.restoreAllMocks());

describe("task progress across tabs", () => {
  it("starts at the backend's elapsed time and includes time spent away from the tab", () => {
    let now = 1000;
    const cache = createTaskProgressCache({ now: () => now });
    cache.record("image:one", { elapsed_seconds: 38, phase: "Generating image", step: 19, total_steps: 24 }, cache.beginPoll());
    expect(taskElapsedSeconds(cache.read("image:one"), now)).toBe(38);
    now += 7000;
    expect(taskElapsedSeconds(cache.read("image:one"), now)).toBe(45);
    expect(cache.read("image:one").progress.step).toBe(19);
    cache.record("image:one", { elapsed_seconds: 45.2, phase: "Saving image", step: 24, total_steps: 24 }, cache.beginPoll());
    expect(taskElapsedSeconds(cache.read("image:one"), now)).toBe(45.2);
    expect(cache.read("image:one").progress.phase).toBe("Saving image");
  });

  it("keeps simultaneous requests and repeated analyses of one project independent", () => {
    const cache = createTaskProgressCache({ now: () => 1000 });
    cache.record("image:old", { elapsed_seconds: 49 }, cache.beginPoll());
    cache.record("analysis:project:first", { elapsed_seconds: 132, completed: 7 }, cache.beginPoll());
    expect(cache.read("image:new")).toBeNull();
    expect(cache.read("analysis:project:second")).toBeNull();
    cache.record("image:new", { elapsed_seconds: 0 }, cache.beginPoll());
    expect(taskElapsedSeconds(cache.read("image:new"), 1000)).toBe(0);
    expect(taskElapsedSeconds(cache.read("image:old"), 1000)).toBe(49);
  });

  it("does not invent elapsed time before the backend has a timing measurement", () => {
    const cache = createTaskProgressCache({ now: () => 1000 });
    expect(taskElapsedSeconds(null, 9000)).toBeNull();
    for (const elapsed_seconds of [undefined, null, "10", NaN, Infinity, -1]) {
      cache.record("image:one", { phase: "Preparing runtime", elapsed_seconds }, cache.beginPoll());
      expect(taskElapsedSeconds(cache.read("image:one"), 9000)).toBeNull();
    }
  });

  it("clears completed or cancelled worker progress when the backend returns no active task", () => {
    const cache = createTaskProgressCache();
    cache.record("image:one", { elapsed_seconds: 35, step: 24 }, cache.beginPoll());
    cache.record("image:one", null, cache.beginPoll());
    expect(cache.read("image:one").progress).toBeNull();
    expect(taskElapsedSeconds(cache.read("image:one"))).toBeNull();
  });

  it("retains confirmed progress during a connection failure and resynchronizes on recovery", () => {
    const cache = createTaskProgressCache({ now: () => 1000 });
    cache.record("image:one", { elapsed_seconds: 38, step: 19 }, cache.beginPoll());
    cache.markUnavailable("image:one", cache.beginPoll());
    expect(cache.read("image:one").progress.step).toBe(19);
    expect(taskElapsedSeconds(cache.read("image:one"), 8000)).toBe(38);
    cache.record("image:one", { elapsed_seconds: 46, step: 23 }, cache.beginPoll());
    expect(cache.read("image:one").unavailable).toBe(false);
    expect(taskElapsedSeconds(cache.read("image:one"), 1000)).toBe(46);
  });

  it("does not let a delayed report from another view overwrite newer progress", () => {
    const cache = createTaskProgressCache();
    const earlier = cache.beginPoll();
    const later = cache.beginPoll();
    cache.record("image:one", { elapsed_seconds: 40, step: 22 }, later);
    cache.record("image:one", { elapsed_seconds: 38, step: 19 }, earlier);
    cache.markUnavailable("image:one", earlier);
    expect(cache.read("image:one").progress.step).toBe(22);
    expect(cache.read("image:one").unavailable).toBe(false);
  });

  it("bounds retained task history without evicting recently updated tasks", () => {
    const cache = createTaskProgressCache({ limit: 2 });
    cache.record("old", { elapsed_seconds: 1 }, cache.beginPoll());
    cache.record("active", { elapsed_seconds: 2 }, cache.beginPoll());
    cache.record("active", { elapsed_seconds: 3 }, cache.beginPoll());
    cache.record("new", { elapsed_seconds: 0 }, cache.beginPoll());
    expect(cache.read("old")).toBeNull();
    expect(cache.read("active").progress.elapsed_seconds).toBe(3);
    expect(cache.read("new").progress.elapsed_seconds).toBe(0);
  });
});

describe("progress display", () => {
  it("restores the image phase, step bar and elapsed clock immediately on remount", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    taskProgressCache.record("image:remount", { phase: "Generating image", step: 19, total_steps: 24, elapsed_seconds: 38 }, taskProgressCache.beginPoll());
    expect(renderToStaticMarkup(<ImageGenerationProgress requestId="remount" />)).toContain("38.0s elapsed");
    now.mockReturnValue(8000);
    const html = renderToStaticMarkup(<ImageGenerationProgress requestId="remount" />);
    expect(html).toContain("45.0s elapsed");
    expect(html).toContain("Generating image");
    expect(html).toContain('max="24" value="19"');
    expect(html).toContain("19/24 steps (79%)");
  });

  it("restores dataset analysis timing and gives the next run a fresh indicator", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    taskProgressCache.record("analysis:project:run-one", { elapsed_seconds: 65, completed: 4, total: 12, batch_size: 4 }, taskProgressCache.beginPoll());
    now.mockReturnValue(8000);
    const html = renderToStaticMarkup(<LoraAnalysisProgress projectId="project" requestId="run-one" total={12} />);
    expect(html).toContain("1m 12s elapsed");
    expect(html).toContain('value="4" max="12"');
    const next = renderToStaticMarkup(<LoraAnalysisProgress projectId="project" requestId="run-two" total={12} />);
    expect(next).toContain("Waiting for task timing");
    expect(next).not.toContain("1m 12s");
    expect(next).not.toContain('value="4"');
  });

  it("labels an unavailable reading as last reported instead of implying the task is still advancing", () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    taskProgressCache.record("image:offline", { elapsed_seconds: 38, step: 19, total_steps: 24 }, taskProgressCache.beginPoll());
    taskProgressCache.markUnavailable("image:offline", taskProgressCache.beginPoll());
    const html = renderToStaticMarkup(<ImageGenerationProgress requestId="offline" />);
    expect(html).toContain("38.0s at last update");
    expect(html).toContain("Showing last reported progress.");
    expect(html).toContain('value="19"');
  });
});
