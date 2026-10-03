const groups = [
  { id: "workspace", label: "Workspace", icon: "chat", items: [
    { id: "chats", label: "Chats" },
    { id: "library", label: "Index" },
    { id: "knowledge", label: "Knowledge" },
    { id: "canvas", label: "Canvas" },
    { id: "converter", label: "File Converter" },
    { id: "local-files", label: "Local Files" },
    { id: "document-editor", label: "Document Editor" },
    { id: "packager", label: "Packager" },
    { id: "hash-auditor", label: "Hash Auditor" },
    { id: "folder-review", label: "Folder Review" },
    { id: "audio", label: "Audio" },
    { id: "slicer", label: "3D Slicer" },
    { id: "integrations", label: "Linked applications" },
  ] },
  { id: "images", label: "Images", icon: "image", items: [
    { id: "images", label: "Gallery", title: "Image Gallery" },
    { id: "image-manager", label: "Image Manager" },
    { id: "generate", label: "Generate", title: "Generate Images" },
    { id: "review", label: "Review", title: "Image Review" },
    { id: "image-editor", label: "Editor", title: "Image Editor" },
    { id: "gif-maker", label: "GIF Maker", title: "GIF Maker workspace" },
    { id: "workflows", label: "Workflows", title: "Image Workflows" },
    { id: "media-manager", label: "Media Manager" },
  ] },
  { id: "characters", label: "Characters & Training", icon: "person", items: [
    { id: "characters", label: "Character Creator" },
    { id: "faces", label: "Faces" },
    { id: "character-parts", label: "Character Parts" },
    { id: "lora", label: "LoRA" },
  ] },
  { id: "learning", label: "Learning & Breaks", icon: "chat", items: [
    { id: "university", label: "University" },
    { id: "agent-university", label: "Agent University" },
    { id: "neural-network", label: "Neural Network" },
    { id: "break-room", label: "Break Room" },
  ] },
  { id: "viewers", label: "Viewers", icon: "chat", items: [
    { id: "browser", label: "Browser" },
    { id: "3d-viewer", label: "3D Viewer & Editor" },
    { id: "markdown", label: "Markdown Viewer" },
    { id: "html-viewer", label: "HTML Viewer" },
    { id: "css-viewer", label: "CSS / Styling" },
    { id: "js-viewer", label: "JavaScript Viewer" },
    { id: "spreadsheets", label: "Spreadsheets" },
    { id: "shortcuts", label: "Shortcut Registry" },
  ] },
];

export const navigationSections = [
  { id: 'utilities', label: 'Dashboard & Queue', items: [{ id: 'dashboard', label: 'Dashboard' }, { id: 'queue', label: 'Prompt Queue' }] },
  ...groups,
  { id: 'functions', label: 'Functions', items: [{ id: 'tools', label: 'Functions' }] },
];
export const NAVIGATION_ORDER_KEY = 'local-ai-workstation-tab-order-v1';
const complete = (saved, defaults) => [...new Set([...(Array.isArray(saved) ? saved.filter(id => defaults.includes(id)) : []), ...defaults])];
export function normalizeNavigationOrder(value) {
  return { sections: complete(value?.sections, navigationSections.map(section => section.id)),
    tabs: Object.fromEntries(navigationSections.map(section => [section.id, complete(value?.tabs?.[section.id], section.items.map(item => item.id))])) };
}
export function loadNavigationOrder(storage = globalThis.localStorage) {
  try { return normalizeNavigationOrder(JSON.parse(storage?.getItem(NAVIGATION_ORDER_KEY) || 'null')); }
  catch { return normalizeNavigationOrder(); }
}
export function saveNavigationOrder(value, storage = globalThis.localStorage) {
  const order = normalizeNavigationOrder(value);
  if (!storage) throw new Error('Tab order could not be saved. Browser storage is unavailable.');
  storage.setItem(NAVIGATION_ORDER_KEY, JSON.stringify(order));
  return order;
}
export function orderedSections(value) {
  const order = normalizeNavigationOrder(value);
  return order.sections.map(id => { const section = navigationSections.find(item => item.id === id);
    return { ...section, items: order.tabs[id].map(tab => section.items.find(item => item.id === tab)) }; });
}
export function reorderIds(ids, from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return ids;
  const result = [...ids]; const [item] = result.splice(from, 1); result.splice(to, 0, item); return result;
}
