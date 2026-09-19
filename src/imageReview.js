export function matchesImageTags(image, selectedIds) {
  const assigned = new Set(image.tag_ids || []);
  return selectedIds.every(id => assigned.has(id));
}

export function reviewImages(images, folder, selectedIds = [], query = "") {
  const text = query.trim().toLowerCase();
  return images.filter(image => !image.hidden && (folder === "pending" ? !image.rating : image.rating === folder)
    && matchesImageTags(image, selectedIds)
    && `${image.name} ${image.annotations?.caption || ""}`.toLowerCase().includes(text));
}

export function isReviewUpload(image) {
  return image.review_only || ["upload", "review"].includes(image.origin?.kind);
}
