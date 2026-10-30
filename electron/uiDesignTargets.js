const { parseHTML } = require('linkedom');

const STYLE_KEYS = new Set(['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'background-color', 'background-image',
    'border-color', 'border-width', 'border-style', 'border-radius', 'padding', 'gap', 'letter-spacing', 'line-height', 'text-align', 'width', 'height']);
const safeStyle = (key, value) => STYLE_KEYS.has(key) && typeof value === 'string' && value.length <= 500 && value.length > 0
    && !/[{};<>\\]|url\s*\(|@|expression\s*\(/i.test(value)
    && (key !== 'background-image' || /^(none|initial|unset|revert|revert-layer)$/i.test(value)
        || /^(repeating-)?(linear|radial|conic)-gradient\(/i.test(value) && !/["']/.test(value)
        && [...value.matchAll(/([\w-]+)\s*\(/g)].every(match => /^(?:(?:repeating-)?(?:linear|radial|conic)-gradient|rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix|calc|min|max|clamp)$/i.test(match[1])));
const quoted = value => `"${String(value).replace(/[\\"\n\r\f]/g, c => `\\${c.charCodeAt(0).toString(16)} `)}"`;
const stableClasses = element => [...element.classList].filter(value => /^[a-zA-Z_][\w-]*$/.test(value)
    && !/^(active|selected|hidden|open|closed|disabled|loading|focused|hover|is-|has-)/.test(value));

// Derive targets from the server-owned snapshot, including version-one drafts.
// Never persist positional nth-child selectors: repeated controls must be unique
// by identity, label and containing workspace before they can be applied.
function describeTarget(element, document, node) {
    if (!element || element.localName !== node.tag) return null;
    const classes = stableClasses(element);
    const attributes = Object.fromEntries(['id', 'role', 'aria-label', 'name', 'type', 'data-sidebar-route', 'data-design-route', 'data-capture-tab']
        .filter(key => element.hasAttribute(key)).map(key => [key, element.getAttribute(key)]));
    const text = typeof node.text === 'string' ? node.text : undefined;
    const fingerprint = candidate => candidate.localName === node.tag && classes.every(value => candidate.classList.contains(value))
        && Object.entries(attributes).every(([key, value]) => candidate.getAttribute(key) === value)
        && (text === undefined || !candidate.children.length && candidate.textContent === text);
    const token = value => {
        if (value.id) return `[id=${quoted(value.id)}]`;
        for (const key of ['data-capture-tab', 'data-sidebar-route', 'data-design-route', 'aria-label', 'name']) {
            if (value.hasAttribute(key)) return `${value.localName}[${key}=${quoted(value.getAttribute(key))}]`;
        }
        return value.localName + stableClasses(value).map(name => `.${name}`).join('');
    };
    let selector = token(element);
    const scope = element.closest('[data-capture-tab]');
    const prefix = scope && scope !== element ? `${token(scope)} ` : '';
    for (let ancestor = element.parentElement, depth = 0; depth < 12; depth++, ancestor = ancestor?.parentElement) {
        const candidate = prefix + selector;
        const matches = [...document.querySelectorAll(candidate)].filter(fingerprint);
        if (matches.length === 1 && matches[0] === element) return { selector: candidate, tag: node.tag, classes, attributes, ...(text !== undefined ? { text } : {}) };
        if (!ancestor || ancestor.localName === 'body' || ancestor === scope) break;
        selector = `${token(ancestor)} > ${selector}`;
    }
    return null;
}

function applicationRequests(state) {
    const rows = [];
    for (const capture of state.captures) {
        const requests = state.requests[capture.id];
        if (!requests) continue;
        const { document } = parseHTML(`<html><body>${capture.snapshot.html}</body></html>`);
        for (const node of capture.snapshot.nodes) {
            if (!requests[node.id]) continue;
            const element = document.querySelector(`[data-mirror-id=${quoted(node.id)}]`);
            const surface = element?.matches('.browser-surface,.media-manager-surface,.linked-content-surface')
                || ['iframe', 'webview', 'object', 'embed', 'audio', 'video', 'canvas', 'img'].includes(node.tag) && element?.localName !== node.tag;
            const target = node.scope !== 'menu' && !surface ? describeTarget(element, document, node) : null;
            for (const [property, value] of Object.entries(requests[node.id])) {
                let reason = '';
                if (property === 'note') reason = 'Request only: written UX changes need implementation.';
                else if (node.scope === 'menu') reason = 'Request only: Windows draws the native menu bar.';
                else if (surface) reason = 'Request only: this is an embedded surface placeholder.';
                else if (!target) reason = 'Cannot identify this element uniquely. Capture a view with a distinct target.';
                rows.push({ captureId: capture.id, nodeId: node.id, property, value, target, reason });
            }
        }
    }
    return rows;
}
module.exports = { STYLE_KEYS, safeStyle, describeTarget, applicationRequests };
