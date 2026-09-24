const names = new Intl.Collator("en", { sensitivity: "base", numeric: true, ignorePunctuation: true });

function nameKey(name) {
  const label = String(name ?? "").trim();
  // Sort decorated labels by their words; keep emoji-only names usable too.
  return label.replace(/^[^\p{L}\p{N}]+/u, "") || label;
}

// Shared by user-created controls in every tab. Never reorder caller-owned data.
export function sortNamedItems(items) {
  return [...items].sort((a, b) => names.compare(nameKey(a.name), nameKey(b.name)));
}
