import React from "react";
import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { matchesImageTags, reviewImages, isReviewUpload } from "../../src/imageReview";
import ImageReviewMetadata from "../../src/components/ImageReviewMetadata";
import ImageTagButtons from "../../src/components/ImageTagButtons";

const images = [
  { id: "face", name: "Face", tag_ids: ["face"], rating: "liked" },
  { id: "both", name: "Both", tag_ids: ["face", "light", "extra"], rating: "liked", annotations: { caption: "Sunlit portrait" } },
  { id: "light", name: "Light", tag_ids: ["light"], rating: "liked" },
  { id: "none", name: "None", rating: null },
];
it("one selected tag retains images with additional tags", () => {
  expect(reviewImages(images, "liked", ["face"]).map(image => image.id)).toEqual(["face", "both"]);
});
it("multiple selected tags require all selected tags without rejecting extras", () => {
  expect(reviewImages(images, "liked", ["face", "light"]).map(image => image.id)).toEqual(["both"]);
  expect(matchesImageTags(images[1], ["face", "light", "missing"])).toBe(false);
});
it("clearing or removing tag filters broadens the selection and never mutates images", () => {
  expect(reviewImages(images, "liked", ["light"]).map(image => image.id)).toEqual(["both", "light"]);
  expect(reviewImages(images, "liked")).toHaveLength(3);
  expect(images[1].tag_ids).toEqual(["face", "light", "extra"]);
});
it("combines caption search, rating folders and tag filters without returning hidden images", () => {
  expect(reviewImages([...images, { ...images[1], id: "hidden", hidden: true }], "liked", ["face"], "sunlit").map(image => image.id)).toEqual(["both"]);
  expect(reviewImages(images, "pending").map(image => image.id)).toEqual(["none"]);
});
it("separates existing review uploads and newly uploaded duplicates from general images", () => {
  expect(isReviewUpload({ origin: { kind: "upload" } })).toBe(true);
  expect(isReviewUpload({ origin: { kind: "review" } })).toBe(true);
  expect(isReviewUpload({ origin: { kind: "session" }, review_only: true })).toBe(true);
  expect(isReviewUpload({ origin: { kind: "session" } })).toBe(false);
});
it("renders an editable caption and distinct assignment/filter tag controls", () => {
  const html = renderToStaticMarkup(<ImageReviewMetadata image={images[1]} tags={[]} onSaved={() => {}} />);
  expect(html).toMatch(/<textarea[^>]*aria-label="Image caption"[^>]*>Sunlit portrait<\/textarea>/);
  expect(html.match(/<textarea[^>]*>/)[0]).not.toMatch(/disabled|readonly|tabindex="-1"/i);
  expect(html).toContain("New tags are applied to this image automatically");
  const filters = renderToStaticMarkup(<ImageTagButtons filtering tags={[{ id: "face", name: "GOOD FACE" }]} selected={["face"]} />);
  expect(filters).toContain('aria-pressed="true"');
  expect(filters).toContain("Match every selected tag");
});
