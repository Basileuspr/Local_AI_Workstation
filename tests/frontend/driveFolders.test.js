import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const { openDriveRoot } = createRequire(import.meta.url)("../../electron/driveFolders.js");

describe("open drive root", () => {
  it("opens the selected drive's root with the OS folder opener", async () => {
    const open = vi.fn().mockResolvedValue("");
    const stat = vi.fn().mockResolvedValue({ isDirectory: () => true });
    expect(await openDriveRoot("e:/", open, stat)).toEqual({ error: null });
    expect(open).toHaveBeenCalledWith("E:\\");
    expect(stat).toHaveBeenCalledWith("E:\\");
  });
  it.each(["C:\\Windows", "C:\\..\\", "C:", "\\\\server\\share", "file:///C:/", "https://example.com", "cmd.exe", null])("rejects non-root paths: %s", async (value) => {
    const open = vi.fn();
    const stat = vi.fn();
    expect((await openDriveRoot(value, open, stat)).error).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
  });
  it("reports disconnected drives and OS errors", async () => {
    const open = vi.fn().mockResolvedValue("Access denied");
    expect((await openDriveRoot("N:\\", open, async () => { throw new Error(); })).error).toContain("connected");
    expect(open).not.toHaveBeenCalled();
    expect((await openDriveRoot("C:\\", open, async () => ({ isDirectory: () => true }))).error).toBe("Access denied");
  });
});
