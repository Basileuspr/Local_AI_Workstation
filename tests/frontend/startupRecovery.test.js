import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const entry = path.resolve("electron/main.js");
const realRequire = createRequire(entry);
function desktop(env = {}) {
  const spawn = vi.fn(() => Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(), pid: 1234,
  }));
  const logger = { info() {}, warn() {}, error() {} };
  const handlers = new Map();
  const app = { isPackaged: false, getPath: () => "C:\\fixture", setPath() {}, on() {},
    whenReady: () => new Promise(() => {}), requestSingleInstanceLock: () => true,
    disableHardwareAcceleration: vi.fn(), quit: vi.fn() };
  const electron = { app, ipcMain: { on() {}, handle() {} },
    protocol: { registerSchemesAsPrivileged() {}, handle: (scheme, handler) => handlers.set(scheme, handler) },
    net: { fetch: vi.fn(async () => new Response("recovery")) } };
  const module = { exports: {} };
  const context = vm.createContext({ module, __dirname: path.dirname(entry), console,
    process: { env: { LAW_PYTHON: "python.exe", ...env }, argv: [], platform: "win32" },
    URL, Response, setTimeout, clearTimeout,
    require: name => {
      if (name === "electron") return electron;
      if (name === "child_process") return { spawn };
      if (name === "./logger") return { createLogger: () => logger, logFilePath: () => null };
      return realRequire(name);
    },
  });
  vm.runInContext(readFileSync(entry, "utf8") + `\nmodule.exports = {
    startPythonBackend, stopPythonBackend, registerAppProtocol,
    state: () => backendState, child: () => pythonProcess,
  };`, context);
  return { ...module.exports, spawn, app, handlers, electron };
}

describe("desktop backend process failures", () => {
  it("survives a missing executable without an invalid taskkill or lost diagnosis", () => {
    const host = desktop();
    host.startPythonBackend();
    const child = host.child();
    child.pid = undefined;
    child.emit("error", new Error("spawn python.exe ENOENT"));
    host.stopPythonBackend();
    child.emit("close", -2);
    expect(host.spawn).toHaveBeenCalledTimes(1);
    expect(host.state().detail).toContain("Python environment");
  });
  it("keeps package failures actionable and lets a later launch become starting", () => {
    const host = desktop();
    host.startPythonBackend();
    const child = host.child();
    child.stderr.emit("data", Buffer.from("ModuleNotFoundError: No module named 'fastapi'"));
    child.emit("close", 1);
    expect(host.child()).toBeNull();
    expect(host.state().detail).toContain("package is missing");
    host.startPythonBackend();
    expect(host.state().state).toBe("starting");
    child.emit("close", 1);
    expect(host.child()).not.toBeNull();
    expect(host.state().state).toBe("starting");
  });
  it("sets UTF-8 for Python on differing Windows locale settings", () => {
    const host = desktop();
    host.startPythonBackend();
    expect(host.spawn.mock.calls[0][2].env).toMatchObject({ PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" });
  });
  it("enables the explicit graphics fallback before app readiness", () => {
    const host = desktop({ LAW_DISABLE_GPU: "1" });
    expect(host.app.disableHardwareAcceleration).toHaveBeenCalledOnce();
  });
  it("serves recovery without a frontend build and retains navigation/security checks", async () => {
    const host = desktop();
    host.registerAppProtocol();
    const request = url => ({ method: "GET", url });
    const serve = host.handlers.get("app");
    const response = await serve(request("app://local/recovery.html"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toContain("script-src 'self'");
    expect((await serve(request("app://evil/recovery.html"))).status).toBe(404);
    expect((await serve({ method: "POST", url: "app://local/recovery.html" })).status).toBe(405);
  });
});
