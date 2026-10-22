export function consumePairingLink(location = window.location, history = window.history) {
  const fragment = location.hash || '';
  if (!fragment) return '';
  // Fragments stay out of HTTP logs. Remove them from this history entry before
  // rendering, registering a worker, opening another page or pairing the phone.
  history.replaceState(null, '', location.pathname + location.search);
  return /^#pair=[A-Za-z0-9_-]{32}$/.test(fragment) ? fragment.slice(6) : '';
}

export function androidPairingLink(origin, code) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(code)) return '';
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return '';
  // Explicit package prevents handing the invitation to an unrelated scheme handler.
  return `intent://pair/${encodeURIComponent(url.origin)}/${code}#Intent;scheme=lawcompanion;package=com.localai.workstation.companion;end`;
}
