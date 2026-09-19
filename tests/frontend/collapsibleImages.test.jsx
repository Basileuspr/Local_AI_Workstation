import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import CollapsibleImageFolder from "../../src/components/CollapsibleImageFolder";

it("starts image folders collapsed without mounting thumbnails or private content", () => {
  const html = renderToStaticMarkup(<CollapsibleImageFolder name="Liked Images"><img src="/private" alt="Must stay hidden" /></CollapsibleImageFolder>);
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain("Show");
  expect(html).not.toContain("/private");
});
