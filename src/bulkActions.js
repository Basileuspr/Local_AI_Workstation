// Sequential requests preserve each collection's existing deletion/recovery rules.
export async function processBatch(items, action, key = item => item.id) {
  const succeeded = [], failed = [], values = [], seen = new Set();
  for (const item of items) {
    if (seen.has(key(item))) continue;
    seen.add(key(item));
    try { values.push(await action(item)); succeeded.push(item); }
    catch (error) { failed.push({ item, error: error?.message || "Request failed" }); }
  }
  return { succeeded, failed, values };
}

export function batchFeedback(result, verb = "Removed") {
  const success = `${verb} ${result.succeeded.length} item${result.succeeded.length === 1 ? "" : "s"}.`;
  if (!result.failed.length) return success;
  const details = result.failed.slice(0, 3).map(({item, error}) => `${item.title || item.name || item.filename || item.original_filename || item.id || item.file}: ${error}`).join("; ");
  return `${success} ${result.failed.length} failed and remain selected. ${details}${result.failed.length > 3 ? "; …" : ""}`;
}

export function selectedItems(items, ids, key = item => item.id) {
  return items.filter(item => ids.has(key(item)));
}

// Older chats identify inline image-array entries by index. Delete from the end
// of each message so earlier removals cannot shift a later selected image's ID.
export function orderImageDeletions(images) {
  const parts = image => {
    const match = /^raw-(.+)-(\d+)$/.exec(image.image_id || "");
    return [image.session_id || "", match?.[1] || image.image_id || "", match ? Number(match[2]) : -1];
  };
  return [...images].sort((a, b) => {
    const left = parts(a), right = parts(b);
    return left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]) || right[2] - left[2];
  });
}
