import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi, afterEach } from "vitest";
import WorkflowRunPanel from "../../src/components/WorkflowRunPanel";
import { runIsActive, stageWithProvider } from "../../src/imageWorkflow";
import * as api from "../../src/imageWorkflowApi";
import ImageGallery from "../../src/components/ImageGallery";
import { WorkflowImageCards } from "../../src/components/WorkflowImageLibrary";

afterEach(() => vi.unstubAllGlobals());
const record = { id: "job", workflow_id: "workflow", status: "completed", seed: 42,
  outputs: [{ id: "output", width: 64, height: 48 }], accepted_output_ids: [],
  stage_results: [{ stage_id: "stage", text: "Visible image text" }] };

it("exposes stop for pending runs and hides partial results", () => {
  for (const status of ["queued", "running", "cancelling"]) {
    expect(runIsActive({ status })).toBe(true);
    const html = renderToStaticMarkup(<WorkflowRunPanel record={{ ...record, status }} />);
    expect(html).not.toContain("Keep as reference");
    expect(html).not.toContain("Visible image text");
    expect(html).not.toContain("Save all images (ZIP)");
    expect(html).not.toContain("Stitch images");
    expect(html).toContain(status === "cancelling" ? "Stopping safely" : "Stop workflow");
  }
  expect(runIsActive(null)).toBe(false);
  expect(runIsActive(record)).toBe(false);
});

it("keeps image acceptance and text adoption explicit", () => {
  const html = renderToStaticMarkup(<WorkflowRunPanel record={record} />);
  expect(html).toContain("Keep as reference");
  expect(html).toContain("Use as positive prompt");
  expect(html).toContain("Save all images (ZIP)");
  expect(html).toContain("Stitch images");
  expect(html).toContain("Horizontal row");
  expect(html).toContain("Vertical column");
  expect(html).not.toContain("Stop workflow");
  expect(renderToStaticMarkup(<WorkflowRunPanel record={{ ...record, accepted_output_ids: ["output"] }} />)).toContain("Kept as reference");
});

it("omits image exports for text-only completed runs", () => {
  const html = renderToStaticMarkup(<WorkflowRunPanel record={{ ...record, outputs: [] }} />);
  expect(html).not.toContain("Save all images (ZIP)");
  expect(html).toContain("Use as positive prompt");
});

it("separates the workflow folder and uses workflow previews without chat deletion actions", () => {
  const html = renderToStaticMarkup(<ImageGallery active={false} images={[]} />);
  expect(html).toContain("General Images");
  expect(html).toContain("Workflow Images");
  const cards = renderToStaticMarkup(<WorkflowImageCards runs={[{...record, created_at: "2026-09-18T00:00:00Z",
    workflow_name: "Scene progression", outputs: [{id: "o", stage_number: 2, url: "/image-workflows/w/jobs/j/outputs/o"}],
    composites: [{layout: "grid", url: "/image-workflows/w/jobs/j/stitched/grid"}],
  }]} />);
  expect(cards).toContain("Scene progression");
  expect(cards).toContain("Stage 2");
  expect(cards).toContain("Stitched grid");
  expect(cards).toContain("Save / stitch this run (1)");
  expect(cards).not.toContain("Permanently delete");
  expect(cards).not.toContain("/sessions/");
});

it("keeps stitching separate from revision-checked reference acceptance", async () => {
  const mock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", mock);
  await api.images();
  await api.stitch("workflow", "job", "column");
  await api.keepStitched({id: "workflow", revision: 9}, "job", "column");
  expect(mock.mock.calls[0][0]).toMatch(/image-workflows\/images$/);
  expect(mock.mock.calls[1][0]).toMatch(/\/jobs\/job\/stitched\/column$/);
  expect(mock.mock.calls[1][1].method).toBe("POST");
  expect(mock.mock.calls[2][0]).toMatch(/\/stitched\/column\/accept$/);
  expect(JSON.parse(mock.mock.calls[2][1].body)).toEqual({ revision: 9 });
});

it("surfaces failed downloads instead of saving an error response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ detail: "Workflow output is missing or changed on disk" }) }));
  await expect(api.downloadImages("workflow", "job")).rejects.toThrow("missing or changed");
});

it("downloads all outputs with one browser download and releases the object URL", async () => {
  vi.useFakeTimers();
  const link = { click: vi.fn(), remove: vi.fn() };
  const create = vi.fn(() => "blob:zip"), revoke = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
  vi.stubGlobal("document", { createElement: () => link, body: { appendChild: vi.fn() } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["zip"]),
    headers: { get: () => 'attachment; filename="scene-images.zip"' } }));
  try {
    await api.downloadImages("workflow", "job");
    expect(link.download).toBe("scene-images.zip");
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(link.remove).toHaveBeenCalledOnce();
    await vi.runAllTimersAsync();
    expect(revoke).toHaveBeenCalledWith("blob:zip");
  } finally { vi.useRealTimers(); }
});

it("selects only a compatible available provider and exposes its model", () => {
  const catalog = { providers: [
    { id: "missing", available: false, operations: ["img2img"], models: [] },
    { id: "sdxl", available: true, operations: ["img2img"], models: [{ id: "installed" }] },
  ] };
  const stage = stageWithProvider({ assets: [], stages: [] }, "img2img", catalog);
  expect(stage.provider_slot).toBe("sdxl");
  expect(stage.model_id).toBe("installed");
  expect(stageWithProvider({ assets: [], stages: [] }, "controlnet", catalog).provider_slot).toBe("");
});

it("binds execution and output acceptance to the current revision", async () => {
  const mock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", mock);
  const workflow = { id: "workflow", revision: 8 };
  await api.execute(workflow);
  await api.stop(workflow.id, "job");
  await api.keepOutput(workflow, "job", "output");
  expect(mock.mock.calls[0][0]).toMatch(/\/execute$/);
  expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({ revision: 8 });
  expect(mock.mock.calls[1][0]).toMatch(/\/jobs\/job\/stop$/);
  expect(JSON.parse(mock.mock.calls[2][1].body)).toEqual({ revision: 8, output_id: "output" });
});
