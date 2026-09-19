import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { createFaceImports, saveFaceFolder, MAX_FILE_BYTES } = require("../../electron/faceFiles");
const roots = [];
async function temporary() { const root = await fs.mkdtemp(path.join(os.tmpdir(), "law-face-files-")); roots.push(root); return root; }
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const resolved = await fs.realpath(root);
    expect(path.dirname(resolved).toLowerCase()).toBe((await fs.realpath(os.tmpdir())).toLowerCase());
    expect(path.basename(resolved)).toMatch(/^law-face-files-/);
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
const choose = folder => ({ home: "C:\\Users\\Test", showDialog: vi.fn(async () => ({ canceled: false, filePaths: [folder] })) });

describe("buffered desktop face inputs", () => {
  it("accepts 237 images and reads only one batch at a time without exposing folder paths", async () => {
    const folder = await temporary();
    await Promise.all(Array.from({ length: 237 }, (_, i) => fs.writeFile(path.join(folder, `${i}.png`), "small image")));
    await fs.mkdir(path.join(folder, "nested.png"));
    await fs.writeFile(path.join(folder, "notes.txt"), "ignored");
    const open = vi.fn(fs.open);
    const imports = createFaceImports({ io: { ...fs, open } });
    const options = choose(folder);
    const grant = await imports.choose(1, { directory: true }, options);
    expect(grant.total).toBe(237);
    expect(open).not.toHaveBeenCalled();
    expect(JSON.stringify(grant)).not.toContain(folder);
    expect(options.showDialog.mock.calls[0][0]).toMatchObject({ defaultPath: options.home, properties: ["openDirectory", "dontAddToRecent"] });
    const first = await imports.next(1, grant.ticket);
    expect(first.files).toHaveLength(100); expect(first.done).toBe(false);
    expect(open).toHaveBeenCalledTimes(100);
    expect(JSON.stringify(first)).not.toContain(folder);
    expect((await imports.next(1, grant.ticket)).files).toHaveLength(100);
    const last = await imports.next(1, grant.ticket);
    expect(last.files).toHaveLength(37); expect(last.done).toBe(true);
    imports.release(1, grant.ticket);
    await expect(imports.next(1, grant.ticket)).rejects.toThrow("closed");
  });

  it("bounds bytes as well as count, skips oversized files, and continues with good images", async () => {
    const folder = await temporary();
    await fs.writeFile(path.join(folder, "a.png"), Buffer.alloc(9 * 1024 ** 2));
    await fs.writeFile(path.join(folder, "b.png"), Buffer.alloc(9 * 1024 ** 2));
    const tooLarge = await fs.open(path.join(folder, "c.png"), "w");
    await tooLarge.truncate(MAX_FILE_BYTES + 1); await tooLarge.close();
    await fs.writeFile(path.join(folder, "d.png"), "small");
    const imports = createFaceImports();
    const grant = await imports.choose(1, { directory: true }, choose(folder));
    const first = await imports.next(1, grant.ticket);
    expect(first.files.map(f => f.name)).toEqual(["a.png"]);
    const last = await imports.next(1, grant.ticket);
    expect(last.files.map(f => f.name)).toEqual(["b.png", "d.png"]);
    expect(last.errors).toEqual([{ source: "c.png", error: "Images must be at most 20 MiB each." }]);
    expect(last.consumed).toBe(3); expect(last.done).toBe(true);
  });

  it("binds grants to their window and handles cancel without reading files", async () => {
    const folder = await temporary(); await fs.writeFile(path.join(folder, "one.png"), "image");
    const imports = createFaceImports();
    expect(await imports.choose(1, {}, { ...choose(folder), showDialog: async () => ({ canceled: true }) })).toEqual({ canceled: true });
    const grant = await imports.choose(1, { directory: true }, choose(folder));
    await expect(imports.next(2, grant.ticket)).rejects.toThrow("closed");
    imports.release(2, grant.ticket);
    imports.release(1, "wrong-ticket");
    expect((await imports.next(1, grant.ticket)).files).toHaveLength(1);
    imports.release(1);
    await expect(imports.next(1, grant.ticket)).rejects.toThrow("closed");
  });

  it("supports file selection above 100 and rejects paths not granted by the chooser", async () => {
    const folder = await temporary(); const file = path.join(folder, "one.png"); await fs.writeFile(file, "image");
    const imports = createFaceImports();
    const grant = await imports.choose(1, {}, { ...choose(folder), showDialog: async () => ({ filePaths: Array(125).fill(file) }) });
    expect(grant.total).toBe(125);
    await expect(imports.next(1, file)).rejects.toThrow("closed");
    expect((await imports.next(1, grant.ticket)).files).toHaveLength(100);
    expect((await imports.next(1, grant.ticket)).files).toHaveLength(25);
  });
});

describe("plain face crop folder export", () => {
  const datasetId = "a".repeat(32);
  const ids = Array.from({ length: 100 }, (_, i) => i.toString(16).padStart(32, "0"));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
  const request = async route => route.endsWith("/crop") ? new Response(png) : new Response(JSON.stringify({ name: "../Training faces", faces: ids.map(id => ({ id, state: "pending" })) }));

  it("writes all 100 pending crops as plain PNGs in a new folder and never overwrites earlier exports", async () => {
    const parent = await temporary(); await fs.writeFile(path.join(parent, "existing.txt"), "preserved");
    const deps = { ...choose(parent), request };
    const first = await saveFaceFolder({ datasetId, faceIds: ids }, deps);
    expect(first.saved).toBe(100); expect(first.errors).toEqual([]);
    expect(path.dirname(first.folder)).toBe(await fs.realpath(parent));
    const files = await fs.readdir(first.folder);
    expect(files).toHaveLength(100); expect(files.every(name => name.endsWith(".png"))).toBe(true);
    expect(await fs.readFile(path.join(first.folder, files[0]))).toEqual(png);
    const selected = await saveFaceFolder({ datasetId, faceIds: [ids[0], ids[0], ids[2]] }, deps);
    expect(selected.folder).not.toBe(first.folder); expect(selected.saved).toBe(2);
    expect(await fs.readFile(path.join(parent, "existing.txt"), "utf8")).toBe("preserved");
  });

  it("does not write on chooser cancellation and validates dataset membership before choosing", async () => {
    const parent = await temporary(); const deps = { ...choose(parent), request };
    deps.showDialog.mockResolvedValue({ canceled: true });
    expect(await saveFaceFolder({ datasetId, faceIds: ids }, deps)).toEqual({ canceled: true });
    expect(await fs.readdir(parent)).toEqual([]);
    deps.showDialog.mockClear();
    await expect(saveFaceFolder({ datasetId: "../escape", faceIds: ids }, deps)).rejects.toThrow("saved dataset");
    await expect(saveFaceFolder({ datasetId, faceIds: ["f".repeat(32)] }, deps)).rejects.toThrow("no longer");
    expect(deps.showDialog).not.toHaveBeenCalled();
  });

  it("reports partial exports honestly and keeps completed copies after a disk error", async () => {
    const parent = await temporary();
    const open = vi.fn(fs.open).mockImplementationOnce(fs.open).mockImplementationOnce(async (...args) => {
      const handle = await fs.open(...args);
      return { close: () => handle.close(), writeFile: async bytes => {
        await handle.writeFile(bytes.subarray(0, 4));
        throw Object.assign(new Error("Disk full"), { code: "ENOSPC" });
      } };
    });
    const result = await saveFaceFolder({ datasetId, faceIds: ids }, { ...choose(parent), request, io: { ...fs, open } });
    expect(result.saved).toBe(1); expect(result.total).toBe(100); expect(result.errors).toHaveLength(1);
    expect(await fs.readdir(result.folder)).toHaveLength(1); expect(open).toHaveBeenCalledTimes(2);
  });
});
