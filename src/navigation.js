export const NAVIGATION_STORAGE_KEY = "local-ai-workstation-navigation-v1";
export const appTabs = ["chats", "images", "generate", "library", "knowledge", "dashboard", "queue", "review", "image-editor", "media-manager", "workflows", "lora", "faces", "character-parts"];

export function loadNavigation() {
  try {
    const saved = JSON.parse(localStorage.getItem(NAVIGATION_STORAGE_KEY));
    return {
      tab: appTabs.includes(saved?.tab) ? saved.tab : "chats",
      sessionId: typeof saved?.sessionId === "string" ? saved.sessionId : null,
    };
  } catch { return { tab: "chats", sessionId: null }; }
}

export function saveNavigation(tab, sessionId) {
  try {
    localStorage.setItem(NAVIGATION_STORAGE_KEY, JSON.stringify({
      tab: appTabs.includes(tab) ? tab : "chats",
      sessionId: typeof sessionId === "string" ? sessionId : null,
    }));
  } catch { /* Navigation still works when browser storage is unavailable. */ }
}
