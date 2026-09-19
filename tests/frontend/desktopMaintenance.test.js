import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { pickFiles } = require("../../electron/filePicker");
const { createMaintenance } = require("../../electron/maintenance");

describe("fresh upload chooser", () => {
  it("uses the home folder on every selection, preserving multi-select without returning paths", async () => {
    const dialog = vi.fn().mockResolvedValue({ canceled: false, filePaths: ["C:\\private\\one.png", "C:\\private\\two.jpg"] });
    const deps = { home: "C:\\Users\\Test", showDialog: dialog, stat: async () => ({ isFile: () => true, size: 3, mtimeMs: 100 }), readFile: async () => Buffer.from([1, 2, 3]) };
    for (let n = 0; n < 2; n++) {
      const result = await pickFiles({ accept: "image/png,.jpg", multiple: true }, deps);
      expect(result.files.map(item => item.name)).toEqual(["one.png", "two.jpg"]);
      expect(JSON.stringify(result)).not.toContain("private");
      expect(result.files[0].bytes.length).toBe(3);
    }
    for (const [options] of dialog.mock.calls) {
      expect(options.defaultPath).toBe(deps.home);
      expect(options.properties).toEqual(["openFile", "dontAddToRecent", "multiSelections"]);
    }
  });
  it("does not read files on cancel, rejects unsupported types and oversized batches", async () => {
    const readFile = vi.fn();
    const deps = { home: "C:\\", readFile, showDialog: async () => ({ canceled: true }) };
    expect((await pickFiles({ accept: "image/png" }, deps)).canceled).toBe(true);
    expect(readFile).not.toHaveBeenCalled();
    await expect(pickFiles({ accept: ".exe" }, deps)).rejects.toThrow("Unsupported");
    deps.showDialog = async () => ({ filePaths: ["C:\\a.exe"] });
    await expect(pickFiles({ accept: "image/png" }, deps)).rejects.toThrow("unsupported");
    deps.showDialog = async () => ({ filePaths: Array(101).fill("C:\\a.png") });
    await expect(pickFiles({ accept: "image/png", multiple: true }, deps)).rejects.toThrow("100 files");
    expect(readFile).not.toHaveBeenCalled();
  });
  it("reads one folder's own images and never walks into subfolders", async () => {
    const dialog = vi.fn().mockResolvedValue({ canceled: false, filePaths: ["C:\\shoot"] });
    const deps = {
      home: "C:\\Users\\Test", showDialog: dialog,
      readDir: async () => ["b.jpg", "notes.txt", "a.png", "nested"],
      stat: async () => ({ isFile: () => true, size: 3, mtimeMs: 1 }),
      readFile: async () => Buffer.from([1, 2, 3]),
    };
    const result = await pickFiles({ accept: "image/*", multiple: true, directory: true }, deps);
    // Sorted, image types only; "nested" and "notes.txt" are not images.
    expect(result.files.map(item => item.name)).toEqual(["a.png", "b.jpg"]);
    expect(dialog.mock.calls[0][0].properties).toEqual(["openDirectory", "dontAddToRecent"]);
    expect(dialog.mock.calls[0][0].defaultPath).toBe(deps.home);
  });
  it("reports an empty folder instead of starting a pointless scan", async () => {
    const deps = {
      home: "C:\\", showDialog: async () => ({ canceled: false, filePaths: ["C:\\empty"] }),
      readDir: async () => ["readme.txt"], readFile: vi.fn(),
    };
    await expect(pickFiles({ accept: "image/*", multiple: true, directory: true }, deps))
      .rejects.toThrow("no supported images");
    expect(deps.readFile).not.toHaveBeenCalled();
  });
});

function fixture() {
  const deps = {
    chooseArchive: vi.fn(async () => ({ filePath: "C:\\inventory.zip" })),
    run: vi.fn(async request => request.action === "export" ? { archive: "C:\\inventory.zip", sha256: "digest", report: {} } : request.action === "recovery" ? { pending: false } : { ok: true }),
    ownsBackend: vi.fn(() => true), backendHealthy: vi.fn(async () => false),
    checkRenderer: vi.fn(async () => {}), lockBackend: vi.fn(async () => {}), stopBackend: vi.fn(async () => {}),
    unlockBackend: vi.fn(async () => {}), clearRenderer: vi.fn(async () => {}), clearCache: vi.fn(async () => {}), startBackend: vi.fn(async () => {}), notifyComplete: vi.fn(), notifyFailure: vi.fn(),
  };
  return { deps, controller: createMaintenance(deps) };
}

describe("desktop reset lifecycle", () => {
  it("requires a successfully saved ZIP ticket and exact confirmation", async () => {
    const { controller, deps } = fixture();
    expect((await controller.reset({ confirmation: "RESET" })).error).toBeTruthy();
    const saved = await controller.exportInventory();
    expect((await controller.reset({ ticket: saved.ticket, confirmation: "reset" })).error).toBeTruthy();
    expect(deps.stopBackend).not.toHaveBeenCalled();
  });
  it("never resets after archive cancellation or a failed write", async () => {
    const { controller, deps } = fixture();
    deps.chooseArchive.mockResolvedValue({ canceled: true });
    expect(await controller.exportInventory()).toEqual({ canceled: true });
    expect(deps.run).not.toHaveBeenCalled();
    deps.chooseArchive.mockResolvedValue({ filePath: "C:\\inventory.zip" });
    deps.run.mockRejectedValue(new Error("disk full"));
    expect((await controller.exportInventory()).error).toBe("disk full");
    expect((await controller.reset({ confirmation: "RESET" })).error).toBeTruthy();
    expect(deps.stopBackend).not.toHaveBeenCalled();
  });
  it("stops and awaits the backend before deleting, then clears UI/cache before reopening", async () => {
    const { controller, deps } = fixture();
    const saved = await controller.exportInventory();
    expect(await controller.reset({ ticket: saved.ticket, confirmation: "RESET" })).toEqual({ ok: true });
    const order = fn => fn.mock.invocationCallOrder[0];
    expect(order(deps.lockBackend)).toBeLessThan(order(deps.stopBackend));
    expect(order(deps.stopBackend)).toBeLessThan(deps.run.mock.invocationCallOrder[1]);
    expect(deps.run.mock.invocationCallOrder[1]).toBeLessThan(order(deps.clearRenderer));
    expect(order(deps.clearCache)).toBeLessThan(order(deps.startBackend));
    expect(order(deps.startBackend)).toBeLessThan(order(deps.notifyComplete));
    expect((await controller.reset({ ticket: saved.ticket, confirmation: "RESET" })).error).toBeTruthy();
  });
  it("leaves running work untouched and refuses a separately owned backend", async () => {
    const { controller, deps } = fixture();
    const saved = await controller.exportInventory();
    deps.lockBackend.mockRejectedValue(new Error("work active"));
    expect((await controller.reset({ ticket: saved.ticket, confirmation: "RESET" })).error).toBe("work active");
    expect(deps.stopBackend).not.toHaveBeenCalled();
    deps.ownsBackend.mockReturnValue(false);
    deps.backendHealthy.mockResolvedValue(true);
    expect((await controller.reset({ ticket: saved.ticket, confirmation: "RESET" })).error).toContain("separately");
    expect(deps.run.mock.calls.some(([request]) => request.action === "reset")).toBe(false);
  });
  it("keeps the backend stopped after partial cleanup and permits retry", async () => {
    const { controller, deps } = fixture();
    const saved = await controller.exportInventory();
    deps.run.mockRejectedValueOnce(new Error("incomplete"));
    expect((await controller.reset({ ticket: saved.ticket, confirmation: "RESET" })).backendStopped).toBe(true);
    expect(deps.startBackend).not.toHaveBeenCalled();
    deps.ownsBackend.mockReturnValue(false);
    expect((await controller.reset({ ticket: saved.ticket, confirmation: "RESET" })).ok).toBe(true);
  });
});
