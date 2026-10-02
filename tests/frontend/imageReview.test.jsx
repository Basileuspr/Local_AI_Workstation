import React from "react";
import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { matchesImageTags, reviewImages, isReviewUpload, reviewFileMessage, canReadReviewImage } from "../../src/imageReview";
import ImageReviewMetadata from "../../src/components/ImageReviewMetadata";
import ImageTagButtons from "../../src/components/ImageTagButtons";
import { WorkspaceHelpContent } from "../../src/components/WorkspaceInfo";

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
  expect(html).toContain("Tag this image");
  expect(html).not.toContain("New tags are applied to this image automatically");
  const filters = renderToStaticMarkup(<ImageTagButtons filtering tags={[{ id: "face", name: "GOOD FACE" }]} selected={["face"]} />);
  expect(filters).toContain('aria-pressed="true"');
  expect(filters).toContain("Clear tag filters");
  const guide = renderToStaticMarkup(<WorkspaceHelpContent tab="images" />);
  expect(guide).toContain("A new tag is applied to the current image");
  expect(guide).toContain("Tag filters match every selected tag");
});

it('retains missing items in review while displaying their saved classification', () => {
  const missing={...images[1],file_state:'missing',category:'Reference',project:'Album',favorite:true,review_status:'accepted',path:'C:/fixture/photo.png'};
  expect(reviewImages([missing],'liked')).toEqual([missing]);
  expect(canReadReviewImage(missing)).toBe(false);
  expect(canReadReviewImage(images[1])).toBe(true);
  const html=renderToStaticMarkup(<ImageReviewMetadata image={missing} tags={[]} onSaved={()=>{}} />);
  expect(html).toContain('Image file is missing');
  expect(html).toContain('Saved review metadata is retained');
  expect(html).toContain('Reference');expect(html).toContain('Album');expect(html).toContain('accepted');
  expect(html).toContain('C:/fixture/photo.png');
  expect(html).toContain('Sunlit portrait');
  expect(reviewFileMessage({file_state:'unavailable'})).toContain('storage is unavailable');
});
