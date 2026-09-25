import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clipboardFiles, pasteChatFiles } from "../../src/chatClipboard";
import { useChatUploads, MAX_IMAGE_BYTES } from "../../src/useChatUploads";
import * as api from "../../src/api";

const { state, dispatch } = vi.hoisted(() => ({
  state: { currentSessionId: "source-chat", conversationHistory: [], selectedModel: "test-model", sessionTitle: "Chat" },
  dispatch: vi.fn(),
}));
vi.mock("../../src/useStore.jsx", () => ({ useStore: () => state, useDispatch: () => dispatch }));
vi.mock("../../src/api", () => ({ appendSessionMessages: vi.fn(), parseFile: vi.fn() }));
const png = () => new File(["test pixels"], "image.png", { type: "image/png" });
const event = data => ({ clipboardData: data, preventDefault: vi.fn() });
function uploads(options) {
  let result;
  function Harness() { result = useChatUploads(options); return null; }
  renderToStaticMarkup(<Harness />);
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.currentSessionId = "source-chat";
  api.appendSessionMessages.mockImplementation(async (id, messages) => ({ id, messages, title: "Chat", memory_summary: "Retained memory", summarized_message_count: 2 }));
  vi.stubGlobal("FileReader", class {
    readAsDataURL() { this.result = "data:image/png;base64,QUJD"; this.onload(); }
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("clipboard paste", () => {
  it("leaves ordinary text and HTML paste entirely native", async () => {
    const e = event({ files: [], items: [{ kind: "string", type: "text/plain" }] });
    const upload = vi.fn();
    expect(await pasteChatFiles(e, { upload })).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
  it("reads a Windows image from items when files is empty", () => {
    const file = png();
    expect(clipboardFiles({ files: [], items: [{ kind: "file", getAsFile: () => file }] }).files).toEqual([file]);
  });
  it("does not upload the same image twice when both clipboard lists expose it", async () => {
    const file = png(), upload = vi.fn(async () => true);
    const e = event({ files: [file], items: [{ kind: "file", getAsFile: () => file }] });
    expect(await pasteChatFiles(e, { upload })).toBe(true);
    expect(upload).toHaveBeenCalledExactlyOnceWith([file]);
    expect(e.preventDefault).toHaveBeenCalledOnce();
  });
  it("captures files synchronously before the clipboard data becomes unavailable", async () => {
    const files = [png()], upload = vi.fn(async passed => passed.length === 1);
    const pending = pasteChatFiles(event({ files }), { upload });
    files.length = 0;
    expect(await pending).toBe(true);
  });
  it("explains unreadable clipboard file items", async () => {
    const onError = vi.fn(), upload = vi.fn();
    const e = event({ items: [{ kind: "file", getAsFile: () => null }] });
    expect(await pasteChatFiles(e, { upload, onError })).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("could not be read"));
    expect(upload).not.toHaveBeenCalled();
  });
  it("reports busy paste without starting another upload or replacing draft text", async () => {
    const onError = vi.fn(), upload = vi.fn();
    expect(await pasteChatFiles(event({ files: [png()] }), { busy: true, upload, onError })).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("paste again"));
    expect(upload).not.toHaveBeenCalled();
  });
  it("reports unexpected failures instead of an unhandled rejection", async () => {
    const onError = vi.fn();
    expect(await pasteChatFiles(event({ files: [png()] }), { upload: async () => { throw new Error("offline"); }, onError })).toBe(false);
    expect(onError).toHaveBeenCalledWith("Clipboard attachment failed: offline");
  });
});

describe("clipboard attachment persistence", () => {
  it("saves image bytes once, then displays the saved reference and keeps server memory", async () => {
    const existing = { id: "concurrent-reply", role: "assistant", content: "Another result" };
    api.appendSessionMessages.mockImplementationOnce(async (id, messages) => ({ id, title: "Chat", messages: [existing, { ...messages[0], images: ["stored:abc"] }], memory_summary: "Current memory", summarized_message_count: 5 }));
    const onSuccess = vi.fn();
    await uploads().uploadFiles([png()], { onSuccess });
    expect(api.appendSessionMessages).toHaveBeenCalledWith("source-chat", [expect.objectContaining({ role: "user", images: ["QUJD"] })], "test-model");
    const session = dispatch.mock.calls.find(([a]) => a.type === "SET_SESSION")[0].payload;
    expect(session.messages[0]).toEqual(existing);
    expect(session.messages[1].images).toEqual(["stored:abc"]);
    expect(session.memorySummary).toBe("Current memory");
    expect(session.summarizedMessageCount).toBe(5);
    expect(onSuccess).toHaveBeenCalledOnce();
  });
  it("does not display a successful attachment when saving fails", async () => {
    api.appendSessionMessages.mockRejectedValueOnce(new Error("Disk full"));
    const onError = vi.fn(), onSuccess = vi.fn();
    expect(await uploads().uploadFiles([png()], { onError, onSuccess })).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Disk full" }), expect.any(File));
  });
  it("preserves every file in a mixed clipboard batch", async () => {
    api.parseFile.mockResolvedValueOnce({ filename: "notes.txt", char_count: 5, text: "notes" });
    expect(await uploads().uploadFiles([png(), new File(["notes"], "notes.txt", { type: "text/plain" })])).toBe(true);
    expect(api.appendSessionMessages).toHaveBeenCalledTimes(2);
    expect(api.parseFile).toHaveBeenCalledOnce();
  });
  it("rejects oversize screenshots and unsupported image types without sending bytes", async () => {
    const onError = vi.fn();
    expect(await uploads().uploadFiles([{ type: "image/png", size: MAX_IMAGE_BYTES + 1 }, { type: "image/svg+xml" }], { onError })).toBe(false);
    expect(api.appendSessionMessages).not.toHaveBeenCalled();
    expect(api.parseFile).not.toHaveBeenCalled();
    expect(onError.mock.calls.map(([error]) => error.message)).toEqual(["Image is larger than 10 MB", "Unsupported image format. Paste a PNG, JPEG, or WebP image."]);
  });
  it("does not silently drop a second paste while saving the first", async () => {
    let release;
    api.appendSessionMessages.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const hook = uploads(), onError = vi.fn();
    const first = hook.uploadFiles([png()]);
    expect(await hook.uploadFiles([png()], { onError })).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ userFacing: true, message: expect.stringContaining("already being saved") }), expect.any(File));
    release({ id: "source-chat", messages: [], title: "Chat" });
    await first;
  });
  it("reports session creation failures", async () => {
    state.currentSessionId = null;
    const onError = vi.fn();
    expect(await uploads({ onNewChat: async () => { throw new Error("Backend unavailable"); } }).uploadFiles([png()], { onError })).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Backend unavailable" }), expect.any(File));
  });
});
