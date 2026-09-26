export function previewDocument(html, css = "") {
  // A sandboxed opaque-origin document with a stricter, non-network CSP.
  // Style closing tags are neutralized. The sandbox and CSP prevent scripts
  // from executing and block network requests.
  const safeCSS = css.replace(/<\/style/gi, "<\\/style");
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; form-action 'none'; base-uri 'none';"><meta charset="utf-8"><style>body{color:#222;background:white;margin:24px;font-family:system-ui} ${safeCSS}</style></head><body>${html}</body></html>`;
}
