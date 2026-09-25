import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

function logger({ fail = false } = {}) {
  const entry = path.resolve("electron/logger.js"), realRequire = createRequire(entry);
  const fs = { mkdirSync: vi.fn(), existsSync: () => false, appendFileSync: vi.fn(() => { if (fail) throw new Error("disk full"); }) };
  const module = { exports: {} }, output = vi.fn();
  vm.runInNewContext(readFileSync(entry, "utf8"), { module, __dirname: path.dirname(entry),
    require: name => name === "fs" ? fs : realRequire(name),
    process: { env: { LAW_DATA_DIR: "portable-data" }, stdout: { on() {} }, stderr: { on() {} } },
    console: { log: output, warn: output, error: output },
  });
  return { ...module.exports, fs, output };
}

describe("desktop log resilience", () => {
  it("uses relocated app data and redacts credentials including exception text", () => {
    const host = logger();
    host.createLogger("test").error("Bearer PRIVATE_BEARER X-LAW-Session: PRIVATE_SESSION /?apiToken=PRIVATE_QUERY");
    expect(host.logFilePath()).toBe(path.join("portable-data", "logs", "electron.log"));
    expect(host.fs.appendFileSync.mock.calls[0][1]).not.toContain("PRIVATE_");
    expect(host.output.mock.calls[0][0]).toContain("REDACTED");
  });
  it("reports file logging unavailable after a failed write while keeping console output", () => {
    const host = logger({ fail: true });
    host.createLogger("test").warn("disk is full");
    expect(host.logFilePath()).toBeNull();
    expect(host.output).toHaveBeenCalledOnce();
  });
});
