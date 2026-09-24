import { API_BASE, apiUrl } from "./api";

export function localImageUrl(value) {
  if (typeof value !== "string") return null;
  if (/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(value)) return value;
  if (value.startsWith("blob:") && typeof window !== "undefined" && value.startsWith(`blob:${window.location.origin}/`)) return value;
  try {
    const url = new URL(value, API_BASE);
    if (url.origin !== new URL(API_BASE).origin || url.username || url.password) return null;
    if (!/^\/(sessions\/|image-library\/|image-generation\/outputs\/|image-workflows\/|faces\/datasets\/|character-parts\/datasets\/)/.test(url.pathname)) return null;
    url.searchParams.delete("law_token");
    return apiUrl(url.pathname + url.search);
  } catch { return null; }
}

export function chatImage(image, messageId, sessionId, index, resolvedUrl) {
  return { ...image, id: `${messageId}:${image.id || index}`, image_id: image.id, chat_session_id: sessionId, name: image.name || "Chat image", url: resolvedUrl,
    ...(sessionId && image.id && !/^(data:|blob:)/.test(resolvedUrl) ? { session_id: sessionId, message_id: messageId } : {}) };
}
