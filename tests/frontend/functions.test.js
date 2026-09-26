import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { appTabs } from "../../src/navigation";
import { captureActions, functionTargets, loadFunctionButtons, saveFunctionButtons } from "../../src/functionButtons";
import { queueDestination } from "../../src/queueNavigation";
const require = createRequire(import.meta.url);
const { runDesktopAction, writeClipboardImage, copyNativeImage } = require("../../electron/desktopFunctions");
const { TAB_LABELS } = require("../../electron/tabCapture");
afterEach(() => vi.unstubAllGlobals());

describe("Functions actions", () => {
  it("covers every registered tab in the desktop and custom-button menus", () => {
    expect(captureActions.map(action => action.id)).toEqual(appTabs.map(tab => `capture:${tab}`));
    expect(Object.keys(TAB_LABELS).sort()).toEqual([...appTabs].sort());
    for (const action of captureActions) expect(functionTargets).toContainEqual(action);
  });
  it("persists action shortcuts without losing old navigation shortcuts", () => {
    const values = new Map();
    vi.stubGlobal("localStorage", { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) });
    saveFunctionButtons([{ id: "old", name: "Z tool", target: "image-editor" }, { id: "new", name: "A capture", target: "capture:chats" }]);
    expect(loadFunctionButtons().map(button => button.id)).toEqual(["new", "old"]);
    expect(() => saveFunctionButtons([{ id: "bad", name: "Command", target: "system:arbitrary" }])).toThrow();
    expect(loadFunctionButtons()).toHaveLength(2);
  });
  it("rejects arbitrary commands and non-Windows execution", async () => {
    const execute = vi.fn();
    await expect(runDesktopAction("update-programs & whoami", { execute, platform: "win32" })).rejects.toThrow("Unknown");
    await expect(runDesktopAction("update-programs", { execute, platform: "linux" })).rejects.toThrow("Windows");
    expect(execute).not.toHaveBeenCalled();
  });
  it("opens PowerShell by its known absolute path even without PATH", async () => {
    const execute = vi.fn((_file, _args, _options, done) => done(null));
    await runDesktopAction("open-powershell", { execute, platform: "win32", environment: {} });
    const [executable, args] = execute.mock.calls[0];
    expect(args.at(-1)).toContain(`Start-Process -FilePath '${executable}'`);
    expect(args.at(-1)).toContain("-NoProfile -NoExit");
  });
  it("launches only fixed commands, hiding the helper process", async () => {
    const execute = vi.fn((_file, _args, _options, done) => done(null));
    await runDesktopAction("update-programs", { execute, platform: "win32" });
    const launch = execute.mock.calls[0][1].at(-1);
    const encoded = launch.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)[1];
    expect(Buffer.from(encoded, "base64").toString("utf16le")).toContain("upgrade --all");
    expect(launch).toContain("-NoExit");
    expect(execute.mock.calls[0][2].windowsHide).toBe(true);
    await runDesktopAction("refresh-graphics", { execute, platform: "win32" });
    expect(execute.mock.calls[1][1].at(-1)).toMatch(/refreshGraphics.ps1$/);
  });
  it("rejects non-images and never clears the clipboard on decode failure", async () => {
    const clipboard = { writeImage: vi.fn() }, nativeImage = { createFromDataURL: () => ({ isEmpty: () => true }) };
    await expect(writeClipboardImage("file:///private", { clipboard, nativeImage })).rejects.toThrow();
    await expect(writeClipboardImage("data:image/png;base64,bad", { clipboard, nativeImage })).rejects.toThrow();
    expect(clipboard.writeImage).not.toHaveBeenCalled();
  });
  it("awaits modern clipboard writes and propagates write failures", async () => {
    let finish;
    const clipboard = { write: vi.fn(() => new Promise(resolve => { finish = resolve; })) };
    class ClipboardItem { constructor(data) { this.data = data; } }
    const image = { toPNG: () => new Uint8Array([1, 2, 3]) };
    let completed = false;
    const pending = copyNativeImage(image, { clipboard, ClipboardItem }).then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(clipboard.write.mock.calls[0][0][0].data["image/png"].type).toBe("image/png");
    finish();
    await pending;
    expect(completed).toBe(true);
    clipboard.write.mockRejectedValueOnce(new Error("Clipboard busy"));
    await expect(copyNativeImage(image, { clipboard, ClipboardItem })).rejects.toThrow("Clipboard busy");
  });
});

describe("queue destinations", () => {
  it.each(["chat", "image", "compact"])("opens the source chat for %s", kind => {
    expect(queueDestination({ kind, session_id: "source", request_id: "request" })).toMatchObject({ tab: "chats", sessionId: "source" });
  });
  it("opens exact workflow, LoRA and character datasets", () => {
    expect(queueDestination({ kind: "workflow", project_id: "workflow" })).toMatchObject({ tab: "workflows", workflowId: "workflow" });
    expect(queueDestination({ kind: "training", project_id: "lora" })).toEqual({ tab: "lora", projectId: "lora" });
    expect(queueDestination({ kind: "character-parts", project_id: "parts" })).toEqual({ tab: "character-parts", datasetId: "parts" });
    expect(queueDestination({ kind: "unknown" })).toBeNull();
  });
});
