import { sortNamedItems } from "./alphabetical";
import { appTabs, appTabLabels } from "./navigation";

export const desktopActions = [
  { id: "system:snipping-tool", name: "Windows Snipping Tool", description: "Choose an area of the screen to capture." },
  { id: "system:open-powershell", name: "Open PowerShell", description: "Open an interactive PowerShell window." },
  { id: "system:update-programs", name: "Update Installed Programs", description: "Open a terminal and install available WinGet updates." },
  { id: "system:refresh-graphics", name: "Refresh GPU Driver", description: "Reset Windows graphics. The screen may briefly flicker or beep." },
];
export const captureActions = appTabs.map(tab => ({ id: `capture:${tab}`, name: `Capture ${appTabLabels[tab]} Tab`, description: "Copy a maximized view to the clipboard without leaving this tab." }));

export const FUNCTION_BUTTONS_STORAGE_KEY = "local-ai-workstation-function-buttons-v1";
export const functionTargets = [
  { id: "markdown", name: "Markdown Viewer" },
  { id: "html-viewer", name: "HTML Viewer" },
  { id: "css-viewer", name: "CSS / Styling" },
  { id: "spreadsheets", name: "Spreadsheets" },
  { id: "canvas", name: "Canvas" },
  { id: "converter", name: "File Converter" },
  { id: "chats", name: "Chats" },
  { id: "library", name: "Prompt Index" },
  { id: "knowledge", name: "Knowledge" },
  { id: "images", name: "Image Gallery" },
  { id: "generate", name: "Generate Images" },
  { id: "review", name: "Image Review" },
  { id: "image-editor", name: "Image Editor" },
  { id: "workflows", name: "Image Workflows" },
  { id: "media-manager", name: "Media Manager" },
  { id: "faces", name: "Faces" },
  { id: "character-parts", name: "Character Parts" },
  { id: "lora", name: "LoRA" },
  { id: "dashboard", name: "Dashboard" },
  { id: "queue", name: "Prompt Queue" },
  ...desktopActions,
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
