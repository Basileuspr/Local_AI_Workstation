import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const { buildContextMenu } = createRequire(import.meta.url)("../../electron/contextMenu");

function contents() {
  return { replaceMisspelling: vi.fn(), session: { addWordToSpellCheckerDictionary: vi.fn() }, inspectElement: vi.fn() };
}

describe("spelling correction menu", () => {
  it("replaces the clicked misspelling with the chosen suggestion and keeps editing actions", () => {
    const page = contents();
    const items = buildContextMenu({ isEditable: true, misspelledWord: "recieve", dictionarySuggestions: ["receive", "recipe", "A&B"], editFlags: { canUndo: true, canRedo: false, canCopy: true, canPaste: true } }, page);
    items.find(item => item.label === "receive").click();
    expect(page.replaceMisspelling).toHaveBeenCalledWith("receive");
    items.find(item => item.label === "A&&B").click();
    expect(page.replaceMisspelling).toHaveBeenLastCalledWith("A&B");
    expect(items.find(item => item.role === "undo").enabled).toBe(true);
    expect(items.find(item => item.role === "redo").enabled).toBe(false);
    expect(items.find(item => item.role === "paste").enabled).toBe(true);
  });

  it("can remember a custom word even when the dictionary has no suggestions", () => {
    const page = contents();
    const items = buildContextMenu({ isEditable: true, misspelledWord: "Zorvellan", dictionarySuggestions: [] }, page);
    expect(items[0]).toEqual({ label: "No spelling suggestions", enabled: false });
    items.find(item => item.label === "Add to dictionary").click();
    expect(page.session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith("Zorvellan");
    expect(page.replaceMisspelling).not.toHaveBeenCalled();
  });

  it.each([
    { isEditable: false, misspelledWord: "typo", dictionarySuggestions: ["type"] },
    { isEditable: true, inputFieldType: "password", misspelledWord: "typo", dictionarySuggestions: ["type"] },
    { isEditable: true, misspelledWord: "", dictionarySuggestions: [] },
  ])("does not offer spelling actions for non-editable text, passwords, or correct words", (params) => {
    const items = buildContextMenu(params, contents());
    expect(items.some(item => item.label === "Add to dictionary")).toBe(false);
    expect(items.some(item => item.label === "type")).toBe(false);
  });
});
