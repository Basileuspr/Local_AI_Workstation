import { API_BASE, API_TOKEN } from "./config";

const thumbnailRoutes = [
  /^\/sessions\/[^/]+\/images\//,
  /^\/image-library\/images\/[^/]+\/content$/,
  /^\/web\/images\/[^/]+$/,
  /^\/workspaces\/converted\/[^/]+$/,
  /^\/lora\/projects\/[^/]+\/images\/[^/]+$/,
  /^\/faces\/datasets\/[^/]+\/faces\/[^/]+\/crop$/,
  /^\/image-workflows\/[^/]+\/assets\/[^/]+$/,
  /^\/image-workflows\/[^/]+\/jobs\/[^/]+\/(outputs|stitched)\/[^/]+$/,
  /^\/character-parts\/datasets\/[^/]+\/(sources\/[^/]+\/image|selections\/[^/]+\/crop)$/,
];

// Image URLs can arrive already resolved from another workspace. Never prefix
// them twice, or send the per-launch credential to a different origin.
export function imageSourceUrl(source, { base = API_BASE, token = API_TOKEN } = {}) {
  if (typeof source !== "string" || !source.trim()) return "";
  if (/^(blob:|data:image\/)/i.test(source)) return source;
  try {
    const url = new URL(source, base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    url.searchParams.delete("law_token");
    if (url.origin === new URL(base).origin) {
      if (token) url.searchParams.set("law_token", token);
    }
    return url.href;
  } catch { return ""; }
}

export function imagePreviewUrl(source, { thumbnail = false, privacy = 0, retry = 0, base = API_BASE, token = API_TOKEN } = {}) {
  const resolved = imageSourceUrl(source, { base, token });
  if (!resolved || /^(blob:|data:)/i.test(resolved)) return resolved;
  const url = new URL(resolved);
  if (url.origin !== new URL(base).origin) return resolved;
  if (thumbnail && thumbnailRoutes.some(route => route.test(url.pathname))) url.searchParams.set("thumbnail", "true");
  if (privacy) url.searchParams.set("privacy", String(privacy));
  if (retry) url.searchParams.set("preview_retry", String(retry));
  return url.href;
}
