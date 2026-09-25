import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceBoundary, CapabilityReadings } from "../../src/components/Compatibility";
const require = createRequire(import.meta.url);
const { backendFailure, pythonPreflight } = require("../../electron/compatibility");

describe("Windows startup recovery", () => {
  it.each([
    ["ENOENT", "Python environment"],
    ["No Python at C:\\previous-machine", "Python environment"],
    ["ModuleNotFoundError: No module named 'fastapi'", "package is missing"],
    ["OSError: [WinError 126] DLL load failed", "native Windows dependency"],
    ["PermissionError: Access is denied", "denied access"],
    ["OSError: [WinError 112] disk full", "drive is full"],
    ["Another backend owns this app data folder", "previous instance"],
    ["A backup import was interrupted", "recovery controls"],
  ])("explains %s without exposing raw stderr", (stderr, detail) => {
    expect(backendFailure({ stderr: `${stderr}\nSECRET` })).toContain(detail);
    expect(backendFailure({ stderr: `${stderr}\nSECRET` })).not.toContain("SECRET");
  });
  it("rejects a missing local venv while allowing explicit PATH commands", () => {
    expect(() => pythonPreflight("C:\\app\\venv\\Scripts\\python.exe", () => false)).toThrow("setup-windows");
    expect(() => pythonPreflight("python.exe", () => false)).not.toThrow();
    expect(() => pythonPreflight("C:\\app\\python.exe", () => true)).not.toThrow();
  });
  it("keeps normal workspace content and offers local recovery for failed views", () => {
    expect(renderToStaticMarkup(<WorkspaceBoundary><p>Editor</p></WorkspaceBoundary>)).toContain("Editor");
    const boundary = new WorkspaceBoundary({});
    boundary.state = WorkspaceBoundary.getDerivedStateFromError(new Error("render failed"));
    const html = renderToStaticMarkup(boundary.render());
    expect(html).toContain("Other workspaces are still available");
    expect(html).toContain("Retry this workspace");
  });
  it("does not promise backend features while disconnected", () => {
    expect(renderToStaticMarkup(<CapabilityReadings />)).toContain("Local services are unavailable");
  });
});
