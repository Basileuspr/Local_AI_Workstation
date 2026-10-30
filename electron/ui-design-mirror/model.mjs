export const fields = [
    { key: 'font-family', label: 'Font family', options: ['"Segoe UI", sans-serif', 'Arial, sans-serif', 'Verdana, sans-serif', 'Georgia, serif', '"Trebuchet MS", sans-serif', 'Consolas, monospace', 'system-ui, sans-serif'] },
    { key: 'font-size', label: 'Font size (px)', unit: 'px', min: 6, max: 160 },
    { key: 'font-weight', label: 'Font weight', options: ['300', '400', '500', '600', '700', '800', '900'] },
    { key: 'font-style', label: 'Font style', options: ['normal', 'italic', 'oblique'] },
    { key: 'color', label: 'Text color', color: true },
    { key: 'background-color', label: 'Background color', color: true },
    { key: 'background-image', label: 'Background image / gradient', options: ['none'] },
    { key: 'border-color', label: 'Border color', color: true },
    { key: 'border-width', label: 'Border width (px)', unit: 'px', min: 0, max: 30 },
    { key: 'border-style', label: 'Border style', options: ['none', 'solid', 'dashed', 'dotted', 'double'] },
    { key: 'border-radius', label: 'Corner radius (px)', unit: 'px', min: 0, max: 160 },
    { key: 'padding', label: 'Padding (px, all sides)', unit: 'px', min: 0, max: 160 },
    { key: 'gap', label: 'Space between children (px)', unit: 'px', min: 0, max: 100 },
    { key: 'letter-spacing', label: 'Letter spacing (px)', unit: 'px', min: -5, max: 30 },
    { key: 'line-height', label: 'Line height (px)', unit: 'px', min: 6, max: 200 },
    { key: 'text-align', label: 'Text alignment', options: ['left', 'center', 'right', 'justify'] },
    { key: 'width', label: 'Width (px)', unit: 'px', min: 1, max: 3000 },
    { key: 'height', label: 'Height (px)', unit: 'px', min: 1, max: 3000 },
];
export const fieldLabel = key => fields.find(field => field.key === key)?.label || ({ text: 'Display text', placeholder: 'Placeholder text', note: 'UX request' }[key] || key);
export function withChange(requests, captureId, node, key, value) {
    const next = structuredClone(requests), edits = { ...next[captureId]?.[node.id] };
    const original = node[key] ?? node.styles[key];
    if (value === null || value === original || (key === 'note' && !value.trim())) delete edits[key];
    else edits[key] = value;
    next[captureId] = { ...next[captureId], [node.id]: edits };
    if (!Object.keys(edits).length) delete next[captureId][node.id];
    if (!Object.keys(next[captureId]).length) delete next[captureId];
    return next;
}
export function editCount(requests) {
    return Object.values(requests).reduce((sum, nodes) => sum + Object.values(nodes).reduce((n, changes) => n + Object.keys(changes).length, 0), 0);
}
export function snapshotDocument(snapshot) {
    const safeCSS = snapshot.css.replace(/<\/style/gi, '<\\/style');
    return `<!doctype html><html ${snapshot.htmlAttributes}><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><style>${safeCSS}</style><style>
      *,*::before,*::after { animation:none!important; transition:none!important; caret-color:transparent!important; }
      [data-mirror-id] { cursor:crosshair!important; }
      [data-mirror-selected] { outline:2px solid #f6ba43!important; outline-offset:2px!important; }
      [hidden] { display:none!important; }
      .mirror-menubar { display:flex; position:relative; z-index:2147483000; gap:2px; height:34px; box-sizing:border-box; background:#1c2330; color:#e8edf6; padding:1px 6px; }
      .mirror-menubar button { font:400 13px/20px "Segoe UI",sans-serif; padding:6px 12px; color:#e8edf6; background:transparent; border:0; border-radius:4px; text-align:left; }
      .mirror-menu-item { position:relative; }
      .mirror-menu-popup { position:absolute; top:100%; left:0; min-width:220px; padding:4px; background:#1c2330; border:1px solid #566277; box-shadow:0 8px 24px #0006; }
      .mirror-menu-popup button { display:block; width:100%; white-space:nowrap; }
      .mirror-menu-popup .mirror-menu-popup { left:100%; top:0; }
      .mirror-menubar ~ #app { height:calc(100vh - 34px)!important; }
    </style></head><body ${snapshot.bodyAttributes}>${snapshot.menuHtml || ''}${snapshot.html}</body></html>`;
}
