// Keep the bundled standalone Media Manager's selection.js behavior in sync.
export function selectionModifiers(event = {}) {
  const source = event.nativeEvent || event;
  return { shift: !!source.shiftKey, additive: !!(source.ctrlKey || source.metaKey) };
}

export function hasSelectionModifier(event) {
  const {shift, additive} = selectionModifiers(event);
  return shift || additive;
}

export function selectFileRange(selected, anchor, ordered, id, modifiers = {}, limit = Infinity) {
  const ids = new Set(selected), target = ordered.indexOf(id), start = ordered.indexOf(anchor);
  if (target < 0) return {ids, anchor};
  if (modifiers.shift) {
    const from = start < 0 ? target : start;
    const range = ordered.slice(Math.min(from, target), Math.max(from, target) + 1);
    const next = new Set(modifiers.additive ? ids : []);
    for (const value of range) if (next.size < limit) next.add(value);
    return {ids: next, anchor: start < 0 ? id : anchor};
  }
  // Ordinary selection controls retain their existing toggle behavior.
  if (ids.has(id)) ids.delete(id);
  else if (ids.size < limit) ids.add(id);
  return {ids, anchor: id};
}

export function preventSelectionText(event) {
  if (event.shiftKey && !event.target?.closest?.('input,textarea,select')) {
    event.preventDefault();
    event.currentTarget?.focus?.({preventScroll:true});
  }
}
