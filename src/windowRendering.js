export const WINDOW_LAYOUT_EVENT = 'workstation:window-layout';

// Text-only React/streaming updates do not resize anything. Request a native
// repaint after those updates instead of relying on a later window movement.
export function installWindowRepaint(window, { delay = 100 } = {}) {
  const desktop = window.workstationDesktop, document = window.document;
  if (!desktop?.repaintWindow || !window.MutationObserver || !document?.documentElement) return () => {};
  let timer = null, frame = null, disposed = false, interactive=false;
  const shown = () => !disposed && document.visibilityState !== 'hidden';
  function notify(event) {
    interactive ||= !!event?.type;
    if (!shown() || timer !== null || frame !== null) return;
    timer = window.setTimeout(() => {
      timer = null;
      if (!shown()) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (shown()) desktop.repaintWindow(interactive?'interaction':'content');
        interactive=false;
      });
    }, delay);
  }
  function cancel() {
    if (timer !== null) window.clearTimeout(timer);
    if (frame !== null) window.cancelAnimationFrame(frame);
    timer = frame = null;
    interactive=false;
  }
  const observer = new window.MutationObserver(records => {
    if (records.some(record => {
      const element = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (!element || element.parentElement?.closest('[hidden]')) return false;
      return record.type === 'attributes' || !element.closest('[hidden]');
    })) notify();
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'open', 'disabled', 'checked', 'selected', 'value', 'src',
      'aria-expanded', 'aria-selected', 'aria-checked', 'aria-pressed', 'data-theme'] });
  const events = ['input', 'change', 'keyup', 'pointerup', 'pointerover', 'pointerout', 'focusin', 'focusout', 'toggle', 'transitionend', 'animationend', 'scroll'];
  for (const event of events) document.addEventListener(event, notify, { capture: true, passive: true });
  const visibility = () => { if (shown()) notify(); else cancel(); };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('focus', notify);
  return () => {
    disposed = true; cancel(); observer.disconnect();
    for (const event of events) document.removeEventListener(event, notify, true);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('focus', notify);
  };
}

// Keep native child views aligned after restoring the window, changing monitors,
// DPI or zoom. Coalesce signals; never reload React or replace an open input.
export function installWindowLayout(window) {
  if (!window.workstationDesktop?.onWindowLayout) return () => {};
  let frame = null, disposed = false, density;
  const notify = () => {
    if (disposed || frame !== null || window.document.visibilityState === 'hidden') return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      if (!disposed) window.dispatchEvent(new window.Event(WINDOW_LAYOUT_EVENT));
    });
  };
  const watchDensity = () => {
    density?.removeEventListener('change', changedDensity);
    density = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    density.addEventListener('change', changedDensity);
  };
  function changedDensity() { watchDensity(); notify(); }
  const remove = window.workstationDesktop.onWindowLayout(notify);
  window.document.addEventListener('visibilitychange', notify);
  watchDensity();
  return () => {
    disposed = true; remove?.();
    if (frame !== null) window.cancelAnimationFrame(frame);
    density?.removeEventListener('change', changedDensity);
    window.document.removeEventListener('visibilitychange', notify);
  };
}
