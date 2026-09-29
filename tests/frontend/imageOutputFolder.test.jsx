import React from "react";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ImageOutputFolder from "../../src/components/ImageOutputFolder";
import { imageRequest } from "../../src/chatImageGeneration";
import { defaultImageSettings } from "../../src/preferences";
import { buildImageBatch } from "../../src/imageBatch";
const require = createRequire(import.meta.url);
const { chooseOutputFolder } = require("../../electron/outputFolder");

describe("Point output", () => {
  it("shows a compact folder label, full path tooltip and Clear only when selected", () => {
    const blank = renderToStaticMarkup(<ImageOutputFolder onChange={() => {}} />);
    expect(blank).toContain("Point output");
    expect(blank).toContain("Default folder");
    expect(blank).not.toContain("Clear output folder");
    const selected = renderToStaticMarkup(<ImageOutputFolder value={"E:\\Pictures\\Generated"} onChange={() => {}} />);
    expect(selected).toContain('title="E:\\Pictures\\Generated"');
    expect(selected).toContain(">Generated</span>");
    expect(selected).toContain("Clear output folder");
  });
  it("captures the output folder for queued requests and batches, and clears to default", () => {
    const settings = { ...defaultImageSettings, outputDir: "E:\\Pictures" };
    const queued = imageRequest(settings, "one");
    expect(buildImageBatch(settings, 2).every(row => row.outputDir === settings.outputDir)).toBe(true);
    settings.outputDir = "";
    expect(queued.output_dir).toBe("E:\\Pictures");
    expect(imageRequest(settings, "two").output_dir).toBeNull();
  });
  it("opens a directory-only native picker and preserves cancellation", async () => {
    const showDialog = vi.fn().mockResolvedValue({ canceled: false, filePaths: ["E:\\Pictures"] });
    const stat = vi.fn().mockResolvedValue({ isDirectory: () => true });
    expect(await chooseOutputFolder({ showDialog, home: "home", stat })).toEqual({ folder: "E:\\Pictures" });
    expect(showDialog.mock.calls[0][0].properties).toEqual(["openDirectory", "createDirectory", "dontAddToRecent"]);
    showDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await chooseOutputFolder({ showDialog, stat })).toEqual({ canceled: true });
    expect(stat).toHaveBeenCalledTimes(1);
  });
});
