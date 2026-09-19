/**
 * Blob references shared between the renderer and the backend.
 *
 * Images are stored once, addressed by the SHA-256 of their content, and the
 * session JSON holds only this reference. The renderer needs to recognise one
 * so it can request the bytes rather than trying to display the reference.
 */

const REFERENCE_PATTERN = /^blob:[0-9a-f]{64}$/;

export function isStoredReference(value) {
  return typeof value === "string" && REFERENCE_PATTERN.test(value);
}
