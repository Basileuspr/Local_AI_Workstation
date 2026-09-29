import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { hasImageSeed } from "../../src/imageSeed";
import ImageSeedControls from "../../src/components/ImageSeedControls";

describe("recorded image seeds", () => {
  it.each([0, 184726, 2147483647])("displays usable seed %i with copy and reuse actions", seed => {
    const html = renderToStaticMarkup(<ImageSeedControls seed={seed} />);
    expect(html).toContain(`<code>${seed}</code>`);
    expect(html).toContain("Copy Seed");
    expect(html).toContain("Use This Seed");
  });
  it.each([undefined, null, "", "0", false, -1, 1.5, 2147483648])("does not invent a seed for %s", seed => {
    expect(hasImageSeed(seed)).toBe(false);
    expect(renderToStaticMarkup(<ImageSeedControls seed={seed} />)).toBe("");
    expect(renderToStaticMarkup(<ImageSeedControls seed={seed} showMissing />)).toContain("Seed not recorded");
  });
});
