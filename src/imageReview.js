export function matchesImageTags(image, selectedIds) {
  const assigned = new Set(image.tag_ids || []);
  return selectedIds.every(id => assigned.has(id));
}

export const reviewStatuses = ['unreviewed', 'reviewed', 'accepted', 'rejected'];
export const reviewStatusLabels = { unreviewed: 'To review', reviewed: 'Reviewed (no rating)', accepted: 'Liked', rejected: 'Disliked' };
export function reviewStatus(image) {
  return image.review_status || ({ liked: 'accepted', disliked: 'rejected' })[image.rating] || 'unreviewed';
}
export function completeReview(image) {
  const status = reviewStatus(image);
  return { review_status: status === 'unreviewed' ? 'reviewed' : status,
    rating: ({ accepted: 'liked', rejected: 'disliked' })[status] || null };
}

export function reviewImages(images, folder, selectedIds = [], query = "", favoritesOnly = false) {
  const text = query.trim().toLowerCase();
  return images.filter(image => !image.hidden && (!favoritesOnly || image.favorite)
    && (folder === 'all' ? true : folder === 'favorites' ? image.favorite : reviewStatus(image) === ({pending:'unreviewed',liked:'accepted',disliked:'rejected'})[folder] || reviewStatus(image) === folder)
    && matchesImageTags(image, selectedIds)
    && `${image.name} ${image.annotations?.caption || ""}`.toLowerCase().includes(text));
}

export function isReviewUpload(image) {
  return image.review_only || ["upload", "review"].includes(image.origin?.kind);
}

export function reviewFileMessage(image) {
  return ({missing: 'Image file is missing. Restore its storage, then refresh REVIEW.',
    unavailable: 'Image storage is unavailable. Reconnect its storage, then refresh REVIEW.',
    changed: 'Image changed since scanning. Scan the folder again before using it.'})[image?.file_state] || '';
}

export function canReadReviewImage(image) {
  return !reviewFileMessage(image);
}
