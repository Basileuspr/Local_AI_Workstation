import { describe, expect, it } from "vitest";
import { addPackageEntries, droppedPackageFiles, MAX_PACKAGE_BYTES, packageFilename, removePackageEntry, selectedPackageFiles } from "../../src/filePackager";

const entry = (path, text = "content") => ({ path, file: new File([text], path.split("/").at(-1)), directory: false });

describe("file packaging selection", () => {
  it("preserves all files and avoids collisions with numbered and case-variant names", () => {
    const initial = addPackageEntries([], [entry("notes.txt"), entry("notes (2).txt")]);
    const result = addPackageEntries(initial, [entry("NOTES.txt", "second"), entry("nested/notes.txt")]);
    expect(result.map(item => item.path)).toEqual(["notes.txt", "notes (2).txt", "NOTES (3).txt", "nested/notes.txt"]);
    expect(result[2].file.size).toBe(6);
    expect(initial).toHaveLength(2);
  });
  it("handles a file matching an implicit or empty folder without losing either", () => {
    const result = addPackageEntries([], [entry("folder"), entry("folder/file.bin"), { ...entry("empty", ""), directory: true }, entry("empty")]);
    expect(result.map(item => item.path)).toEqual(["folder (2)", "folder/file.bin", "empty", "empty (2)"]);
    expect(() => addPackageEntries(addPackageEntries([], [entry("folder")]), [entry("folder/file.txt")])).toThrow("folder name");
  });
  it("rejects traversal and excessive selections without changing the current list", () => {
    expect(() => addPackageEntries([], [entry("../escape")])).toThrow("relative");
    expect(() => addPackageEntries([], [{ ...entry("big"), file: { size: MAX_PACKAGE_BYTES + 1 } }])).toThrow("512 MiB");
    expect(() => addPackageEntries([], Array.from({length:1001}, (_, i) => entry(`${i}`)))).toThrow("1,000");
  });
  it("uses relative folder-picker paths and portable names", () => {
    expect(selectedPackageFiles([{name:"readme",webkitRelativePath:"project/readme"}])[0].path).toBe("project/readme");
    expect(packageFilename("CON.zip")).toBe("_CON.zip");
    expect(packageFilename("My: package.zip")).toBe("My_ package.zip");
    expect(packageFilename(" ")).toBe("Package.zip");
  });
  it("removes an entire selected folder without removing similarly named neighbors", () => {
    const items = addPackageEntries([], [{...entry("folder", ""),directory:true},entry("folder/nested/file"),entry("folder-2/file")]);
    expect(removePackageEntry(items, items[0]).map(item=>item.path)).toEqual(["folder-2/file"]);
  });
  it("reads every batch of dropped folder entries and retains empty folders", async () => {
    const file = name => ({ name, isFile: true, file: resolve => resolve(new File([name], name)) });
    const folder = (name, batches) => ({ name, isDirectory: true, createReader: () => ({ readEntries: resolve => resolve(batches.shift() || []) }) });
    const root = folder("project", [[file("a.txt")], [file("b.bin"), folder("empty", [[]])], []]);
    const result = await droppedPackageFiles({ items: [{kind:"file",webkitGetAsEntry:()=>root}], files: [] });
    expect(result.map(item => item.path)).toEqual(["project", "project/a.txt", "project/b.bin", "project/empty"]);
    expect(result.at(-1).directory).toBe(true);
  });
});
