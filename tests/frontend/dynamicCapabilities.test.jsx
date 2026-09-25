import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CapabilityList } from "../../src/components/Compatibility";
import { modelInventoryKey, pickDefaultModel, reconcileChatModel } from "../../src/modelCatalog";
const require = createRequire(import.meta.url);
const { desktopCapabilities } = require("../../electron/compatibility");

describe("automatic capability selection", () => {
  const models = [{ name: "qwen3.5:9b", size: 6e9 }, { name: "small:latest", size: 1e9 }];
  it("prefers a smaller installed model on constrained systems without replacing explicit selections", () => {
    expect(pickDefaultModel(models, { preferSmall: true })).toBe("small:latest");
    expect(reconcileChatModel(models, "qwen3.5:9b", { preferSmall: true })).toBe("qwen3.5:9b");
    expect(reconcileChatModel(models, "missing", { preferSmall: true })).toBe("small:latest");
    expect(pickDefaultModel([{ name: "no-size" }], { preferSmall: true })).toBe("no-size");
    expect(pickDefaultModel([], { preferSmall: true })).toBe("");
  });
  it("refreshes for service or inventory changes, not reordered inventories", () => {
    const report = items => ({ ollama: { reachable: true }, models: { installed: items } });
    expect(modelInventoryKey(report(models))).toBe(modelInventoryKey(report([...models].reverse())));
    expect(modelInventoryKey(report(models))).not.toBe(modelInventoryKey(report(models.slice(0, 1))));
    expect(modelInventoryKey(report(models))).not.toBe(modelInventoryKey({ ollama: { reachable: false } }));
  });
  it("detects desktop prerequisites independently without launching them", () => {
    const mediaDirectory = "C:\\Media Organizer";
    const python = "C:\\Python\\python.exe";
    const installed = new Set([python, path.join(mediaDirectory, "media_organizer", "ui_server.py"),
      path.win32.join("C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")]);
    const options = { mediaDirectory, python, platform: "win32", environment: { SystemRoot: "C:\\Windows", Path: "C:\\Tools" }, exists: value => installed.has(value) };
    const first = desktopCapabilities(options).features;
    expect(first.media_manager.available).toBe(true);
    expect(first.graphics_reset.available).toBe(true);
    expect(first.program_updates.available).toBe(false);
    installed.add(path.join("C:\\Tools", "winget.exe"));
    expect(desktopCapabilities(options).features.program_updates.available).toBe(true);
    expect(desktopCapabilities({ ...options, platform: "linux" }).features.graphics_reset.available).toBe(false);
  });
  it("renders unavailable operations beside available ones", () => {
    const html = renderToStaticMarkup(<CapabilityList features={{ chat: { available: true, detail: "CPU ready" }, training: { available: false, detail: "Missing GPU" } }} />);
    expect(html).toContain("Chat: Available");
    expect(html).toContain("LoRA training: Unavailable");
    expect(html).toContain("Missing GPU");
  });
});
