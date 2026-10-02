import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import LockedImages from "../../src/components/LockedImages";
import {WorkspaceHelpContent} from '../../src/components/WorkspaceInfo';

it("offers cancellation before PIN setup or unlock and before importing images", () => {
  const html = renderToStaticMarkup(<LockedImages active pendingOnly pending={[{id:"one"}]} onCancel={() => {}} />);
  expect(html).toContain('aria-label="Lock selected images"');
  expect(html).toMatch(/<button type="button"[^>]*>Cancel<\/button>/);
  expect(renderToStaticMarkup(<WorkspaceHelpContent tab="images"/>)).toContain('<dt>Cancel / Escape</dt>');
  expect(html).toContain("Checking lock settings");
  expect(html).not.toContain('role="alert"');
  expect(html).not.toContain("Restore selected images");
});

it("keeps the regular Locked Images collection as a page", () => {
  const html = renderToStaticMarkup(<LockedImages active />);
  expect(html).not.toContain('aria-label="Lock selected images"');
  expect(html).toContain('aria-label="Locked Images"');
});
