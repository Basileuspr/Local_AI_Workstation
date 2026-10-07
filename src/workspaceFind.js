const MAX_MATCHES = 1000, MAX_TEXT = 500000;
export function findTextMatches(text, query, matchCase = false, limit = MAX_MATCHES) {
  const trimmed = query.trim();
  if (!trimmed) return { matches: [], limited: false };
  const pattern = trimmed.split(/\s+/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  const expression = new RegExp(pattern, matchCase ? 'gu' : 'giu');
  const matches = []; let match;
  while ((match = expression.exec(text))) {
    if (matches.length >= limit) return { matches, limited: true };
    matches.push({ start: match.index, end: match.index + match[0].length });
  }
  return { matches, limited: false };
}

export function createWorkspaceTextFind(doc = document) {
  const view = doc.defaultView;
  let matches = [], current = -1, marked = null, limited = false, lastQuery = null;
  const visible = element => element && !element.closest('[hidden],[inert],.workspace-find')
    && element.getClientRects().length > 0 && view.getComputedStyle(element).visibility !== 'hidden';
  function clear() {
    view.CSS?.highlights?.delete('workspace-find-all');
    view.CSS?.highlights?.delete('workspace-find-current');
    marked?.removeAttribute('data-workspace-find-current'); marked = null;
    matches = []; current = -1; limited = false; lastQuery = null;
  }
  function paint() {
    marked?.removeAttribute('data-workspace-find-current'); marked = null;
    const selected = matches[current];
    if (view.CSS?.highlights && view.Highlight) {
      view.CSS.highlights.set('workspace-find-all', new view.Highlight(...matches.filter(match => match.range).map(match => match.range)));
      view.CSS.highlights.set('workspace-find-current', new view.Highlight(...(selected?.range ? [selected.range] : [])));
    }
    if (selected && (!selected.range || !view.CSS?.highlights)) {
      marked = selected.element; marked.setAttribute('data-workspace-find-current', '');
    }
  }
  function results() { return { matches: matches.length, current: current + 1, limited }; }
  function reveal() {
    const selected = matches[current]; if (!selected) return;
    // Move only scroll containers, preserving the document viewport and focus.
    for (let node = selected.element.parentElement; node; node = node.parentElement) {
      const bounds = node.getBoundingClientRect(), style = view.getComputedStyle(node);
      const rect = selected.range?.getBoundingClientRect() || selected.element.getBoundingClientRect();
      if (['auto', 'scroll'].includes(style.overflowY) && node.scrollHeight > node.clientHeight
          && (rect.top < bounds.top || rect.bottom > bounds.bottom)) node.scrollTop += rect.top - bounds.top - (node.clientHeight - rect.height) / 2;
      if (['auto', 'scroll'].includes(style.overflowX) && node.scrollWidth > node.clientWidth
          && (rect.left < bounds.left || rect.right > bounds.right)) node.scrollLeft += rect.left - bounds.left - (node.clientWidth - rect.width) / 2;
    }
  }
  function move(direction = 1) {
    if (matches.length) current = (current + direction + matches.length) % matches.length;
    paint(); reveal(); return results();
  }
  function search(roots, query, matchCase = false) {
    const signature = `${matchCase}:${query}`, previous = lastQuery === signature ? matches[current] : null;
    const previousOffset = previous?.range?.startOffset ?? previous?.start;
    clear(); if (!query.trim()) return results();
    lastQuery = signature;
    let budget = MAX_TEXT;
    for (const root of roots) {
      if (!visible(root) || budget <= 0) continue;
      const segments = []; let text = '', block = null;
      const walker = doc.createTreeWalker(root, 4); let node;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (!visible(parent) || parent.closest('script,style,noscript,textarea,select,option,input')) continue;
        const collapsed = parent.closest('details:not([open])');
        if (collapsed && !collapsed.querySelector('summary')?.contains(parent)) continue;
        const nextBlock = parent.closest('p,div,section,article,li,pre,h1,h2,h3,h4,h5,h6,button,label,summary,td,th');
        if (block !== nextBlock && text) text += '\n'; block = nextBlock;
        const value = node.data.slice(0, budget); budget -= value.length;
        segments.push({ node, start: text.length, end: text.length + value.length }); text += value;
        if (!budget) { limited = true; break; }
      }
      const found = findTextMatches(text, query, matchCase, MAX_MATCHES - matches.length); limited ||= found.limited;
      const segmentAt = (offset, inclusive) => {
        let low = 0, high = segments.length;
        while (low < high) { const middle = (low + high) >>> 1; if (inclusive ? segments[middle].end >= offset : segments[middle].end > offset) high = middle; else low = middle + 1; }
        return segments[low];
      };
      for (const match of found.matches) {
        const start = segmentAt(match.start, false), end = segmentAt(match.end, true);
        if (!start || !end) continue;
        const range = doc.createRange(); range.setStart(start.node, match.start - start.start); range.setEnd(end.node, match.end - end.start);
        matches.push({ range, anchor: start.node, element: start.node.parentElement });
      }
      for (const element of root.querySelectorAll('textarea,input:not([type=password]):not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color])')) {
        if (!visible(element)) continue;
        const value = element.value || '', bounded = value.slice(0, Math.max(0, budget));
        budget -= bounded.length; limited ||= bounded.length < value.length;
        const found = findTextMatches(bounded, query, matchCase, MAX_MATCHES - matches.length); limited ||= found.limited;
        matches.push(...found.matches.map(match => ({ ...match, anchor: element, element })));
      }
      if (matches.length >= MAX_MATCHES) break;
    }
    matches.sort((a, b) => a.anchor === b.anchor ? 0 : a.anchor.compareDocumentPosition(b.anchor) & 4 ? -1 : 1);
    const retained = previous ? matches.findIndex(match => match.anchor === previous.anchor && (match.range?.startOffset ?? match.start) === previousOffset) : -1;
    current = retained >= 0 ? retained : matches.length ? 0 : -1; paint(); if (retained < 0) reveal(); return results();
  }
  return { search, move, clear };
}

export function workspaceFindScope(doc, tab) {
  const modal = [...doc.querySelectorAll('dialog[open]')].filter(node => node.getClientRects().length).at(-1);
  return modal || [...doc.querySelectorAll('[data-capture-tab]')].find(node => node.dataset.captureTab === tab && !node.hidden && node.getClientRects().length) || null;
}
