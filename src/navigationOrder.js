import { designTools } from './designWorkspace';

const groups = [
  { id: "workspace", label: "Workspace", icon: "chat", items: [
    { id: "chats", label: "Chats" },
    { id: "library", label: "Index" },
    { id: "knowledge", label: "Knowledge" },
    { id: "memory", label: "Memory", title: "Durable Memory · saved facts, preferences, categories and priorities" },
    { id: "canvas", label: "Canvas" },
    { id: "converter", label: "File Converter" },
    { id: "local-files", label: "Local Files" },
    { id: "document-editor", label: "Document Editor" },
    { id: "packager", label: "Packager" },
    { id: "hash-auditor", label: "Hash Auditor" },
    { id: "folder-review", label: "Folder Review" },
    { id: "audio", label: "Audio" },
    { id: "sound-mixer", label: "Sound Mixer", title: "Sound Mixer · soundboard, audio channels, EQ and recording" },
    { id: "slicer", label: "3D Slicer" },
    { id: "integrations", label: "Linked applications" },
    { id: "phone", label: "Phone", title: "Phone · KDE Connect, scrcpy and Workstation Companion" },
  ] },
  { id: "web", label: "Web", icon: "globe", items: [
    { id: "browser", label: "Browser", title: "Browser · pages, account profiles, tabs and bookmarks" },
    { id: "web-system", label: "Research & Sources", title: "Web Research & Sources · search, preview, page import, live research and recurring sources" },
    { id: "reels-analyzer", label: "Reels Analyzer", title: "Reels Analyzer · account conversations and local reel summaries" },
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
    { id: "3d-viewer", label: "3D Viewer & Editor" },
    { id: "spreadsheets", label: "Spreadsheets" },
    { id: "shortcuts", label: "Shortcut Registry" },
  ] },
];

export const navigationSections = [
  { id: 'utilities', label: 'Utilities', items: [{ id: 'dashboard', label: 'Dashboard' }, { id: 'coordinator', label: 'Coordinator', title: 'Coordinator · Coding, Research & Knowledge, Media Librarian harnesses' }, { id: 'queue', label: 'Prompt Queue' }, { id: 'tools', label: 'Functions' }, { id: 'info-center', label: 'Info Center', title: 'Info Center · feature use cases, examples and help' }, { id: 'design-programming', label: 'Design & Programming', title: 'Design & Programming · UI customization playground, templates and code' }] },
  ...groups,
  // Children live in the main workspace. Keep them indexed for search and ordering.
  { id: 'design-code', label: 'Design & Programming', items: designTools },
];
navigationSections[0].items.push({ id: 'testing-lab', label: 'Testing Lab', title: 'Testing Lab · model comparisons, request accuracy, factual accuracy and results over time' });
navigationSections[0].items.push({ id: 'reverse-engineer', label: 'Reverse Engineer', title: 'Reverse Engineer · Ghidra, dnSpyEx, JADX, x64dbg and Frida' });
export const NAVIGATION_ORDER_KEY = 'local-ai-workstation-tab-order-v1';
const complete = (saved, defaults) => [...new Set([...(Array.isArray(saved) ? saved.filter(id => defaults.includes(id)) : []), ...defaults])];
export function normalizeNavigationOrder(value) {
  const sections = complete(value?.sections, groups.map(section => section.id));
  // Introduce Web beside Workspace in older arrangements while retaining the
  // relative order of every existing group. Future explicit Web moves persist.
  if (Array.isArray(value?.sections) && !value.sections.includes('web')) {
    sections.splice(sections.indexOf('web'), 1);
    sections.splice(sections.indexOf('workspace') + 1, 0, 'web');
  }
  return { sections: ['utilities', ...sections, 'design-code'],
    tabs: Object.fromEntries(navigationSections.map(section => [section.id, complete(value?.tabs?.[section.id] ?? (section.id === 'design-code' ? value?.tabs?.viewers : undefined), section.items.map(item => item.id))])) };
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
export function filterNavigationSections(sections, query) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return sections.map(section => ({ ...section, items: section.items.filter(item => {
    const text = `${section.label} ${item.label} ${item.title || ''} ${item.id.replaceAll('-', ' ')}`.toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  }) })).filter(section => section.items.length);
}
export function reorderIds(ids, from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return ids;
  const result = [...ids]; const [item] = result.splice(from, 1); result.splice(to, 0, item); return result;
}
