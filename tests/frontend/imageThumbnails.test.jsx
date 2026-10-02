import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imagePreviewUrl, imageSourceUrl } from "../../src/imageSources";
import { createImagePrivacyLoader, privacyHashes } from "../../src/imagePrivacyLoader";
import ImageThumbnail, { isImageFile } from "../../src/components/ImageThumbnail";

const options = { base: "http://127.0.0.1:8000", token: "fixture credential" };
afterEach(() => vi.useRealTimers());
describe("thumbnail sources", () => {
  it("resolves relative and already-resolved URLs identically without duplicating credentials", () => {
    const once = imageSourceUrl("/image-library/images/a/content?v=2#preview", options);
    const twice = imageSourceUrl(once, options);
    expect(twice).toBe(once);
    expect(new URL(twice).searchParams.getAll("law_token")).toEqual([options.token]);
    expect(new URL(twice).hash).toBe("#preview");
  });
  it.each(["/sessions/a/images/by-id/b/c", "/sessions/a/images/0/0", "/image-library/images/a/content", "/web/images/a", "/faces/datasets/a/faces/b/crop", "/lora/projects/a/images/b", "/image-workflows/a/assets/b", "/image-workflows/a/jobs/b/outputs/c", "/image-workflows/a/jobs/b/stitched/grid", "/character-parts/datasets/a/sources/b/image", "/workspaces/converted/a"])("requests a small preview for %s while preserving full-resolution URLs", path => {
    expect(new URL(imagePreviewUrl(path, { ...options, thumbnail: true, retry: 2, privacy: 3 })).searchParams.get("thumbnail")).toBe("true");
    expect(new URL(imagePreviewUrl(path, options)).searchParams.has("thumbnail")).toBe(false);
  });
  it("preserves blob/data URLs and existing small thumbnail endpoints", () => {
    for (const source of ["blob:http://127.0.0.1:5284/id", "data:image/png;base64,AAAA"]) expect(imagePreviewUrl(source, { ...options, thumbnail: true, retry: 3 })).toBe(source);
    expect(new URL(imagePreviewUrl("/image-manager/images/a/thumbnail?v=2", { ...options, thumbnail: true })).searchParams.has("thumbnail")).toBe(false);
  });
  it("does not attach or forward app credentials to a different image origin", () => {
    const url = imagePreviewUrl("https://example.com/image.png?law_token=old&signed=valid", { ...options, thumbnail: true, retry: 4, privacy: 5 });
    expect(url).toBe("https://example.com/image.png?signed=valid");
    for (const source of ["javascript:alert(1)", "file:///C:/private.png", "http://user:pass@127.0.0.1:8000/image.png", "http://127.0.0.1:8000http://127.0.0.1:8000/image.png"]) expect(imageSourceUrl(source, options)).toBe("");
  });
  it("exposes a reserved preview box and loading state instead of an empty filename-only row", () => {
    const html = renderToStaticMarkup(<ImageThumbnail src="/image-library/images/a/content" alt="Recognizable image" />);
    expect(html).toContain('data-preview-state="loading"');
    expect(html).toContain('thumbnail=true');
    expect(html).toContain('alt="Recognizable image"');
    expect(html).toContain('Loading preview');
    expect(isImageFile({ type: "", name: "PHOTO.JPEG" })).toBe(true);
    expect(isImageFile({ type: "application/pdf", name: "report.pdf" })).toBe(false);
  });
});

describe("image-access recovery", () => {
  it("rejects missing or malformed privacy data instead of displaying unverified pixels", () => {
    for (const value of [{}, { locked_hashes: null }, { locked_hashes: [null] }, { locked_hashes: ["invalid"] }]) expect(() => privacyHashes(value)).toThrow();
    expect(privacyHashes({ locked_hashes: ["a".repeat(64), "a".repeat(64)] })).toHaveLength(1);
  });
  it("recovers automatically after a transient failure and stays hidden until validation succeeds", async () => {
    vi.useFakeTimers(); const publish = vi.fn();
    const read = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue({ locked_hashes: [] });
    const loader = createImagePrivacyLoader({ read, publish, retryDelays: [100] });
    loader.refresh(); await vi.advanceTimersByTimeAsync(0);
    expect(publish.mock.calls.every(([value]) => !value.ready)).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(publish).toHaveBeenLastCalledWith({ ready: true, hashes: [], error: "" });
    loader.dispose();
  });
  it("times out a hung request and offers explicit recovery with bounded automatic attempts", async () => {
    vi.useFakeTimers(); const publish = vi.fn(); const read = vi.fn(() => new Promise(() => {}));
    const loader = createImagePrivacyLoader({ read, publish, timeout: 50, retryDelays: [10] });
    loader.refresh(); await vi.advanceTimersByTimeAsync(200);
    expect(read).toHaveBeenCalledTimes(2);
    expect(publish.mock.lastCall[0]).toMatchObject({ ready: false, error: expect.stringContaining("Retry") });
    await vi.advanceTimersByTimeAsync(1000); expect(read).toHaveBeenCalledTimes(2);
    loader.dispose();
  });
  it("ignores superseded responses and cancels outstanding requests on disposal", async () => {
    vi.useFakeTimers(); const publish = vi.fn(); const pending = [];
    const read = vi.fn(signal => new Promise(resolve => pending.push({ signal, resolve })));
    const loader = createImagePrivacyLoader({ read, publish });
    loader.refresh(); loader.refresh();
    expect(pending[0].signal.aborted).toBe(true);
    pending[1].resolve({ locked_hashes: ["a".repeat(64)] }); await vi.advanceTimersByTimeAsync(0);
    pending[0].resolve({ locked_hashes: [] }); await vi.advanceTimersByTimeAsync(0);
    expect(publish.mock.lastCall[0].hashes).toEqual(["a".repeat(64)]);
    loader.refresh(); const count = publish.mock.calls.length; loader.dispose();
    expect(pending[2].signal.aborted).toBe(true);
    pending[2].resolve({ locked_hashes: [] }); await vi.advanceTimersByTimeAsync(20000);
    expect(publish).toHaveBeenCalledTimes(count);
  });
});
