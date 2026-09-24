import { describe, expect, it } from "vitest";
import { latestRequest } from "../../src/faceApi";

describe("face dataset loads", () => {
  it("keeps only the newest load current, so a slow earlier dataset cannot replace the selected one", async () => {
    const claim = latestRequest();
    const shown = [];
    const load = async (id, delay) => {
      const isCurrent = claim();
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (isCurrent()) shown.push(id);
    };
    await Promise.all([load("first", 30), load("second", 5)]);
    expect(shown).toEqual(["second"]);
  });

  it("supersedes an earlier load of the same dataset", () => {
    const claim = latestRequest();
    const first = claim();
    const second = claim();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });
});
