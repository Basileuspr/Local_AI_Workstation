const browserSurfaces = new WeakMap();

// Browser, Reels and Web use one native page. Only an active owner may place
// it; mounting/unmounting an inactive account panel must never hide it.
export function claimBrowserSurface(desktop, onChange, priority = 0) {
  let group = browserSurfaces.get(desktop);
  if (!group) { group = { claims: [], owner: null }; browserSurfaces.set(desktop, group); }
  const claim = { onChange, priority };
  function choose() {
    const next = group.claims.reduce((best, item) => !best || item.priority > best.priority ? item : best, null);
    if (next === group.owner) return;
    const previous = group.owner;
    group.owner = next;
    if (previous) {
      previous.onChange(false);
      Promise.resolve(desktop.placeViewerBrowser({ visible: false })).catch(() => {});
    }
    next?.onChange(true);
  }
  group.claims.push(claim); choose();
  if (group.owner !== claim) onChange(false);
  return {
    owns: () => group.owner === claim,
    release() {
      const index = group.claims.indexOf(claim);
      if (index < 0) return;
      group.claims.splice(index, 1); choose();
      if (!group.claims.length) browserSurfaces.delete(desktop);
    },
  };
}

// Native views draw above HTML, so constrain them to the visible part of their
// own pane, including scrolling/stacked layouts and the window viewport.
export function visibleSurfaceBounds(element) {
  if (!element?.getClientRects().length) return null;
  const rect = element.getBoundingClientRect();
  let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
  let right = Math.min(window.innerWidth, rect.right), bottom = Math.min(window.innerHeight, rect.bottom);
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = window.getComputedStyle(parent), clip = /^(auto|scroll|hidden|clip)$/;
    if (!clip.test(style.overflowX) && !clip.test(style.overflowY)) continue;
    const bounds = parent.getBoundingClientRect();
    if (clip.test(style.overflowX)) {
      left = Math.max(left, bounds.left + parent.clientLeft);
      right = Math.min(right, bounds.left + parent.clientLeft + parent.clientWidth);
    }
    if (clip.test(style.overflowY)) {
      top = Math.max(top, bounds.top + parent.clientTop);
      bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight);
    }
  }
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

export function createBrowserPlacementScheduler({window,measure,send}) {
  let frame=null,disposed=false,last='';
  function deliver(value) {
    const key=JSON.stringify(value);
    if(key===last)return;
    last=key;Promise.resolve().then(()=>send(value)).catch(()=>{last='';});
  }
  function schedule() {
    if(disposed || frame!==null)return;
    frame=window.requestAnimationFrame(()=>{frame=null;if(!disposed)deliver(measure());});
  }
  function hide() {
    if(frame!==null)window.cancelAnimationFrame(frame);
    frame=null;deliver({visible:false});
  }
  return {schedule,hide,dispose(){disposed=true;if(frame!==null)window.cancelAnimationFrame(frame);frame=null;}};
}
