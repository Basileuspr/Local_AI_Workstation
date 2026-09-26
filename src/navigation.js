export const NAVIGATION_STORAGE_KEY = "local-ai-workstation-navigation-v1";
export const appTabs = ["spreadsheets", "canvas", "converter", "markdown", "html-viewer", "css-viewer", "chats", "images", "generate", "library", "knowledge", "tools", "dashboard", "queue", "review", "image-editor", "media-manager", "workflows", "lora", "faces", "character-parts"];
export const appTabLabels = { spreadsheets: "Spreadsheets", canvas: "Canvas", converter: "File Converter", markdown: "Markdown Viewer", "html-viewer": "HTML Viewer", "css-viewer": "CSS / Styling", chats: "Chat", images: "Image Gallery", generate: "Generate", library: "Prompt Index", knowledge: "Knowledge", tools: "Functions", dashboard: "Dashboard", queue: "Prompt Queue", review: "Image Review", "image-editor": "Image Editor", "media-manager": "Media Manager", workflows: "Image Workflows", lora: "LoRA", faces: "Faces", "character-parts": "Character Parts" };

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
