import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import path from "node:path";
const require = createRequire(import.meta.url);
const { childEnvironment, mediaOrigin } = require("../../electron/mediaManager");
const { mediaManagerPaths } = require("../../electron/mediaManagerPaths");

describe("Media Manager code and private data locations", () => {
  const root = path.resolve("workstation"), desktop = path.resolve("desktop"), userData = path.resolve("profile");
  const options = { root, desktop, userData, environment: {}, isDirectory: () => false };
  it("runs bundled code with private user data on a fresh installation", () => {
    expect(mediaManagerPaths(options)).toEqual({ directory: path.join(root, "media-manager"), reports: path.join(userData, "media-manager", "runs") });
  });
  it("keeps existing reports, captures and move logs in place while switching to bundled code", () => {
    const legacy = path.join(desktop, "Media Organizer", "runs");
    expect(mediaManagerPaths({ ...options, isDirectory: value => value === legacy })).toEqual({ directory: path.join(root, "media-manager"), reports: legacy });
  });
  it("honors explicit data and engine overrides without crossing stores", () => {
    const directory = path.resolve("custom-engine"), reports = path.resolve("private-reports");
    expect(mediaManagerPaths({ ...options, environment: { LAW_MEDIA_MANAGER_DIR: directory } })).toEqual({ directory, reports: path.join(directory, "runs") });
    expect(mediaManagerPaths({ ...options, environment: { LAW_MEDIA_MANAGER_DIR: directory, LAW_MEDIA_MANAGER_REPORTS: reports } })).toEqual({ directory, reports });
    expect(mediaManagerPaths({ ...options, isDirectory: () => true, environment: { LAW_MEDIA_MANAGER_REPORTS: reports } }).reports).toBe(reports);
  });
});

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
