import { appTabs, appTabLabels } from "./navigation";

export const CHAT_PINS_KEY = "local-ai-workstation-chat-pins-v1";
export const pinnableTabs = appTabs.filter(tab => tab !== "chats")
  .sort((a, b) => appTabLabels[a].localeCompare(appTabLabels[b]));

export function validChatPin(value) {
  if (value?.kind === "tool" && pinnableTabs.includes(value.tab)) return { kind: "tool", tab: value.tab };
  if (value?.kind === "document" && /^[a-f0-9]{32}$/.test(value.artifactId || "")) return { kind: "document", artifactId: value.artifactId };
  if (value?.kind === "message" && typeof value.messageId === "string" && value.messageId.length <= 200 && value.messageId)
    return { kind: "message", messageId: value.messageId };
  return null;
}

export function loadChatPins() {
  try {
    const raw = JSON.parse(localStorage.getItem(CHAT_PINS_KEY));
    return Object.fromEntries(Object.entries(raw || {}).filter(([id, pin]) => /^[A-Za-z0-9_-]+$/.test(id) && validChatPin(pin))
      .map(([id, pin]) => [id, validChatPin(pin)]));
  } catch { return {}; }
}

export function workspaceVisible(activeTab, pin, tab) {
  return activeTab === tab || activeTab === "chats" && pin?.kind === "tool" && pin.tab === tab;
}
