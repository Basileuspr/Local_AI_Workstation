import { describe, expect, it } from "vitest";
import { activeImageRequests, imageRemainingSeconds, formatImageEstimate } from "../../src/imageProgress";

describe("Generate active progress", () => {
  it('does not resurrect completed slots from a stale queue or hide inference behind saving', () => {
    const requests = [{id:'saving',status:'saving'},{id:'next',status:'running',batchLabel:'Image 2 of 3'}];
    const jobs = ['done','saving','next'].map(request_id => ({request_id,kind:'image',status:'running'}));
    expect(activeImageRequests(requests,jobs,['done']).map(row => [row.id,row.status])).toEqual([['next','running'],['saving','saving']]);
    expect(activeImageRequests([],jobs,['done','saving','next'])).toEqual([]);
  });
  it("selects the running image ahead of waiting requests and deduplicates the queue", () => {
    const requests = [{ id: "waiting" }, { id: "running" }];
    const jobs = [{ request_id: "waiting", kind: "image", status: "queued" }, { request_id: "running", kind: "image", status: "running" }];
    expect(activeImageRequests(requests, jobs).map(item => item.id)).toEqual(["running", "waiting"]);
  });
  it("finds backend image work even when the local request list is empty", () => {
    const jobs = [{ request_id: "live", label: "Image", kind: "image", status: "running" },
      { request_id: "old", kind: "image", status: "completed" }, { request_id: "chat", kind: "chat", status: "running" }];
    expect(activeImageRequests([], jobs)).toEqual([{ id: "live", prompt: "Image", status: "running", position: undefined }]);
  });
  it("counts down a measured estimate without folding model loading into denoising", () => {
    expect(imageRemainingSeconds({ step: 8, total_steps: 24, elapsed_seconds: 110, estimated_remaining_seconds: 28 }, 113)).toBe(25);
    expect(imageRemainingSeconds({ step: 8, total_steps: 24, elapsed_seconds: 110, estimated_remaining_seconds: 28 }, 150)).toBe(0);
    expect(formatImageEstimate(65)).toBe("Estimated 1m 5s remaining");
    expect(formatImageEstimate(0)).toContain("Re-estimating");
  });
  it("can estimate from older backend timing, but not queued or completed jobs", () => {
    expect(imageRemainingSeconds({ step: 12, total_steps: 24, elapsed_seconds: 60 }, 60)).toBe(60);
    for (const progress of [null, { step: 0, total_steps: 24 }, { step: 24, total_steps: 24 }, { step: 2, total_steps: 24 }]) {
      expect(imageRemainingSeconds(progress, 10)).toBeNull();
    }
  });
});
