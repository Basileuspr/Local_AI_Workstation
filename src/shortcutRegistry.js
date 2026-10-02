export const SHORTCUT_REGISTRY_KEY = "local-ai-workstation-shortcut-registry-v1";
export const REGISTRY_FOLDERS_KEY = "local-ai-workstation-shortcut-folders-v1";
export const entryTypes = ["Shortcut", "Behavior", "Function"];
export const WORD_SCOPE = "Word for Windows desktop · English / US keyboard";
const keyboardSource = "https://support.microsoft.com/en-us/accessibility/word/keyboard-shortcuts-in-word";
const displaySource = "https://support.microsoft.com/en-au/word/word-options-display";
const reviewSource = "https://support.microsoft.com/en-us/word/accept-or-reject-tracked-changes-in-word";
const wordEntry = (id, category, title, keys, description) => ({
  id: `word-${id}`, application: "Microsoft Word", platform: WORD_SCOPE,
  type: "Shortcut", category, title, keys, description, steps: "", notes: "",
  source: keyboardSource, verified: "2026-10-02", builtIn: true,
});

export const builtInEntries = [
  wordEntry("save", "Files", "Save", "Ctrl + S", "Save the current document."),
  wordEntry("print", "Files", "Print", "Ctrl + P", "Open printing options."),
  wordEntry("undo", "Editing", "Undo", "Ctrl + Z", "Reverse the previous edit."),
  wordEntry("copy", "Editing", "Copy", "Ctrl + C", "Copy selected content."),
  wordEntry("paste", "Editing", "Paste", "Ctrl + V", "Insert clipboard content."),
  wordEntry("find", "Navigation", "Find", "Ctrl + F", "Search document content."),
  wordEntry("replace", "Editing", "Replace", "Ctrl + H", "Find and replace text."),
  wordEntry("bold", "Formatting", "Bold", "Ctrl + B", "Toggle bold text."),
  wordEntry("italic", "Formatting", "Italic", "Ctrl + I", "Toggle italic text."),
  wordEntry("underline", "Formatting", "Underline", "Ctrl + U", "Toggle underlined text."),
  wordEntry("heading", "Formatting", "Heading 1", "Ctrl + Alt + 1", "Apply Heading 1 style."),
  wordEntry("normal", "Formatting", "Normal style", "Ctrl + Shift + N", "Apply Normal style."),
  wordEntry("marks", "Layout", "Formatting marks", "Ctrl + Shift + 8", "Toggle nonprinting marks."),
  wordEntry("page", "Layout", "Page break", "Ctrl + Enter", "Start a new page."),
  wordEntry("line", "Layout", "Line break", "Shift + Enter", "Break the current line."),
  wordEntry("comment", "Review", "Add comment", "Ctrl + Alt + M", "Insert a comment."),
  wordEntry("tracking", "Review", "Track Changes", "Ctrl + Shift + E", "Toggle change tracking."),
  wordEntry("tab", "Tables", "Tab inside a cell", "Ctrl + Tab", "Insert a tab character."),
  {
    id: "word-visible-marks", application: "Microsoft Word", platform: WORD_SCOPE,
    type: "Behavior", category: "Layout", title: "Why marks remain visible", keys: "",
    description: "Some marks can stay visible after Show/Hide is turned off.",
    steps: "File > Options > Display > Always show these formatting marks on the screen.",
    notes: "Individual checked options remain active when Show/Hide is off. Spaces appear as dots; tabs as arrows; paragraph endings as ¶.",
    source: displaySource, verified: "2026-10-02", builtIn: true,
  },
  {
    id: "word-hide-revisions", application: "Microsoft Word", platform: WORD_SCOPE,
    type: "Behavior", category: "Review", title: "No Markup keeps revisions", keys: "",
    description: "No Markup hides tracked changes temporarily; it keeps the revisions in the document.",
    steps: "Review > tracking display > No Markup.",
    notes: "Accept or reject tracked changes to resolve them before sharing a final copy.",
    source: reviewSource, verified: "2026-10-02", builtIn: true,
  },
  {
    id: "word-resolve-revisions", application: "Microsoft Word", platform: WORD_SCOPE,
    type: "Function", category: "Review", title: "Accept or reject revisions", keys: "",
    description: "Review each proposed change and decide whether to keep it.",
    steps: "Review > Accept or Reject. Use Next or Previous to inspect changes without resolving them.",
    notes: "The drop-down menus also offer Accept All Changes and Reject All Changes.",
    source: reviewSource, verified: "2026-10-02", builtIn: true,
  },
  {
    id: "word-inspect", application: "Microsoft Word", platform: WORD_SCOPE,
    type: "Function", category: "Files", title: "Inspect document", keys: "",
    description: "Check for comments, revisions, hidden text, and personal document properties.",
    steps: "File > Info > Check for Issues > Inspect Document.",
    notes: "Review the inspector results before removing document information.",
    source: reviewSource, verified: "2026-10-02", builtIn: true,
  },
];

export function validatePersonalEntries(entries) {
  if (!Array.isArray(entries) || entries.length > 1000) throw new Error("The registry supports up to 1,000 personal entries.");
  const ids = new Set(builtInEntries.map(entry => entry.id));
  return entries.map(entry => {
    if (!entry || typeof entry.id !== "string" || !entry.id || ids.has(entry.id) || !entryTypes.includes(entry.type))
      throw new Error("Invalid registry entry.");
    ids.add(entry.id);
    const clean = { id: entry.id, type: entry.type, builtIn: false };
    for (const field of ["application", "platform", "category", "title", "keys", "description", "steps", "notes"])
      clean[field] = typeof entry[field] === "string" ? entry[field].trim() : "";
    if (!clean.application || !clean.title || !clean.description) throw new Error("Application, title, and behavior are required.");
    if (clean.type === "Shortcut" && !clean.keys) throw new Error("Enter the keys for a shortcut.");
    if (Object.values(clean).some(value => typeof value === "string" && value.length > 8000)) throw new Error("Keep each field under 8,000 characters.");
    clean.category ||= "General";
    return clean;
  });
}

export function loadPersonalEntries() {
  return validatePersonalEntries(JSON.parse(localStorage.getItem(SHORTCUT_REGISTRY_KEY) || "[]"));
}

export function savePersonalEntries(entries) {
  const clean = validatePersonalEntries(entries);
  localStorage.setItem(SHORTCUT_REGISTRY_KEY, JSON.stringify(clean));
  return clean;
}

function validateFolders(folders) {
  if (!Array.isArray(folders) || folders.length > 200) throw new Error("The registry supports up to 200 application folders.");
  const unique = new Map();
  for (const name of folders) {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 300) throw new Error("Enter a folder name under 300 characters.");
    const trimmed = name.trim();
    if (!unique.has(trimmed.toLowerCase())) unique.set(trimmed.toLowerCase(), trimmed);
  }
  return [...unique.values()];
}

export function loadRegistryFolders() {
  return validateFolders(JSON.parse(localStorage.getItem(REGISTRY_FOLDERS_KEY) || "[]"));
}

export function saveRegistryFolders(folders) {
  const names = validateFolders(folders);
  localStorage.setItem(REGISTRY_FOLDERS_KEY, JSON.stringify(names));
  return names;
}

export function registryFolders(entries, names = [], filters = {}) {
  const folders = new Map();
  for (const application of [...entries.map(entry => entry.application), ...names]) {
    const key = application.toLowerCase();
    if (!folders.has(key)) folders.set(key, { application, entries: [], total: 0 });
  }
  for (const entry of entries) folders.get(entry.application.toLowerCase()).total++;
  for (const entry of filterRegistry(entries, filters)) folders.get(entry.application.toLowerCase()).entries.push(entry);
  const narrowed = !!(filters.query?.trim() || filters.category || filters.type);
  return [...folders.values()].filter(folder => (!filters.application || folder.application.toLowerCase() === filters.application.toLowerCase()) && (!narrowed || folder.entries.length))
    .sort((a, b) => a.application.localeCompare(b.application));
}

export function filterRegistry(entries, { query = "", application = "", category = "", type = "" } = {}) {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return entries.filter(entry => {
    if (application && entry.application.toLowerCase() !== application.toLowerCase() || category && entry.category !== category || type && entry.type !== type) return false;
    const haystack = [entry.application, entry.platform, entry.category, entry.type, entry.title, entry.keys, entry.description, entry.steps, entry.notes]
      .join(" ").toLowerCase().replace(/\s*\+\s*/g, "+");
    return tokens.every(token => haystack.includes(token.replace(/\s*\+\s*/g, "+")));
  });
}

const mdText = value => String(value || "").replace(/[\\`*_{}\[\]<>#|]/g, "\\$&");
export function registryMarkdown(entries) {
  const lines = ["# Shortcut Registry", "", "Reference for shortcuts, behaviors, and functions. Use each entry in its named application and platform.", "", "Word starter entries: Windows desktop, English / US keyboard. Mac, web, localized, or customized shortcuts may differ.", ""];
  for (const entry of entries) {
    lines.push(`## ${mdText(entry.title)}`, "", `**${mdText(entry.application)}** · ${mdText(entry.platform || "Platform unspecified")} · ${mdText(entry.category)} · ${entry.type}`, "");
    if (entry.keys) lines.push(`**Keys:** ${mdText(entry.keys)}`, "");
    lines.push(mdText(entry.description), "");
    if (entry.steps) lines.push(`**Menu / steps:** ${mdText(entry.steps)}`, "");
    if (entry.notes) lines.push(`**Notes:** ${mdText(entry.notes)}`, "");
    if (entry.builtIn) lines.push(`[Microsoft Support](${entry.source}) · Checked ${entry.verified}`, "");
    else lines.push("Personal entry", "");
  }
  return lines.join("\n");
}
