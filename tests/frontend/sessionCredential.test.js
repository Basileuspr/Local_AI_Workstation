import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resolveApiBase, resolveApiToken } from "../../src/config";

describe("session credential plumbing", () => {
  it("reads the per-launch credential Electron puts in the page URL", () => {
    expect(resolveApiToken(new URLSearchParams("apiPort=8000&apiToken=abc123"))).toBe("abc123");
  });

  it("has no credential when the page was not launched by the app", () => {
    expect(resolveApiToken(new URLSearchParams("apiPort=8000"))).toBe("");
    expect(resolveApiToken(null)).toBe("");
  });

  it("still resolves the backend port independently of the credential", () => {
    expect(resolveApiBase(new URLSearchParams("apiPort=8123&apiToken=x"))).toBe("http://127.0.0.1:8123");
  });
});

describe("apiUrl", () => {
  const load = async (search) => {
    vi.resetModules();
    vi.stubGlobal("window", { location: { search } });
    return await import("../../src/api.js");
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("attaches the credential to every backend URL", async () => {
    const api = await load("?apiPort=8000&apiToken=tok-1");
    expect(api.apiUrl("/sessions/list")).toBe("http://127.0.0.1:8000/sessions/list?law_token=tok-1");
  });

  it("appends correctly to a URL that already has a query", async () => {
    const api = await load("?apiPort=8000&apiToken=tok-1");
    expect(api.apiUrl("/faces/x/crop?v=2")).toBe("http://127.0.0.1:8000/faces/x/crop?v=2&law_token=tok-1");
  });

  it("percent-encodes the credential", async () => {
    const api = await load("?apiPort=8000&apiToken=a%2Bb%2Fc");
    expect(api.apiUrl("/x")).toBe("http://127.0.0.1:8000/x?law_token=a%2Bb%2Fc");
  });

  it("adds nothing when there is no credential, so a browser build still builds URLs", async () => {
    const api = await load("?apiPort=8000");
    expect(api.apiUrl("/sessions/list")).toBe("http://127.0.0.1:8000/sessions/list");
  });

  it("covers image and export URLs, which cannot carry a request header", async () => {
    const api = await load("?apiPort=8000&apiToken=tok-1");
    expect(api.getSessionImageUrl("s1", "m1", "i1")).toContain("law_token=tok-1");
    expect(api.getExportUrl("s1", "md")).toContain("law_token=tok-1");
  });
});
