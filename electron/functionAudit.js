const fs = require('node:fs/promises');
const path = require('node:path');

async function auditFolder(root, { depth = 3, signal, limit = 20000, timeout = 30000 } = {}) {
  if (!Number.isInteger(depth) || depth < 0 || depth > 8) throw Error('Invalid audit depth.');
  const started = Date.now(), stack = [{ dir: root, level: 0 }];
  let files = 0, directories = 0, bytes = 0, examined = 0, partial = false;
  const skipped = [], largest = [], extensions = {}, markers = [];
  const note = value => { if (skipped.length < 100) skipped.push(value); };
  const stop = () => { if (signal?.aborted) throw Error('Function stopped.'); };
  if ((await fs.lstat(root)).isSymbolicLink()) throw Error('Choose a real folder, not a directory link.');
  while (stack.length && !partial) {
    stop();
    const { dir, level } = stack.pop();
    let iterator;
    try { iterator = await fs.opendir(dir); } catch { note(`${path.relative(root, dir) || '.'}: inaccessible`); continue; }
    for await (const entry of iterator) {
      stop();
      if (++examined > limit || Date.now() - started > timeout) { partial = true; break; }
      const relative = path.relative(root, path.join(dir, entry.name));
      if (/nvidia/i.test(entry.name)) { note(`${relative}: excluded NVIDIA data`); continue; }
      if (entry.isSymbolicLink()) { note(`${relative}: directory/file link`); continue; }
      if (entry.isDirectory()) {
        directories++;
        if (level < depth) stack.push({ dir: path.join(dir, entry.name), level: level + 1 });
        else note(`${relative}: depth limit`);
      } else if (entry.isFile()) {
        try {
          const info = await fs.lstat(path.join(dir, entry.name));
          if (!info.isFile() || info.isSymbolicLink()) { note(`${relative}: changed during scan`); continue; }
          files++; bytes += info.size;
          const extension = path.extname(entry.name).toLowerCase() || '(no extension)';
          extensions[extension] = (extensions[extension] || 0) + 1;
          largest.push({ path: relative, bytes: info.size });
          largest.sort((a, b) => b.bytes - a.bytes); largest.length = Math.min(largest.length, 20);
          if (markers.length < 100 && /^(package\.json|pyproject\.toml|requirements[^\/]*\.txt|Cargo\.toml|go\.mod|Dockerfile|\.git|.*\.sln)$/i.test(entry.name)) markers.push(relative);
        } catch { note(`${relative}: unreadable`); }
      }
    }
  }
  stop();
  const report = { root, scanned_at: new Date().toISOString(), depth, files, directories, bytes, partial,
    scope: 'Metadata inventory only. No file contents, installs, application execution, or deletion. Totals cover visited entries only; depth limits, links, exclusions and inaccessible paths reduce coverage.',
    extensions, environment_markers: markers, largest, skipped };
  const text = `# Folder environment audit\n\nFolder: ${root}\nScanned: ${report.scanned_at}\nDepth: ${depth}\nFiles: ${files}\nFolders: ${directories}\nBytes in visited files: ${bytes}\nBounded scan limit reached: ${partial ? 'yes' : 'no'}\n\n${report.scope}\n\n## Environment markers\n${markers.map(item => `- ${item}`).join('\n') || 'None found within this scope.'}\n\n## Largest visited files\n${largest.map(item => `- ${item.path}: ${item.bytes} bytes`).join('\n')}\n\n## File extensions\n${Object.entries(extensions).map(([ext, count]) => `- ${ext}: ${count}`).join('\n')}\n\n## Skipped paths (up to 100)\n${skipped.map(item => `- ${item}`).join('\n') || 'None.'}\n`;
  return { text, report };
}
module.exports = { auditFolder };
