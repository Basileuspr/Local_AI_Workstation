// Read the event's files synchronously: Windows/Chromium may clear the data
// transfer once the paste callback returns. Never fetch URLs from clipboard HTML.
export function clipboardFiles(data) {
  const listed = Array.from(data?.files || []);
  const items = Array.from(data?.items || []).filter(item => item.kind === "file");
  // These are two representations of the same files, not two sets to upload.
  const files = listed.length ? listed : items.map(item => item.getAsFile()).filter(Boolean);
  return { files, hasFiles: listed.length > 0 || items.length > 0 };
}

export async function pasteChatFiles(event, { busy, upload, onError }) {
  const { files, hasFiles } = clipboardFiles(event.clipboardData);
  if (!hasFiles) return false; // Leave text, selection replacement and undo native.
  event.preventDefault();
  if (busy) {
    onError("Wait for the current attachment or reply to finish, then paste again.");
    return false;
  }
  if (!files.length) {
    onError("The clipboard file could not be read. Save it and use Upload image or Upload document.");
    return false;
  }
  try { return await upload(files); }
  catch (error) {
    onError("Clipboard attachment failed: " + error.message);
    return false;
  }
}
