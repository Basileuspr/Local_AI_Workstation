export const NODE_DEFAULTS = Object.freeze({
  label: "", color: "#6d9cbc", shape: "circle", size: 24, size_mode: "chunks",
  icon: "document", border: "solid", label_mode: "short", font_size: 13,
  tags: [], note: "", locked: false,
});
export const NODE_ICONS = { none: "", document: "▤", star: "★", person: "♟", idea: "✦", book: "▥", flag: "⚑", check: "✓" };
export const NODE_PRESETS = [
  { name: "Document", color: "#6d9cbc", shape: "circle", icon: "document" },
  { name: "Person", color: "#b89bea", shape: "circle", icon: "person" },
  { name: "Idea", color: "#edc66b", shape: "diamond", icon: "idea" },
  { name: "Reference", color: "#77c6ab", shape: "square", icon: "book" },
  { name: "Priority", color: "#ed9393", shape: "hexagon", icon: "star" },
  { name: "Complete", color: "#8ac77c", shape: "circle", icon: "check" },
];
export function nodeOptions(node) { return { ...NODE_DEFAULTS, ...node.options }; }
export function nodeAppearancePreset(preset) {
  const { name, icon, ...appearance } = preset;
  return appearance;
}
export function nodeLabel(node) { return node.options?.label?.trim() || node.filename; }
export function nodeMatches(node, query) {
  return [node.filename, nodeLabel(node), ...(node.options?.tags || []), node.options?.note || ""].join(" ").toLowerCase().includes(query.toLowerCase().trim());
}
export function nodeRadius(node) {
  const options = nodeOptions(node);
  return options.size_mode === "fixed" ? options.size : (12 + Math.min(12, Math.sqrt(node.chunks || 1))) * options.size / 24;
}
export function nodePolygon(shape, radius) {
  const count = shape === "diamond" ? 4 : 6;
  return Array.from({ length: count }, (_, index) => {
    const angle = index * Math.PI * 2 / count - Math.PI / 2;
    return `${Math.cos(angle) * radius},${Math.sin(angle) * radius}`;
  }).join(" ");
}
