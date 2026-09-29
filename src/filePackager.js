export const MAX_PACKAGE_ENTRIES = 1000;
export const MAX_PACKAGE_BYTES = 512 * 1024 ** 2;

export function packageFilename(value) {
  let name = value.trim().replace(/[\\/<>:"|?*\x00-\x1f]/g, "_").slice(0, 120).replace(/[ .]+$/g, "").replace(/\.zip$/i, "").replace(/[ .]+$/g, "") || "Package";
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  return `${name}.zip`;
}

export function packageBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

function safePath(path) {
  const parts = path.replace(/\\/g, "/").split("/");
  if (parts.some(part => !part || part === "." || part === "..")) throw new Error("Choose files with relative folder paths.");
  const clean = parts.map(part => {
    let name = part.replace(/[<>:"|?*\x00-\x1f]/g, "_").replace(/[ .]+$/g, "_");
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
    return name;
  }).join("/");
  if (new TextEncoder().encode(clean).length > 1024) throw new Error("A folder path is too long to package.");
  return clean;
}

// Keep repeated drops; rename collisions instead of silently discarding bytes.
export function addPackageEntries(current, incoming) {
  const result = [...current];
  const normalized = incoming.map(entry => ({ ...entry, path: safePath(entry.path) }));
  const reserved = new Set([...current, ...normalized].map(entry => entry.path.toLowerCase()));
  const occupied = new Map();
  function reserve(entry) {
    const parts = entry.path.toLowerCase().split("/");
    for (let index = 1; index < parts.length; index++) occupied.set(parts.slice(0, index).join("/"), true);
    occupied.set(entry.path.toLowerCase(), entry.directory);
  }
  current.forEach(reserve);
  // Reserve implicit folders before files, regardless of input ordering.
  for (const entry of normalized) {
    const parts = entry.path.toLowerCase().split("/");
    for (let index = 1; index <= parts.length - (entry.directory ? 0 : 1); index++) {
      const parent = parts.slice(0, index).join("/");
      if (occupied.get(parent) === false) throw new Error(`A file already uses the folder name ${parent}. Remove it before adding this folder.`);
      occupied.set(parent, true); reserved.add(parent);
    }
  }
  for (const entry of normalized) {
    if (entry.directory && occupied.get(entry.path.toLowerCase()) === false) throw new Error(`A file already uses the folder name ${entry.path}.`);
    if (entry.directory && result.some(item => item.directory && item.path.toLowerCase() === entry.path.toLowerCase())) continue;
    let path = entry.path;
    if (!entry.directory && occupied.has(path.toLowerCase())) {
      const slash = path.lastIndexOf("/"), dot = path.lastIndexOf(".");
      const extension = dot > slash + 1 ? path.slice(dot) : "";
      const stem = extension ? path.slice(0, -extension.length) : path;
      let index = 2;
      do { path = `${stem} (${index++})${extension}`; } while (reserved.has(path.toLowerCase()) || occupied.has(path.toLowerCase()));
    }
    const added = { ...entry, path, id: crypto.randomUUID() };
    result.push(added); reserve(added); reserved.add(path.toLowerCase());
  }
  if (result.length > MAX_PACKAGE_ENTRIES) throw new Error("Choose up to 1,000 files and folders per package.");
  if (result.reduce((sum, entry) => sum + entry.file.size, 0) > MAX_PACKAGE_BYTES) throw new Error("Choose up to 512 MiB of files per package.");
  return result;
}

export function selectedPackageFiles(files) {
  return Array.from(files, file => ({ file, path: file.webkitRelativePath || file.name, directory: false }));
}

export function removePackageEntry(entries, selected) {
  const prefix = selected.path.toLowerCase() + "/";
  return entries.filter(entry => entry.id !== selected.id && !(selected.directory && entry.path.toLowerCase().startsWith(prefix)));
}

export async function droppedPackageFiles(transfer) {
  // Capture event-owned entries synchronously, before the first await.
  const roots = Array.from(transfer.items || []).filter(item => item.kind === "file").map(item => item.webkitGetAsEntry?.());
  const fallback = selectedPackageFiles(transfer.files);
  if (!roots.length || roots.some(entry => !entry)) return fallback;
  const entries = [];
  let total = 0;
  async function visit(entry, prefix = "", depth = 0) {
    if (depth > 32 || entries.length >= MAX_PACKAGE_ENTRIES) throw new Error("Choose up to 1,000 files and folders, with at most 32 folder levels.");
    const path = prefix + entry.name;
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      total += file.size;
      if (total > MAX_PACKAGE_BYTES) throw new Error("Choose up to 512 MiB of files per package.");
      entries.push({ file, path, directory: false });
    } else if (entry.isDirectory) {
      entries.push({ file: new File([], entry.name), path, directory: true });
      const reader = entry.createReader();
      let children;
      do {
        children = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        for (const child of children) await visit(child, `${path}/`, depth + 1);
      } while (children.length);
    } else throw new Error(`Could not read ${path}.`);
  }
  for (const root of roots) await visit(root);
  return entries;
}
