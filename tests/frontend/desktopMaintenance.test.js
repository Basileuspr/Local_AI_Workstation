import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { pickFiles } = require("../../electron/filePicker");
const { createMaintenance } = require("../../electron/maintenance");
const { clearDesktopStorage } = require("../../electron/maintenanceStorage");

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
    readStorage: vi.fn(async () => ({preferences: "private"})), freezeRenderer: vi.fn(async () => {}), thawRenderer: vi.fn(async () => {}),
    ownsBackend: vi.fn(() => true), backendHealthy: vi.fn(async () => false),
    checkRenderer: vi.fn(async () => {}), lockBackend: vi.fn(async () => {}), stopBackend: vi.fn(async () => {}),
    unlockBackend: vi.fn(async () => {}), clearRenderer: vi.fn(async () => {}), clearCache: vi.fn(async () => {}), startBackend: vi.fn(async () => {}), notifyComplete: vi.fn(), notifyFailure: vi.fn(),
  };
  return { deps, controller: createMaintenance(deps) };
}

describe("desktop reset lifecycle", () => {
  it("restores preferences as string data, including Unicode and script-like values, after clearing old state", async () => {
    const local = new Map([["old", "remove"]]);
    const temporary = new Map([["draft", "remove"]]);
    const storage = values => ({clear: () => values.clear(), setItem: (key, value) => values.set(key, value)});
    const context = {localStorage: storage(local), sessionStorage: storage(temporary), Event: class {}, window: {dispatchEvent: () => {}}};
    const contents = {executeJavaScript: async script => runInNewContext(script, context), session: {clearStorageData: async () => local.clear()}};
    const restored = JSON.parse('{"__proto__":"literal key","buttons":"café 🎨","payload":"\\\"}; globalThis.executed = true; //"}');
    await clearDesktopStorage(contents, restored, "Imported backup");
    for (const [key, value] of Object.entries(restored)) expect(local.get(key)).toBe(value);
    expect(local.has("old")).toBe(false);
    expect(local.get("app-reset-notice")).toBe("Imported backup");
    expect(temporary.size).toBe(0);
    expect(context.executed).toBeUndefined();
  });
  it("clears current and legacy browser data after unmount, leaving only nonpersonal reset markers", async () => {
    const local = new Map([["prompt-phrases", "personal"], ["preferences", "personal"]]);
    const session = new Map([["draft", "private"]]);
    const legacy = new Map([["preferences", "old private buttons"]]);
    const storage = values => ({clear: () => values.clear(), setItem: (k, v) => values.set(k, v)});
    const events = [];
    const context = {localStorage: storage(local), sessionStorage: storage(session), Event: class {constructor(type) {this.type = type;}}, window: {dispatchEvent: event => {events.push(event.type); local.set("cleanup-write", "private");}}};
    const contents = {
      executeJavaScript: async script => runInNewContext(script, context),
      session: {clearStorageData: async () => {expect(events).toEqual(["app-data-reset"]); expect(local.size).toBe(0); local.clear(); legacy.clear();}},
    };
    await clearDesktopStorage(contents);
    expect([...local.keys()].sort()).toEqual(["app-reset-notice", "law-app-origin-migrated-v1"]);
    expect(session.size).toBe(0);
    expect(legacy.size).toBe(0);
  });
  it("does not release the reset marker or restart if desktop storage cleanup fails", async () => {
    const { controller, deps } = fixture();
    const saved = await controller.prepareReset();
    deps.clearRenderer.mockRejectedValue(new Error("profile locked"));
    expect((await controller.reset({ticket: saved.ticket, confirmation: "RESET"})).backendStopped).toBe(true);
    expect(deps.run.mock.calls.some(([request]) => request.action === "finish-reset")).toBe(false);
    expect(deps.startBackend).not.toHaveBeenCalled();
  });
  it("metadata export does not authorize reset or stop the backend", async () => {
    const { controller, deps } = fixture();
    const saved = await controller.exportInventory();
    expect(saved.ticket).toBeUndefined();
    expect((await controller.reset({ ticket: saved.ticket, confirmation: "RESET" })).error).toBeTruthy();
    expect(deps.stopBackend).not.toHaveBeenCalled();
  });
  it("requires a reviewed reset ticket and exact confirmation", async () => {
    const { controller, deps } = fixture();
    expect((await controller.reset({ confirmation: "RESET" })).error).toBeTruthy();
    const saved = await controller.prepareReset();
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
    const saved = await controller.prepareReset();
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
    const saved = await controller.prepareReset();
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
    const saved = await controller.prepareReset();
    deps.run.mockRejectedValueOnce(new Error("incomplete"));
    expect((await controller.reset({ ticket: saved.ticket, confirmation: "RESET" })).backendStopped).toBe(true);
    expect(deps.startBackend).not.toHaveBeenCalled();
    deps.ownsBackend.mockReturnValue(false);
    expect((await controller.reset({ ticket: saved.ticket, confirmation: "RESET" })).ok).toBe(true);
  });
});

function importFixture() {
  const result = fixture();
  result.deps.chooseImport = vi.fn(async () => ({filePaths: ["C:\\backup.zip"]}));
  result.deps.restoreRenderer = vi.fn(async () => {});
  result.deps.run.mockImplementation(async request => {
    if (request.action === "import-status") return {pending: false};
    if (request.action === "inspect-backup") return {archive: "C:\\backup.zip", sha256: "bound-digest", report: {files: 2, bytes: 100, created_at: "today"}};
    if (request.action === "import-backup") return {ok: true, desktop_storage: {buttons: "imported"}, recovery: "C:\\recovery"};
    if (request.action === "rollback-import") return {pending: true, desktop_storage: {preferences: "old"}};
    return {ok: true};
  });
  return result;
}

describe("desktop backup import lifecycle", () => {
  it("binds review to a main-process archive/hash ticket and replaces storage before restart", async () => {
    const {controller, deps} = importFixture();
    const reviewed = await controller.prepareImport();
    expect(reviewed.sha256).toBeUndefined();
    expect(deps.stopBackend).not.toHaveBeenCalled();
    const result = await controller.importBackup({ticket: reviewed.ticket, confirmation: "IMPORT", archive: "C:\\injected.zip"});
    expect(result).toEqual({ok: true, recovery: "C:\\recovery"});
    expect(deps.run).toHaveBeenCalledWith({action: "import-backup", archive: "C:\\backup.zip", sha256: "bound-digest", confirmation: "IMPORT", previous_storage: {preferences: "private"}});
    const actions = deps.run.mock.calls.map(([request]) => request.action);
    const importOrder = deps.run.mock.invocationCallOrder[actions.indexOf("import-backup")];
    const finishOrder = deps.run.mock.invocationCallOrder[actions.indexOf("finish-import")];
    expect(deps.stopBackend.mock.invocationCallOrder[0]).toBeLessThan(importOrder);
    expect(importOrder).toBeLessThan(deps.restoreRenderer.mock.invocationCallOrder[0]);
    expect(deps.restoreRenderer.mock.invocationCallOrder[0]).toBeLessThan(finishOrder);
    expect(finishOrder).toBeLessThan(deps.startBackend.mock.invocationCallOrder[0]);
    expect(deps.restoreRenderer).toHaveBeenCalledWith({buttons: "imported"}, expect.stringContaining("C:\\recovery"));
    expect(deps.notifyComplete).toHaveBeenCalledOnce();
    expect((await controller.importBackup({ticket: reviewed.ticket, confirmation: "IMPORT"})).error).toBeTruthy();
  });
  it("requires explicit confirmation and invalidates an earlier ticket when a new selection is canceled", async () => {
    const {controller, deps} = importFixture();
    const reviewed = await controller.prepareImport();
    for (const confirmation of [undefined, "import", "RESET"]) expect((await controller.importBackup({ticket: reviewed.ticket, confirmation})).error).toBeTruthy();
    deps.chooseImport.mockResolvedValue({canceled: true});
    expect(await controller.prepareImport()).toEqual({canceled: true});
    expect((await controller.importBackup({ticket: reviewed.ticket, confirmation: "IMPORT"})).error).toBeTruthy();
    expect(deps.stopBackend).not.toHaveBeenCalled();
  });
  it("refuses queued work or a backend owned by another process", async () => {
    const {controller, deps} = importFixture();
    const reviewed = await controller.prepareImport();
    deps.lockBackend.mockRejectedValue(new Error("work active"));
    expect((await controller.importBackup({ticket: reviewed.ticket, confirmation: "IMPORT"})).error).toBe("work active");
    deps.ownsBackend.mockReturnValue(false);
    expect((await controller.importBackup({ticket: reviewed.ticket, confirmation: "IMPORT"})).error).toContain("this desktop");
    expect(deps.stopBackend).not.toHaveBeenCalled();
  });
  it("restores previous data and preferences after a desktop storage failure", async () => {
    const {controller, deps} = importFixture();
    const reviewed = await controller.prepareImport();
    deps.restoreRenderer.mockRejectedValueOnce(new Error("profile full"));
    const result = await controller.importBackup({ticket: reviewed.ticket, confirmation: "IMPORT"});
    expect(result.error).toBe("profile full");
    expect(result.backendStopped).toBe(false);
    expect(deps.run).toHaveBeenCalledWith({action: "rollback-import"});
    expect(deps.restoreRenderer).toHaveBeenLastCalledWith({preferences: "old"}, expect.stringContaining("recovered"));
    expect(deps.startBackend).toHaveBeenCalledOnce();
    expect(deps.notifyComplete).toHaveBeenCalledOnce();
  });
  it("keeps the backend stopped when rollback cannot complete", async () => {
    const {controller, deps} = importFixture();
    const reviewed = await controller.prepareImport();
    deps.restoreRenderer.mockRejectedValue(new Error("profile locked"));
    const result = await controller.importBackup({ticket: reviewed.ticket, confirmation: "IMPORT"});
    expect(result.error).toContain("Recover previous data");
    expect(result.backendStopped).toBe(true);
    expect(deps.run.mock.calls.some(([request]) => request.action === "finish-import")).toBe(false);
    expect(deps.startBackend).not.toHaveBeenCalled();
  });
  it("can recover a journal from a previous desktop launch", async () => {
    const {controller, deps} = importFixture();
    deps.ownsBackend.mockReturnValue(false);
    expect(await controller.recoverImport()).toEqual({ok: true});
    expect(deps.restoreRenderer).toHaveBeenCalledWith({preferences: "old"}, expect.stringContaining("recovered"));
    expect(deps.run).toHaveBeenCalledWith({action: "finish-import"});
    expect(deps.startBackend).toHaveBeenCalledOnce();
  });
  it("reports restart failure with the retained recovery location after completed import", async () => {
    const {controller, deps} = importFixture();
    const reviewed = await controller.prepareImport();
    deps.startBackend.mockRejectedValue(new Error("startup failed"));
    const result = await controller.importBackup({ticket: reviewed.ticket, confirmation: "IMPORT"});
    expect(result.error).toContain("C:\\recovery");
    expect(result.error).toContain("startup failed");
    expect(deps.run.mock.calls.some(([request]) => request.action === "rollback-import")).toBe(false);
  });
});

describe("desktop backup lifecycle", () => {
  it("captures private data only after quiescing and stopping, then restarts without clearing", async () => {
    const { controller, deps } = fixture();
    await controller.exportBackup();
    const order = fn => fn.mock.invocationCallOrder[0];
    expect(order(deps.lockBackend)).toBeLessThan(order(deps.stopBackend));
    expect(order(deps.stopBackend)).toBeLessThan(order(deps.readStorage));
    expect(order(deps.readStorage)).toBeLessThan(order(deps.run));
    expect(deps.run).toHaveBeenCalledWith({action: "backup", destination: "C:\\inventory.zip", desktop_storage: {preferences: "private"}});
    expect(order(deps.run)).toBeLessThan(order(deps.startBackend));
    expect(order(deps.startBackend)).toBeLessThan(order(deps.thawRenderer));
    expect(deps.clearRenderer).not.toHaveBeenCalled();
    expect(deps.clearCache).not.toHaveBeenCalled();
  });
  it("cancellation and busy jobs never stop the backend", async () => {
    const { controller, deps } = fixture();
    deps.chooseArchive.mockResolvedValueOnce({canceled: true});
    expect(await controller.exportBackup()).toEqual({canceled: true});
    deps.lockBackend.mockRejectedValue(new Error("work active"));
    expect((await controller.exportBackup()).error).toBe("work active");
    expect(deps.run).not.toHaveBeenCalled();
    expect(deps.stopBackend).not.toHaveBeenCalled();
  });
  it("restarts and releases the UI after backup failure and reports restart failures", async () => {
    const { controller, deps } = fixture();
    deps.run.mockRejectedValue(new Error("disk full"));
    expect((await controller.exportBackup()).error).toBe("disk full");
    expect(deps.startBackend).toHaveBeenCalledOnce();
    expect(deps.thawRenderer).toHaveBeenCalledOnce();
    deps.startBackend.mockRejectedValue(new Error("restart failed"));
    const result = await controller.exportBackup();
    expect(result.error).toContain("disk full");
    expect(result.error).toContain("restart failed");
    expect(result.backendStopped).toBe(true);
  });
});
