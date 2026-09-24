import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { childEnvironment, mediaOrigin } = require("../../electron/mediaManager");

describe("Media Manager isolation", () => {
  it("passes OS runtime paths without Workstation credentials, data roots or Python injection", () => {
    const environment = childEnvironment({ Path: "tools", SystemRoot: "windows", TEMP: "temp", USERPROFILE: "home",
      LAW_SESSION_TOKEN: "secret", LAW_DATA_DIR: "host-data", LAW_MODELS_DIR: "host-models", PYTHONPATH: "injection", PYTHONHOME: "other", API_KEY: "secret" });
    expect(environment).toEqual({ Path: "tools", SystemRoot: "windows", TEMP: "temp", USERPROFILE: "home", PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" });
  });
  it("accepts only a plain loopback origin from the private startup pipe", () => {
    expect(mediaOrigin("http://127.0.0.1:43210")).toBe("http://127.0.0.1:43210");
    for (const value of ["https://evil.test", "http://localhost:43210", "http://127.0.0.1:43210@evil.test", "http://user@127.0.0.1:43210", "http://127.0.0.1:43210/api", "http://127.0.0.1:43210/?token=secret", "file:///tmp", "http://127.0.0.1"]) expect(mediaOrigin(value)).toBeNull();
  });
});
