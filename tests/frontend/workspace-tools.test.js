import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { orderModels, moveModel } from "../../src/modelOrder";
import { previewDocument } from "../../src/codePreview";
const require = createRequire(import.meta.url);
const { findWindowsProgram } = require("../../electron/windowsPrograms");
const { desktopCapabilities } = require("../../electron/compatibility");

describe("workspace tools", () => {
  it("finds WinGet in WindowsApps even when absent from the launching process PATH", () => {
    const environment = { SystemRoot: "C:\\Windows", LOCALAPPDATA: "C:\\User\\AppData\\Local", Path: "C:\\Other" };
    const exists = path => path.endsWith("WindowsApps\\winget.exe") || path.endsWith("powershell.exe");
    expect(findWindowsProgram("winget.exe", environment, exists)).toBe("C:\\User\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe");
    expect(desktopCapabilities({ mediaDirectory: "C:\\Media", python: "python.exe", platform: "win32", environment, exists }).features.program_updates.available).toBe(true);
  });
  it("keeps manual model priorities through catalog refreshes and appends newly discovered models", () => {
    const models = [{ name: "a" }, { name: "b" }, { name: "c" }];
    const order = moveModel(models, "c", -2);
    expect(orderModels([...models, { name: "d" }], order).map(m => m.name)).toEqual(["c", "a", "b", "d"]);
    expect(orderModels(models.filter(m => m.name !== "a"), order).map(m => m.name)).toEqual(["c", "b"]);
  });
  it("places preview restrictions before untrusted content and prevents CSS closing its style tag", () => {
    const html = previewDocument('<script>fetch("https://example.com")</script>', '</style><script>alert(1)</script>');
    expect(html.indexOf("default-src 'none'")).toBeLessThan(html.indexOf("<script>"));
    expect(html).toContain("<\\/style>");
    expect(html).toContain("form-action 'none'");
  });
});
