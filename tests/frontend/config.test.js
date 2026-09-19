/**
 * Tests for frontend API-base resolution.
 *
 * The renderer cannot read environment variables, so Electron passes the
 * backend's port on the query string. If this resolution is wrong the app
 * silently talks to nothing, which looks identical to the backend being down.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_API_BASE, DEFAULT_API_PORT, resolveApiBase } from "../../src/config.js";

const params = (query) => new URLSearchParams(query);

describe("resolveApiBase", () => {
  it("falls back to the development default with no parameters", () => {
    expect(resolveApiBase(params(""))).toBe(DEFAULT_API_BASE);
    expect(DEFAULT_API_BASE).toBe(`http://localhost:${DEFAULT_API_PORT}`);
  });

  it("uses the port Electron passes", () => {
    expect(resolveApiBase(params("apiPort=9123"))).toBe("http://localhost:9123");
  });

  it("prefers an explicit base over a port", () => {
    expect(resolveApiBase(params("apiPort=9123&apiBase=http://127.0.0.1:7000"))).toBe(
      "http://127.0.0.1:7000"
    );
  });

  it("strips a trailing slash so paths do not double up", () => {
    expect(resolveApiBase(params("apiBase=http://localhost:9000/"))).toBe("http://localhost:9000");
  });

  it("preserves other query parameters without being confused by them", () => {
    expect(resolveApiBase(params("theme=dark&apiPort=9123&debug=1"))).toBe("http://localhost:9123");
  });

  it.each([
    ["non-numeric", "apiPort=abc"],
    ["empty", "apiPort="],
    ["zero", "apiPort=0"],
    ["negative", "apiPort=-1"],
    ["above the valid range", "apiPort=70000"],
  ])("ignores a %s port and uses the default", (_label, query) => {
    expect(resolveApiBase(params(query))).toBe(DEFAULT_API_BASE);
  });

  it("falls back to the default when the environment offers no parameters", () => {
    expect(resolveApiBase(null)).toBe(DEFAULT_API_BASE);
  });

  it("ignores a blank explicit base rather than producing an empty origin", () => {
    expect(resolveApiBase(params("apiBase=%20%20"))).toBe(DEFAULT_API_BASE);
  });
});
