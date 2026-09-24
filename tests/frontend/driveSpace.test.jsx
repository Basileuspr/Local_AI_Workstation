import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FolderSpaceResults, folderBytes } from "../../src/components/DriveFolderSizes";
const { createDriveSpace } = createRequire(import.meta.url)("../../electron/driveSpace");

function fixture() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stdout.setEncoding = vi.fn(); child.kill = vi.fn();
  const startWorker = vi.fn(() => child);
  return {child, startWorker, controller: createDriveSpace({startWorker})};
}

describe("drive scan worker lifecycle", () => {
  it("accepts drive roots only and never builds a shell command", () => {
    const {controller, startWorker} = fixture();
    for (const value of [null, "C:", "C:\\Users", "C:\\..\\", "\\\\server\\share", "C:\\; cmd.exe"]) expect(controller.start(value).error).toBeTruthy();
    expect(startWorker).not.toHaveBeenCalled();
    expect(controller.start("e:/").status).toBe("running");
    expect(startWorker).toHaveBeenCalledWith("E:\\");
  });
  it("parses split progress lines and completion without mixing scan results", () => {
    const {controller, child} = fixture();
    const job = controller.start("C:\\");
    child.stdout.emit("data", '{"type":"progress","report":{"files":');
    expect(controller.status(job.id).report).toBeNull();
    child.stdout.emit("data", '10}}\n{"type":"complete","report":{"files":20}}\n');
    child.emit("close", 0);
    expect(controller.status(job.id)).toMatchObject({status: "complete", report: {files: 20}});
    expect(controller.status("wrong-id").error).toBeTruthy();
  });
  it("cancels the worker, keeps partial results, and waits for exit before allowing another scan", () => {
    const {controller, child, startWorker} = fixture();
    const job = controller.start("C:\\");
    expect(controller.start("E:\\").error).toContain("still running");
    child.stdout.emit("data", '{"type":"progress","report":{"files":10}}\n');
    expect(controller.cancel(job.id)).toMatchObject({status: "canceled", report: {files: 10, canceled: true, finished: false}});
    expect(child.kill).toHaveBeenCalledOnce();
    expect(controller.start("E:\\").error).toBeTruthy();
    child.stdout.emit("data", '{"type":"complete","report":{"files":20}}\n');
    child.emit("close", 1);
    expect(controller.status(job.id).status).toBe("canceled");
    expect(controller.start("E:\\").status).toBe("running");
    expect(startWorker).toHaveBeenCalledTimes(2);
    controller.dispose();
    expect(child.kill).toHaveBeenCalledTimes(2);
  });
  it("reports worker failures without claiming a complete scan", () => {
    const {controller, child} = fixture();
    const job = controller.start("C:\\");
    child.emit("close", 1);
    expect(controller.status(job.id)).toMatchObject({status: "error", error: expect.stringContaining("before it completed")});
  });
  it.each(["spawn", "protocol"])("handles %s errors and releases the scan slot after exit", kind => {
    const {controller, child} = fixture();
    const job = controller.start("C:\\");
    if (kind === "spawn") child.emit("error", new Error("spawn failed"));
    else child.stdout.emit("data", "not-json\n");
    expect(controller.status(job.id).status).toBe("error");
    child.emit("close", 1);
    expect(controller.start("E:\\").status).toBe("running");
  });
});

it("renders sorted folder shares, root files, small sizes and incomplete coverage accurately", () => {
  const row = (name, bytes) => ({name, bytes, status: "done", files: 1, errors: 0, skipped_links: 0, shared_files: 0});
  const html = renderToStaticMarkup(<FolderSpaceResults status="complete" report={{folders: [row("Small", 10), row("Large", 80)], root_files: row("Files in drive root", 10), total_bytes: 100, files: 3, errors: 1, skipped_links: 0, sampled_at: "2026-09-22T00:00:00Z"}} />);
  expect(html.indexOf('>Large</span>')).toBeLessThan(html.indexOf('>Small</span>'));
  for (const text of ["80 B", "80.0%", "Files in drive root", "Partial coverage", "not total drive capacity"]) expect(html).toContain(text);
  expect(html).not.toContain("NaN");
  expect(folderBytes(512)).toBe("512 B");
  expect(folderBytes(1024)).toBe("1 KiB");
  expect(folderBytes(1024 ** 4)).toBe("1 TiB");
});
