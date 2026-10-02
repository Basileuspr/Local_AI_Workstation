export const taskPattern = /^\[([ xX])\](?:[ \t]+(.*)|$)/;

// Shared by block detection and code-block reading. A longer closing fence is OK.
export function codeFence(line) {
  const match = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
  return match && { marker: match[1][0], length: match[1].length, info: match[2].trim() };
}

export function closesFence(line, opening) {
  const fence = codeFence(line);
  return fence && fence.marker === opening.marker && fence.length >= opening.length && !fence.info;
}

export function checklistItems(content) {
  let opening = null;
  const result = [];
  String(content || "").replace(/\r\n?/g, "\n").split("\n").forEach((line, index) => {
    if (opening) { if (closesFence(line, opening)) opening = null; return; }
    const fence = codeFence(line);
    if (fence) { opening = fence; return; }
    const list = line.match(/^(\s*)([-+*]|\d+[.)])\s+(.*)$/);
    const task = list && list[3].match(taskPattern);
    if (task) result.push({ line_index: index, text: task[2] || "", checked: task[1].toLowerCase() === "x" });
  });
  return result;
}
