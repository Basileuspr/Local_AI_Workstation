export const CHAT_WIDTH = { min: 640, max: 1600, step: 20, default: 800 };

export function normalizeChatWidth(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return CHAT_WIDTH.default;
  return Math.min(CHAT_WIDTH.max, Math.max(CHAT_WIDTH.min,
    Math.round(value / CHAT_WIDTH.step) * CHAT_WIDTH.step));
}
