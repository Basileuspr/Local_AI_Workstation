import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import path from "node:path";
const require = createRequire(import.meta.url);
const { childEnvironment, mediaOrigin, createMediaManager } = require("../../electron/mediaManager");
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

describe("Media Manager page initialization", () => {
  function fixture(initialized) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = { resume: vi.fn() };
    child.stdin = new EventEmitter();
    child.stdin.end = vi.fn();
    const contents = new EventEmitter();
    let destroyed = false, throttle = true;
    Object.assign(contents, { isDestroyed: () => destroyed, close: () => { destroyed = true; },
      getBackgroundThrottling: () => throttle, setBackgroundThrottling: value => { throttle = value; },
      setWindowOpenHandler: vi.fn(), getURL: () => 'http://127.0.0.1:43210/', loadURL: vi.fn(async () => {}), executeJavaScript: vi.fn(async () => initialized) });
    const children = [];
    const win = { getContentSize: () => [1200, 800], webContents: { getZoomFactor: () => 1 },
      contentView: { addChildView: view => children.push(view), removeChildView: view => children.splice(children.indexOf(view), 1) } };
    const permissions = { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), on: vi.fn(), webRequest: { onBeforeRequest: vi.fn() } };
    const session = { fromPartition: () => permissions };
    class View {
      webContents = contents;
      visible = false;
      setVisible(visible) { this.visible = visible; }
      getVisible() { return this.visible; }
      bounds = {x:0,y:0,width:0,height:0};
      getBounds() { return this.bounds; }
      setBounds = vi.fn(bounds => { this.bounds = bounds; });
    }
    const manager = createMediaManager({ WebContentsView: View, session, getWindow: () => win,
      python: "fixture-python", directory: path.resolve("media-manager"),
      spawnProcess: () => { queueMicrotask(() => child.stdout.emit("data", Buffer.from('{"mediaManagerReady":1,"url":"http://127.0.0.1:43210"}\n'))); return child; } });
    return { manager, child, contents, children, permissions };
  }
  it("does not report ready when HTML loads but the frontend module fails", async () => {
    const f = fixture(false);
    const result = await f.manager.start();
    expect(result.error).toContain("could not load its page");
    expect(f.manager.status().ready).toBe(false);
    expect(f.children).toHaveLength(0);
    expect(f.child.stdin.end).toHaveBeenCalled();
    f.manager.dispose();
  });
  it("shows the initialized page and reuses it without starting another viewer", async () => {
    const f = fixture(true);
    f.manager.place({ visible: true, bounds: { x: 300, y: 100, width: 850, height: 650 } });
    expect(await f.manager.start()).toEqual({ ready: true });
    expect(f.children).toHaveLength(1);
    expect(f.children[0].visible).toBe(true);
    expect(await f.manager.start()).toEqual({ ready: true });
    expect(f.contents.loadURL).toHaveBeenCalledOnce();
    f.manager.dispose();
  });
  it('allows only fullscreen from the visible owned main frame and preserves other denials', async () => {
    const f = fixture(true);
    f.manager.place({ visible: true, bounds: { x: 0, y: 0, width: 850, height: 650 } });
    await f.manager.start();
    const check = f.permissions.setPermissionCheckHandler.mock.calls[0][0];
    const request = f.permissions.setPermissionRequestHandler.mock.calls[0][0];
    const details = { isMainFrame: true, requestingUrl: f.contents.getURL() };
    expect(check(f.contents, 'fullscreen', details.requestingUrl, details)).toBe(true);
    const callback = vi.fn(); request(f.contents, 'fullscreen', callback, details);
    expect(callback).toHaveBeenCalledWith(true);
    for (const permission of ['media', 'display-capture', 'openExternal', 'automatic-fullscreen', 'notifications'])
      expect(check(f.contents, permission, details.requestingUrl, details)).toBe(false);
    for (const changed of [{ ...details, isMainFrame: false }, { ...details, requestingUrl: 'https://example.com/' }, {}])
      expect(check(f.contents, 'fullscreen', '', changed)).toBe(false);
    expect(check({}, 'fullscreen', details.requestingUrl, details)).toBe(false);
    expect(check(null, 'fullscreen', details.requestingUrl, details)).toBe(false);
    f.manager.hide();
    expect(check(f.contents, 'fullscreen', details.requestingUrl, details)).toBe(false);
    f.manager.dispose();
  });
});
