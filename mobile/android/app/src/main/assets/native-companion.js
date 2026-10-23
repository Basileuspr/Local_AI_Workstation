/* Adapter for the desktop-hosted Gallery viewer.
 * Android accepts only main-frame messages from the selected HTTPS origin and
 * revalidates paths. No credentials or image bytes pass through this bridge. */
(() => {
  if (window.__lawNativeReady || !window.LawAndroid?.postMessage) return;
  window.__lawNativeReady = true;
  const originals = /^\/api\/media\/(?:library\/[A-Za-z0-9_-]{1,100}|session\/[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9_-]{1,100})\?download=true$/;
  document.addEventListener('click', event => {
    if (!event.isTrusted) return;
    const target = event.target.closest('a[download],button');
    const viewer = target?.closest('dialog.viewer[open]');
    if (!viewer) return;
    const original = viewer.querySelector('a[download]');
    if (!original) return;
    const url = new URL(original.href, location.href);
    const path = url.pathname + url.search;
    if (url.origin !== location.origin || !originals.test(path)) return;
    const save = target === original;
    const share = target.tagName === 'BUTTON' && /^(Prepare to share|Share image)$/.test(target.textContent.trim());
    if (!save && !share) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.LawAndroid.postMessage(JSON.stringify({ action: save ? 'save' : 'share', path }));
  }, true);
})();
