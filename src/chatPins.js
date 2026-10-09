import { appTabs, appTabLabels } from "./navigation";

export const CHAT_PINS_KEY = "local-ai-workstation-chat-pins-v1";
export const WORKSPACE_PINS_KEY = "local-ai-workstation-workspace-pins-v1";
export const workspacePinnableTabs = [...appTabs]
  .sort((a, b) => appTabLabels[a].localeCompare(appTabLabels[b]));
export const pinnableTabs = appTabs.filter(tab => tab !== "chats")
  .sort((a, b) => appTabLabels[a].localeCompare(appTabLabels[b]));

export function validChatPin(value) {
  if (value?.kind === "chat" && (value.sessionId == null || /^[A-Za-z0-9_-]{1,200}$/.test(value.sessionId)))
    return { kind: "chat", sessionId: value.sessionId || null };
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

export function validWorkspacePin(activeTab, value) {
  if (appTabs.includes(activeTab) && activeTab !== "chats" && value?.kind === "tool"
    && appTabs.includes(value.tab) && value.tab !== activeTab) return { kind: "tool", tab: value.tab };
  return null;
}

export function loadWorkspacePins() {
  try {
    const raw = JSON.parse(localStorage.getItem(WORKSPACE_PINS_KEY));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).flatMap(([tab, value]) => {
      const pin = validWorkspacePin(tab, value);
      return pin ? [[tab, pin]] : [];
    }));
  } catch { return {}; }
}

export function workspaceVisible(activeTab, pin, tab, workspacePin = null) {
  const selected = activeTab === "chats" ? pin : validWorkspacePin(activeTab, workspacePin);
  return activeTab === tab || selected?.kind === "tool" && selected.tab === tab;
}
