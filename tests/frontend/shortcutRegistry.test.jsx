import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { builtInEntries, filterRegistry, loadPersonalEntries, savePersonalEntries, registryMarkdown, SHORTCUT_REGISTRY_KEY, REGISTRY_FOLDERS_KEY, loadRegistryFolders, saveRegistryFolders, registryFolders } from "../../src/shortcutRegistry";
import ShortcutRegistry from "../../src/components/ShortcutRegistry";
import { appTabs, loadNavigation, saveNavigation, resolveActiveTab } from "../../src/navigation";
import { pinnableTabs, workspaceVisible } from "../../src/chatPins";
import { functionTargets } from "../../src/functionButtons";

const personal = { id: "custom-1", application: "My editor", platform: "Windows", type: "Shortcut", category: "Editing", title: "My command", keys: "Ctrl + K", description: "Opens my command menu.", notes: "My own binding." };
function storage() {
  const values = new Map();
  vi.stubGlobal("localStorage", { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });
  return values;
}
afterEach(() => vi.unstubAllGlobals());
describe("Shortcut Registry", () => {
  it("finds combinations with or without spaces and searches notes", () => {
    expect(filterRegistry(builtInEntries, { query: "Ctrl+Enter" }).map(entry => entry.id)).toEqual(["word-page"]);
    expect(filterRegistry(builtInEntries, { query: "Ctrl + Enter" }).map(entry => entry.id)).toEqual(["word-page"]);
    expect(filterRegistry(builtInEntries, { query: "marks visible", type: "Behavior" }).map(entry => entry.id)).toEqual(["word-visible-marks"]);
    expect(filterRegistry(builtInEntries, { category: "Review", type: "Function" }).map(entry => entry.id)).toEqual(["word-resolve-revisions"]);
    expect(filterRegistry(builtInEntries, { application: "My editor" })).toEqual([]);
  });
  it("persists personal entries separately from built-in sources", () => {
    const values = storage();
    savePersonalEntries([{ ...personal, builtIn: true, source: "https://fake.example" }]);
    expect(loadPersonalEntries()[0]).toMatchObject({ ...personal, builtIn: false });
    expect(loadPersonalEntries()[0].source).toBeUndefined();
    expect(JSON.parse(values.get(SHORTCUT_REGISTRY_KEY))).toHaveLength(1);
    savePersonalEntries([{ ...loadPersonalEntries()[0], description: "Changed behavior." }]);
    expect(loadPersonalEntries()[0].description).toBe("Changed behavior.");
    savePersonalEntries([]);
    expect(loadPersonalEntries()).toEqual([]);
  });
  it("rejects incomplete shortcuts and colliding IDs before overwriting storage", () => {
    storage(); savePersonalEntries([personal]);
    expect(() => savePersonalEntries([{ ...personal, keys: "" }])).toThrow("keys");
    expect(() => savePersonalEntries([{ ...personal, title: " " }])).toThrow("required");
    expect(() => savePersonalEntries([personal, personal])).toThrow("Invalid");
    expect(() => savePersonalEntries([{ ...personal, id: builtInEntries[0].id }])).toThrow("Invalid");
    expect(loadPersonalEntries()[0].id).toBe(personal.id);
  });
  it("permits behavior and function entries without a key combination", () => {
    storage();
    for (const type of ["Behavior", "Function"]) {
      savePersonalEntries([{ ...personal, type, keys: "" }]);
      expect(loadPersonalEntries()[0].type).toBe(type);
    }
  });
  it("exports only the selected results with platform and source information", () => {
    const text = registryMarkdown(filterRegistry(builtInEntries, { query: "page break" }));
    expect(text).toContain("## Page break");
    expect(text).toContain("Ctrl + Enter");
    expect(text).toContain("Windows desktop");
    expect(text).toContain("https://support.microsoft.com/");
    expect(text).not.toContain("## Track Changes");
    expect(registryMarkdown([{ ...personal, title: "[example](unsafe)", notes: "<script>" }])).toContain("\\<script\\>");
  });
  it("keeps corrupted storage intact and disables saving in the viewer", () => {
    const values = storage(); values.set(SHORTCUT_REGISTRY_KEY, "bad json");
    expect(() => loadPersonalEntries()).toThrow();
    const html = renderToStaticMarkup(<ShortcutRegistry />);
    expect(html).toContain("Stored data has been preserved");
    expect(html).toContain('disabled=""');
    expect(values.get(SHORTCUT_REGISTRY_KEY)).toBe("bad json");
    expect(html).toContain("Microsoft Word");
  });
  it("reports unavailable storage while still showing the starter reference", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("Unavailable"); } });
    expect(renderToStaticMarkup(<ShortcutRegistry />)).toContain("Unavailable");
  });
  it("supports restoring navigation, pinning beside Chat, and function shortcuts", () => {
    storage(); saveNavigation("shortcuts", null);
    expect(loadNavigation().tab).toBe("shortcuts");
    expect(appTabs).toContain("shortcuts");
    expect(pinnableTabs).toContain("shortcuts");
    expect(functionTargets).toContainEqual({ id: "shortcuts", name: "Shortcut Registry" });
  });
  it("opens the standalone registry without a Chat pin and resolves all registered routes", () => {
    expect(workspaceVisible(resolveActiveTab("shortcuts"), null, "shortcuts")).toBe(true);
    expect(workspaceVisible(resolveActiveTab("shortcuts"), null, "chats")).toBe(false);
    for (const tab of appTabs) expect(resolveActiveTab(tab)).toBe(tab);
    expect(resolveActiveTab("obsolete-tab")).toBe("chats");
  });
  it("starts with compact application folders without rendering all reference cards", () => {
    storage();
    const html = renderToStaticMarkup(<ShortcutRegistry />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Microsoft Word");
    expect(html).not.toContain('<article');
  });
  it("groups Word and Excel separately even when their keys match", () => {
    const excel = { ...personal, application: "Microsoft Excel", keys: "Ctrl + S", title: "Save workbook" };
    const folders = registryFolders([...builtInEntries, excel]);
    expect(folders.map(folder => folder.application)).toEqual(["Microsoft Excel", "Microsoft Word"]);
    expect(folders[0].entries).toEqual([excel]);
    expect(folders[1].total).toBe(22);
    expect(registryFolders([...builtInEntries, excel], [], { query: "Ctrl+S", application: "Microsoft Excel" })[0].entries).toEqual([excel]);
  });
  it("preserves empty named folders across reload and deduplicates folder names", () => {
    storage(); saveRegistryFolders([" Microsoft Excel ", "microsoft excel"]);
    expect(loadRegistryFolders()).toEqual(["Microsoft Excel"]);
    const folders = registryFolders(builtInEntries, loadRegistryFolders());
    expect(folders[0]).toEqual({ application: "Microsoft Excel", total: 0, entries: [] });
    expect(registryFolders(builtInEntries, loadRegistryFolders(), { application: "Microsoft Excel" })[0].total).toBe(0);
    expect(registryFolders(builtInEntries, loadRegistryFolders(), { query: "no matching entry" })).toEqual([]);
  });
  it("prevents invalid folder writes from replacing saved folder names", () => {
    const values = storage(); saveRegistryFolders(["Microsoft Excel"]);
    expect(() => saveRegistryFolders([""])).toThrow();
    expect(loadRegistryFolders()).toEqual(["Microsoft Excel"]);
    values.set(REGISTRY_FOLDERS_KEY, "broken-json");
    expect(renderToStaticMarkup(<ShortcutRegistry />)).toContain("Stored folder data has been preserved");
    expect(values.get(REGISTRY_FOLDERS_KEY)).toBe("broken-json");
  });
});
