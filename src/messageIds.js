export function createMessageId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `message-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
