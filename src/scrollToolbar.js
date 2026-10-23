const panes = new WeakMap();

export function observeScrollToolbar(toolbar) {
  if (typeof getComputedStyle !== 'function') return () => {};
  let pane = toolbar.parentElement;
  while (pane?.parentElement && !/(auto|scroll)/.test(getComputedStyle(pane).overflowY)) pane = pane.parentElement;
  if (!pane) return () => {};
  let state = panes.get(pane);
  if (!state) {
    const controls = new Set();
    const originalPadding = pane.style.scrollPaddingTop;
    const update = () => {
      if (!pane.clientHeight) return;
      const visible = [...controls].filter(node => node.getClientRects().length)
        .sort((a, b) => a.compareDocumentPosition(b) & 4 ? -1 : 1);
      const gaps = Math.max(0, visible.length - 1) * 6;
      const budget = Math.min(pane.clientHeight * .5, Math.max(pane.clientHeight * .4, visible.length * 42 + gaps));
      const limit = Math.max(0, (budget - gaps) / Math.max(1, visible.length));
      let top = 0;
      for (const node of visible) {
        node.style.setProperty('--toolbar-limit', `${Math.floor(limit)}px`);
        node.style.setProperty('--toolbar-top', `${top}px`);
        top += node.getBoundingClientRect().height + 6;
      }
      pane.style.scrollPaddingTop = visible.length ? `${top}px` : originalPadding;
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(pane);
    state = {controls, observer, update, originalPadding};
    panes.set(pane, state);
  }
  state.controls.add(toolbar);
  state.observer?.observe(toolbar);
  state.update();
  return () => {
    state.observer?.unobserve(toolbar);
    state.controls.delete(toolbar);
    if (state.controls.size) state.update();
    else {
      state.observer?.disconnect();
      pane.style.scrollPaddingTop = state.originalPadding;
      panes.delete(pane);
    }
  };
}
