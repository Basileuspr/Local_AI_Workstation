import { afterEach, expect, it, vi } from "vitest";
import { finished, mediaUrl, observeJob, prepareImageShare, request, sharePreparedImage, submission } from "../../web/src/api";

afterEach(() => vi.unstubAllGlobals());
it("retries with the same ID and immutable body after an uncertain response", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue(new Response('{"status":"queued"}'));
  vi.stubGlobal("fetch", fetch);
  const payload = { prompt: "First prompt", session_id: "first" };
  const receipt = submission(payload, "same-id"); payload.prompt = "Changed";
  await expect(receipt.send()).rejects.toThrow("offline");
  await expect(receipt.send()).resolves.toEqual({ status: "queued" });
  expect(fetch.mock.calls[0][0]).toEqual(fetch.mock.calls[1][0]);
  expect(fetch.mock.calls[0][1].body).toEqual(fetch.mock.calls[1][1].body);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe("/api/jobs/same-id");
  expect(JSON.parse(options.body).prompt).toBe("First prompt");
  expect(options).toMatchObject({ credentials: "same-origin", cache: "no-store", headers: { "X-LAW-Mobile": "1" } });
});
it("preserves authorization and revision failures for the caller", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"detail":"Reload"}', { status: 409 })));
  await expect(request("/api/state")).rejects.toMatchObject({ status: 409, message: "Reload" });
  await expect(request("https://evil.example/api/state")).rejects.toThrow("Invalid");
});
it("streams snapshots and closes observers without sending cancellation", () => {
  let source;
  class FakeEvents { constructor(url) { this.url = url; this.close = vi.fn(); source = this; } }
  const onJob = vi.fn(), onError = vi.fn();
  const close = observeJob("job", onJob, onError, FakeEvents);
  source.onmessage({ data: '{"status":"running","text":"Hello"}' });
  expect(onJob).toHaveBeenCalledWith({ status: "running", text: "Hello" });
  source.onerror(); expect(onError).toHaveBeenCalled();
  expect(source.close).not.toHaveBeenCalled();
  source.onmessage({ data: '{"status":"completed"}' });
  expect(source.close).toHaveBeenCalledOnce(); close();
  expect(finished("interrupted")).toBe(true);
});
it("only accepts explicit mobile media paths for images and downloads", () => {
  expect(mediaUrl("/api/media/session/a/b/c", true)).toBe("/api/media/session/a/b/c?download=true");
  for (const value of ["https://evil.example/a", "/api/media/library/../private", "javascript:alert(1)", "/api/media/library/a?token=secret"]) expect(mediaUrl(value)).toBe("");
});
it("shares original file bytes and explains unsupported phone sharing", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("original", { headers: { "content-type": "image/png" } })));
  const share = vi.fn(); vi.stubGlobal("navigator", { canShare: () => true, share });
  const file = await prepareImageShare({ url: "/api/media/library/a", name: "Original.png" });
  expect(share).not.toHaveBeenCalled();
  await sharePreparedImage(file);
  expect(await share.mock.calls[0][0].files[0].text()).toBe("original");
  vi.stubGlobal("navigator", { canShare: () => false });
  await expect(prepareImageShare({ url: "/api/media/library/a" })).rejects.toThrow("Download original");
});
