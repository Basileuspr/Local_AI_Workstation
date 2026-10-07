import { sortNamedItems } from "./alphabetical";
import { appTabs, appTabLabels } from "./navigation";
import windowsUtilities from './windowsUtilities.json';

export const utilityActions = windowsUtilities.map(item => ({ ...item, id: `utility:${item.id}` }));

export const desktopActions = [
  { id: "system:snipping-tool", name: "Windows Snipping Tool", description: "Choose an area of the screen to capture." },
  { id: "system:open-powershell", name: "Open PowerShell", description: "Open an interactive PowerShell window." },
  { id: "system:update-programs", name: "Update Installed Programs", description: "Open a terminal and install available WinGet updates." },
  { id: "system:refresh-graphics", name: "Refresh GPU Driver", description: "Reset Windows graphics. The screen may briefly flicker or beep." },
];
export const captureActions = appTabs.map(tab => ({ id: `capture:${tab}`, name: `Capture ${appTabLabels[tab]} Tab`, description: "Copy a maximized view to the clipboard without leaving this tab." }));

export const FUNCTION_BUTTONS_STORAGE_KEY = "local-ai-workstation-function-buttons-v1";
export const functionTargets = [
  { id: "info-center", name: "Info Center" },
  { id: "shortcuts", name: "Shortcut Registry" },
  { id: "audio", name: "Audio" },
  { id: "browser", name: "Browser" },
  { id: "js-viewer", name: "JavaScript Viewer" },
  { id: "markdown", name: "Markdown Viewer" },
  { id: "html-viewer", name: "HTML Viewer" },
  { id: "css-viewer", name: "CSS / Styling" },
  { id: "styling-library", name: "Styling Library" },
  { id: "sound-mixer", name: "Sound Mixer" },
  { id: "spreadsheets", name: "Spreadsheets" },
  { id: "canvas", name: "Canvas" },
  { id: "document-editor", name: "Document Editor" },
  { id: "converter", name: "File Converter" },
  { id: "slicer", name: "3D Slicer" },
  { id: "integrations", name: "Linked applications" },
  { id: "packager", name: "Packager" },
  { id: "hash-auditor", name: "Hash Auditor" },
  { id: "folder-review", name: "Folder Review" },
  { id: "gif-maker", name: "GIF Maker" },
  { id: "chats", name: "Chats" },
  { id: "library", name: "Index" },
  { id: "knowledge", name: "Knowledge" },
  { id: "images", name: "Image Gallery" },
  { id: "image-manager", name: "Image Manager" },
  { id: "generate", name: "Generate Images" },
  { id: "review", name: "Image Review" },
  { id: "image-editor", name: "Image Editor" },
  { id: "workflows", name: "Image Workflows" },
  { id: "media-manager", name: "Media Manager" },
  { id: "faces", name: "Faces" },
  { id: "characters", name: "Character Creator" },
  { id: "character-parts", name: "Character Parts" },
  { id: "lora", name: "LoRA" },
  { id: "dashboard", name: "Dashboard" },
  { id: "queue", name: "Prompt Queue" },
  { id: "university", name: "University" },
  { id: "agent-university", name: "Agent University" },
  { id: "neural-network", name: "Neural Network" },
  { id: "break-room", name: "Break Room" },
  ...desktopActions,
  ...utilityActions,
  ...captureActions,
];

function validateButtons(buttons) {
  if (!Array.isArray(buttons)) throw new Error("Invalid function buttons");
  const ids = new Set();
  for (const button of buttons) {
    if (!button || typeof button.id !== "string" || !button.id || ids.has(button.id)
      || typeof button.name !== "string" || !button.name.trim()
      || !(functionTargets.some(target => target.id === button.target) || /^program:[a-f0-9-]{36}$/.test(button.target))) {
      throw new Error("Invalid function button");
    }
    ids.add(button.id);
  }
  return sortNamedItems(buttons);
}

export function loadFunctionButtons() {
  return validateButtons(JSON.parse(localStorage.getItem(FUNCTION_BUTTONS_STORAGE_KEY) || "[]"));
}

export function saveFunctionButtons(buttons) {
  const sorted = validateButtons(buttons);
  localStorage.setItem(FUNCTION_BUTTONS_STORAGE_KEY, JSON.stringify(sorted));
  return sorted;
}
