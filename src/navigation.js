export const NAVIGATION_STORAGE_KEY = "local-ai-workstation-navigation-v1";
export const appTabs = ["audio", "browser", "js-viewer", "spreadsheets", "canvas", "converter", "packager", "gif-maker", "markdown", "html-viewer", "css-viewer", "chats", "images", "generate", "library", "knowledge", "tools", "dashboard", "queue", "review", "image-editor", "media-manager", "workflows", "lora", "faces", "characters", "character-parts"];
export const appTabLabels = { audio: "Audio", spreadsheets: "Spreadsheets", canvas: "Canvas", converter: "File Converter", packager: "Packager", "gif-maker": "GIF Maker", browser: "Browser", "js-viewer": "JavaScript Viewer", markdown: "Markdown Viewer", "html-viewer": "HTML Viewer", "css-viewer": "CSS / Styling", chats: "Chat", images: "Image Gallery", generate: "Generate", library: "Prompt Index", knowledge: "Knowledge", tools: "Functions", dashboard: "Dashboard", queue: "Prompt Queue", review: "Image Review", "image-editor": "Image Editor", "media-manager": "Media Manager", workflows: "Image Workflows", lora: "LoRA", faces: "Faces", characters: "Character Creator", "character-parts": "Character Parts" };

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
