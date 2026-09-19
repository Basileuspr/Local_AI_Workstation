import { describe, expect, it, vi } from "vitest";
import { browserFaceSource, scanFaceBatches } from "../../src/faceImport";
const files = count => Array.from({ length: count }, (_, i) => ({ name: `${i}.png`, size: 100 }));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

describe("face import batching", () => {
  it("scans 250 images in sequential 100/100/50 batches with cumulative progress", async () => {
    const source = browserFaceSource(files(250)); source.release = vi.fn();
    let run, active = false, count = 0;
    const api = {
      uploadImages: vi.fn(async (_dataset, batch) => {
        expect(active).toBe(false); active = true;
        run = { id: `run-${++count}`, status: "running", total: batch.length, processed: 0, faces: 0, errors: [] };
        return { ...run };
      }),
      getRun: vi.fn(async () => {
        expect(active).toBe(true); active = false;
        return { run: { ...run, status: "complete", processed: run.total, faces: run.total * 2 } };
      }), stopRun: vi.fn(),
    };
    const progress = [];
    const result = await scanFaceBatches({ datasetId: "dataset", source, api, onProgress: item => progress.push(item), pollInterval: 0 });
    expect(api.uploadImages.mock.calls.map(call => call[1].length)).toEqual([100, 100, 50]);
    expect(result).toMatchObject({ status: "complete", processed: 250, total: 250, faces: 500 });
    expect(progress.map(item => item.processed)).toEqual(progress.map(item => item.processed).sort((a, b) => a - b));
    expect(progress.every(item => item.total === 250)).toBe(true);
    expect(source.release).toHaveBeenCalledTimes(1); expect(api.stopRun).not.toHaveBeenCalled();
  });

  it("bounds bytes, counts skipped oversized files, and keeps processing valid files", async () => {
    const source = browserFaceSource([{ name: "big.png", size: 21 * 1024 ** 2 }, ...files(2).map(file => ({ ...file, size: 9 * 1024 ** 2 }))]);
    const api = { uploadImages: vi.fn(async (_id, batch) => ({ id: "run", status: "complete", processed: batch.length, faces: 1, errors: [] })) };
    const result = await scanFaceBatches({ datasetId: "dataset", source, api, onProgress() {} });
    expect(api.uploadImages.mock.calls.map(call => call[1].length)).toEqual([1, 1]);
    expect(result).toMatchObject({ status: "complete", processed: 3, total: 3, faces: 2, error_count: 1 });
    expect(result.errors[0].source).toBe("big.png");
  });

  it("Stop during an upload cancels the returned worker and never uploads the remaining batches", async () => {
    const gate = deferred(), controller = new AbortController(), source = browserFaceSource(files(250)); source.release = vi.fn();
    const api = { uploadImages: vi.fn(() => gate.promise), getRun: vi.fn(), stopRun: vi.fn(async () => ({ run: { id: "run", status: "cancelled", processed: 3, faces: 6 } })) };
    const work = scanFaceBatches({ datasetId: "dataset", source, api, signal: controller.signal, onProgress() {}, pollInterval: 0 });
    await vi.waitFor(() => expect(api.uploadImages).toHaveBeenCalledTimes(1));
    controller.abort(); gate.resolve({ id: "run", status: "running", processed: 0 });
    expect(await work).toMatchObject({ status: "cancelled", processed: 3, faces: 6 });
    expect(api.stopRun).toHaveBeenCalledWith("dataset", "run");
    expect(api.uploadImages).toHaveBeenCalledTimes(1); expect(api.getRun).not.toHaveBeenCalled(); expect(source.release).toHaveBeenCalledOnce();
  });

  it("Stop while buffering releases the grant without submitting a worker", async () => {
    const gate = deferred(), controller = new AbortController();
    const source = { total: 200, next: () => gate.promise, release: vi.fn() };
    const api = { uploadImages: vi.fn() };
    const work = scanFaceBatches({ datasetId: "dataset", source, api, signal: controller.signal, onProgress() {} });
    controller.abort(); gate.resolve({ files: files(100), consumed: 100, errors: [], done: false });
    expect(await work).toMatchObject({ status: "cancelled", processed: 0 });
    expect(api.uploadImages).not.toHaveBeenCalled(); expect(source.release).toHaveBeenCalledOnce();
  });

  it("a failed batch stops the import, releases resources and preserves the reported completed count", async () => {
    const source = browserFaceSource(files(250)); source.release = vi.fn();
    const api = { uploadImages: vi.fn().mockResolvedValueOnce({ id: "one", status: "complete", processed: 100, faces: 100 }).mockResolvedValueOnce({ id: "two", status: "error", processed: 12, faces: 9, message: "Detector failed" }) };
    const onProgress = vi.fn();
    await expect(scanFaceBatches({ datasetId: "dataset", source, api, onProgress })).rejects.toThrow("Detector failed");
    expect(api.uploadImages).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.lastCall[0]).toMatchObject({ status: "error", processed: 112, faces: 109 });
    expect(source.release).toHaveBeenCalledOnce();
  });

  it("keeps the total error count when worker error details are capped", async () => {
    const source = browserFaceSource(files(200));
    const api = { uploadImages: vi.fn(async () => ({ status: "complete", processed: 100, error_count: 100, errors: files(50).map(file => ({ source: file.name, error: "bad image" })) })) };
    const result = await scanFaceBatches({ datasetId: "dataset", source, api, onProgress() {} });
    expect(result.error_count).toBe(200); expect(result.errors).toHaveLength(100); expect(result.message).toContain("200 image(s) could not");
  });
});
