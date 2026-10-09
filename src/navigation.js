export const NAVIGATION_STORAGE_KEY = "local-ai-workstation-navigation-v1";
export const REFRESH_NAVIGATION_KEY = "local-ai-workstation-refresh-navigation-v1";
export const appTabs = ["shortcuts", "audio", "browser", "3d-viewer", "local-files", "document-editor", "js-viewer", "spreadsheets", "canvas", "converter", "packager", "hash-auditor", "folder-review", "gif-maker", "markdown", "html-viewer", "css-viewer", "chats", "images", "generate", "library", "knowledge", "tools", "dashboard", "queue", "review", "image-editor", "image-manager", "media-manager", "workflows", "lora", "faces", "characters", "character-parts", "university", "agent-university", "neural-network", "break-room"];
export const appTabLabels = { shortcuts: "Shortcut Registry", audio: "Audio", spreadsheets: "Spreadsheets", canvas: "Canvas", converter: "File Converter", packager: "Packager", "hash-auditor": "Hash Auditor", "folder-review": "Folder Review", "gif-maker": "GIF Maker", browser: "Browser", "3d-viewer": "3D Viewer & Editor", "local-files": "Local Files", "document-editor": "Document Editor", "js-viewer": "JavaScript Viewer", markdown: "Markdown Viewer", "html-viewer": "HTML Viewer", "css-viewer": "CSS / Styling", chats: "Chat", images: "Image Gallery", generate: "Generate", library: "Index", knowledge: "Knowledge", tools: "Functions", dashboard: "Dashboard", queue: "Prompt Queue", review: "Image Review", "image-editor": "Image Editor", "image-manager": "Image Manager", "media-manager": "Media Manager", workflows: "Image Workflows", lora: "LoRA", faces: "Faces", characters: "Character Creator", "character-parts": "Character Parts" };

Object.assign(appTabLabels, { university: 'University', 'agent-university': 'Agent University', 'neural-network': 'Neural Network', 'break-room': 'Break Room' });

appTabs.push('slicer', 'integrations', 'styling-library', 'sound-mixer', 'info-center');
appTabs.push('reels-analyzer');
appTabs.push('web-system');
appTabLabels['web-system'] = 'Web Research & Sources';
appTabLabels['reels-analyzer'] = 'Reels Analyzer';
appTabLabels['info-center'] = 'Info Center';
Object.assign(appTabLabels, {slicer: '3D Slicer', integrations: 'Linked applications', 'styling-library': 'Styling Library', 'sound-mixer':'Sound Mixer'});

export function resolveActiveTab(tab) {
  return appTabs.includes(tab) ? tab : "chats";
}

// A launch starts blank. Only the explicit Refresh control carries a view
// through a reload, using a one-time marker that does not survive app closure.
export function loadStartupNavigation(startupBehavior = "new") {
  try {
    const value = sessionStorage.getItem(REFRESH_NAVIGATION_KEY);
    const saved = JSON.parse(value);
    if (saved) return { tab: resolveActiveTab(saved?.tab), sessionId: typeof saved?.sessionId === "string" ? saved.sessionId : null };
  } catch { return { tab: "chats", sessionId: null }; }
  if (startupBehavior === "resume") {
    try {
      const saved = JSON.parse(localStorage.getItem(NAVIGATION_STORAGE_KEY));
      return { tab: "chats", sessionId: typeof saved?.lastSessionId === "string" ? saved.lastSessionId : typeof saved?.sessionId === "string" ? saved.sessionId : null };
    } catch { /* A missing last chat leaves a blank chat. */ }
  }
  return { tab: "chats", sessionId: null };
}

export function clearRefreshNavigation() {
  try { sessionStorage.removeItem(REFRESH_NAVIGATION_KEY); } catch { /* Storage may be unavailable. */ }
}

export function rememberRefreshNavigation(tab, sessionId) {
  try { sessionStorage.setItem(REFRESH_NAVIGATION_KEY, JSON.stringify({ tab: resolveActiveTab(tab), sessionId: typeof sessionId === "string" ? sessionId : null })); }
  catch { /* Reload still works; unavailable storage opens a blank chat. */ }
}

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
    let previous;
    try { previous = JSON.parse(localStorage.getItem(NAVIGATION_STORAGE_KEY)); } catch { /* Replace damaged state. */ }
    localStorage.setItem(NAVIGATION_STORAGE_KEY, JSON.stringify({
      tab: appTabs.includes(tab) ? tab : "chats",
      sessionId: typeof sessionId === "string" ? sessionId : null,
      lastSessionId: typeof sessionId === "string" ? sessionId : previous?.lastSessionId || previous?.sessionId || null,
    }));
  } catch { /* Navigation still works when browser storage is unavailable. */ }
}
