import { afterEach, describe, expect, it, vi } from "vitest";
import { copyPromptPhrase, loadPromptPhrases, PHRASES_STORAGE_KEY, savePromptPhrases } from "../../src/promptPhrases";

afterEach(() => vi.unstubAllGlobals());

describe("saved phrase buttons", () => {
  it("round trips emoji labels and exact phrase whitespace", () => {
    const entries = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key) => entries.get(key), setItem: (key, value) => entries.set(key, value),
    });
    expect(loadPromptPhrases()).toEqual([]);
    const phrases = [{ id: "one", name: "🚫💪", text: " malformed limbs,\nextra arms, " }];
    savePromptPhrases(phrases);
    expect(loadPromptPhrases()).toEqual(phrases);
    savePromptPhrases([]);
    expect(loadPromptPhrases()).toEqual([]);
  });

  it("ignores malformed entries and duplicate IDs without breaking usable buttons", () => {
    const valid = { id: "one", name: "🚫💪", text: "bad anatomy" };
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify([null, {}, valid, valid, { id: "two", name: " ", text: "x" }]) });
    expect(loadPromptPhrases()).toEqual([valid]);
  });

  it("surfaces load/save failures instead of pretending data was persisted", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "{bad json", setItem: vi.fn(() => { throw new Error("quota"); }),
    });
    expect(loadPromptPhrases).toThrow();
    expect(() => savePromptPhrases([])).toThrow("quota");
    expect(localStorage.setItem).toHaveBeenCalledWith(PHRASES_STORAGE_KEY, "[]");
  });
});

describe("copy while keeping the prompt ready", () => {
  it("focuses immediately and never steals focus when an asynchronous copy finishes", async () => {
    let finish;
    const writeText = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const target = { isConnected: true, disabled: false, focus: vi.fn() };
    const pending = copyPromptPhrase("extra arms, ", target);
    expect(target.focus).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("extra arms, ");
    finish();
    await pending;
    expect(target.focus).toHaveBeenCalledTimes(1);
  });

  it("copies without focusing a disabled or removed prompt", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue() } });
    const target = { isConnected: true, disabled: true, focus: vi.fn() };
    await copyPromptPhrase("bad anatomy", target);
    target.disabled = false;
    target.isConnected = false;
    await copyPromptPhrase("bad anatomy", target);
    await copyPromptPhrase("bad anatomy", null);
    expect(target.focus).not.toHaveBeenCalled();
  });

  it("reports clipboard rejection", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    await expect(copyPromptPhrase("bad anatomy", null)).rejects.toThrow("denied");
  });

  it.each([true, false])("restores selection and removes the fallback input (copy success: %s)", async (success) => {
    vi.stubGlobal("navigator", {});
    const target = {
      isConnected: true, disabled: false, focus: vi.fn(),
      selectionStart: 3, selectionEnd: 9, selectionDirection: "backward", setSelectionRange: vi.fn(),
    };
    const input = { style: {}, select: vi.fn(), remove: vi.fn() };
    vi.stubGlobal("document", {
      activeElement: target, createElement: () => input,
      body: { appendChild: vi.fn() }, execCommand: vi.fn(() => success),
    });
    const pending = copyPromptPhrase("extra arms", target);
    if (success) await pending;
    else await expect(pending).rejects.toThrow("Clipboard unavailable");
    expect(input.value).toBe("extra arms");
    expect(input.remove).toHaveBeenCalledOnce();
    expect(target.setSelectionRange).toHaveBeenCalledWith(3, 9, "backward");
  });
});
