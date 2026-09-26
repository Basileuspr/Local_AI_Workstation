import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { createProgramLaunchers } = require("../../electron/programLaunchers");

describe("registered desktop programs", () => {
  it("persists picker selections, deduplicates them, and opens only registered IDs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "law-launcher-test-"));
    try {
      const selected = path.join(root, "Chosen program.exe");
      const file = path.join(root, "registry.json");
      const dialog = { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [selected] })) };
      const shell = { openPath: vi.fn(async () => "") };
      const options = { file, dialog, shell, getWindow: () => null };
      const launcher = createProgramLaunchers(options);
      const choice = await launcher.choose();
      expect(choice).toEqual({ id: expect.any(String), name: "Chosen program.exe" });
      expect(await launcher.choose()).toEqual(choice);
      expect(JSON.parse(fs.readFileSync(file, "utf8"))).toHaveLength(1);
      const reloaded = createProgramLaunchers(options);
      await expect(reloaded.open(selected)).rejects.toThrow("Choose this program again");
      expect(shell.openPath).not.toHaveBeenCalled();
      await expect(reloaded.open(choice.id)).resolves.toEqual({ ok: true });
      expect(shell.openPath).toHaveBeenCalledWith(selected);
      shell.openPath.mockResolvedValueOnce("Program was removed");
      await expect(reloaded.open(choice.id)).rejects.toThrow("Program was removed");
      dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
      expect(await launcher.choose()).toBeNull();
      dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path.join(root, "command.ps1")] });
      await expect(launcher.choose()).rejects.toThrow(".exe");
    } finally {
      // Only the unique test directory created above contains this fixture.
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
