import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { dragBox, newSelection, selectionPayload, filterSelections, coverage, focusFilters, expandBox, earlierFocus } from "../../src/characterParts";
import CharacterSilhouette from "../../src/components/CharacterSilhouette";

describe("character region curation", () => {
  it("supports reverse-direction crop drags and confines rectangles to the image", () => {
    expect(dragBox([.8, .9], [.2, .1])).toEqual([.2, .1, .8, .9]);
    expect(dragBox([.2, .3], [2, -1])).toEqual([.2, 0, 1, .3]);
  });
  it("submits only editable selection fields while preserving a zero crop edge", () => {
    const initial = newSelection("a".repeat(64), "finger", "left");
    expect(initial.export_mode).toBe("both");
    expect(initial.state).toBe("pending");
    expect(selectionPayload({ ...initial, id: "selection", origin: "vision", model: "local", created_at: "today" })).toEqual(initial);
  });
  it("filters region, side, view, source and review state independently", () => {
    const left = { ...newSelection("source-a", "hand", "left"), view: "front", state: "accepted" };
    const right = { ...newSelection("source-a", "hand", "right"), view: "back", state: "rejected" };
    const toe = { ...newSelection("source-b", "toe", "left"), view: "left_side" };
    expect(filterSelections([left, right, toe], { part: "hand", side: "left", view: "front", state: "accepted" })).toEqual([left]);
    expect(filterSelections([left, right, toe], { sourceId: "source-a" })).toEqual([left, right]);
    expect(filterSelections([left, right, toe], { state: "rejected" })).toEqual([right]);
  });
  it("counts distinct accepted sources rather than overlapping crops for training coverage", () => {
    const sample = { ...newSelection("source-a", "hand", "left"), view: "front", state: "accepted" };
    expect(coverage([sample, { ...sample, side: "right" }, { ...sample, source_id: "source-b" }, { ...sample, source_id: "source-c", state: "rejected" }])).toEqual({ "hand:front": 2 });
  });
  it("makes silhouette regions accessible with anatomical left and right labels", () => {
    const parts = Object.fromEntries(["torso", "arm", "hand", "pelvis", "leg", "foot", "eye", "mouth", "body", "back", "finger", "toe", "buttocks", "custom"].map(id => [id, id]));
    const html = renderToStaticMarkup(<CharacterSilhouette part="hand" side="left" catalog={{ parts, sides: { left: "Character's left", right: "Character's right" } }} onSelect={() => {}} />);
    expect(html).toContain('role="button" tabindex="0"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Character&#x27;s left");
    expect(html).toContain("finger"); expect(html).toContain("toe");
  });
  it("keeps custom focuses distinct while comparing all sides and views of the named area", () => {
    const reference = { ...newSelection("a", "custom", "left"), detail: "Hip transition", view: "back", state: "accepted" };
    const otherView = { ...reference, source_id: "b", side: "right", view: "right_side", state: "pending" };
    const unrelated = { ...reference, detail: "Jacket folds" };
    expect(filterSelections([reference, otherView, unrelated], focusFilters(reference))).toEqual([reference, otherView]);
  });
  it("expands surrounding context without cropping outside the source", () => {
    const expanded = expandBox([.8, .7, 1, .9]);
    expect(expanded[0]).toBeCloseTo(.77); expect(expanded[1]).toBeCloseTo(.67);
    expect(expanded[2]).toBe(1); expect(expanded[3]).toBeCloseTo(.93);
    expect(expandBox([0, 0, 1, 1])).toEqual([0, 0, 1, 1]);
  });
  it("identifies comparison notes made before the reference crop was changed", () => {
    const reference = { ...newSelection("source", "buttocks"), id: "reference", box: [.2, .3, .8, .7] };
    const candidate = { focus: { ...reference, selection_id: reference.id } };
    expect(earlierFocus(candidate, reference)).toBe(false);
    expect(earlierFocus(candidate, { ...reference, box: [.2, .2, .8, .8] })).toBe(true);
    expect(earlierFocus(candidate, { ...reference, id: "other" })).toBe(true);
    expect(earlierFocus(candidate, null)).toBe(false);
  });
  it("shows a selectable glute region in the back silhouette with correct anatomical sides", () => {
    const parts = Object.fromEntries(["torso", "arm", "hand", "pelvis", "leg", "foot", "eye", "mouth", "body", "back", "finger", "toe", "buttocks", "custom"].map(id => [id, id]));
    const html = renderToStaticMarkup(<CharacterSilhouette part="buttocks" side="unspecified" catalog={{ parts, sides: { left: "Character's left", right: "Character's right" } }} onSelect={() => {}} />);
    expect(html).toContain('aria-label="Character silhouette, back view"');
    expect(html).toContain('aria-label="buttocks" aria-pressed="true"');
    expect(html).not.toContain('aria-label="eye');
    expect(html).toContain('<text x="16" y="61">L</text>');
    expect(html).toContain('aria-label="arm · Character&#x27;s left"');
  });
});
