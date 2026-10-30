// Runs in the main renderer via executeJavaScript. Read-only: no fetch, events,
// React mount, preference writes or application handlers. Keep it self-contained.
function captureDesignSnapshot(menu = []) {
    const root = document.querySelector('#app');
    if (!root) throw Error('Open the application workspace before capturing a design.');
    const properties = ['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'background-color',
        'background-image', 'border-color', 'border-width', 'border-style', 'border-radius', 'padding',
        'gap', 'letter-spacing', 'line-height', 'text-align', 'width', 'height'];
    const nodes = [], warnings = new Set();
    let count = 0, mediaBytes = 0;
    const blocked = new Set(['script', 'style', 'link', 'meta', 'base', 'noscript', 'template']);
    const surfaces = new Set(['iframe', 'webview', 'object', 'embed', 'audio', 'video']);
    const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
    function clone(source, selector, parent, scope) {
        if (source.nodeType === Node.TEXT_NODE) return document.createTextNode(source.textContent);
        if (source.nodeType !== Node.ELEMENT_NODE) return null;
        if (++count > 30000) throw Error('This view is too large to copy. Close large result lists and try again.');
        const tag = source.localName;
        if (blocked.has(tag)) return null;
        scope = source.getAttribute('data-capture-tab') || scope;
        const id = `n${nodes.length}`, computed = getComputedStyle(source);
        const surface = surfaces.has(tag) || source.matches('.browser-surface,.media-manager-surface,.linked-content-surface');
        const copy = surface ? document.createElement('div') : source.cloneNode(false);
        // URL/event-bearing attributes are never carried into the offline copy.
        for (const attribute of [...copy.attributes]) {
            if (!/^(id|class|style|title|role|aria-[\w-]+|data-[\w-]+|hidden|open|popover|type|name|placeholder|disabled|checked|selected|multiple|rows|cols|width|height|value|min|max|step|size|colspan|rowspan|start|reversed|wrap|viewBox|d|fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|points|x|y|x1|x2|y1|y2|cx|cy|r|rx|ry|transform|xmlns)$/i.test(attribute.name)
                || /url\s*\(/i.test(attribute.value) && attribute.name !== 'style') copy.removeAttribute(attribute.name);
        }
        for (const attribute of [...copy.attributes]) if (attribute.name.startsWith('data-mirror-')) copy.removeAttribute(attribute.name);
        copy.setAttribute('data-mirror-id', id);
        copy.removeAttribute('autofocus'); copy.removeAttribute('inert');
        if (tag === 'dialog' && source.matches(':modal')) copy.setAttribute('data-mirror-modal', '');
        if (source.hasAttribute('popover') && source.matches(':popover-open')) copy.setAttribute('data-mirror-popover-open', '');
        const label = source.getAttribute('aria-label') || source.getAttribute('title') || source.getAttribute('placeholder')
            || (source.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 75) || source.id || tag;
        const editableText = !source.children.length && !['input', 'textarea', 'select', 'img', 'canvas', 'svg', 'path'].includes(tag) && !surface;
        nodes.push({ id, parent, scope, selector, tag, label: label.slice(0, 120),
            styles: Object.fromEntries(properties.map(key => [key, computed.getPropertyValue(key)])),
            ...(editableText ? { text: source.textContent } : {}),
            ...(['input', 'textarea'].includes(tag) ? { placeholder: source.getAttribute('placeholder') || '' } : {}) });
        if (source.scrollTop || source.scrollLeft) {
            copy.dataset.mirrorScrollTop = source.scrollTop; copy.dataset.mirrorScrollLeft = source.scrollLeft;
        }
        if (surface) {
            copy.textContent = 'Embedded surface · open its app controls in the main window to capture them';
            copy.style.cssText = `display:grid;place-items:center;min-height:120px;padding:24px;border:1px dashed #8995a8;color:${computed.color};background:${computed.backgroundColor}`;
            warnings.add('Embedded apps, browser pages, video and native surfaces are placeholders.');
            return copy;
        }
        if (tag === 'input') {
            copy.removeAttribute('name');
            copy.setAttribute('value', ['password', 'hidden', 'file'].includes(source.type) ? '' : source.value);
            copy.toggleAttribute('checked', source.checked);
        }
        if (tag === 'textarea') { copy.textContent = source.value; return copy; }
        if (tag === 'option') copy.toggleAttribute('selected', source.selected);
        if (tag === 'img' || tag === 'canvas') {
            // Use only decoded pixels already in memory; never fetch an asset.
            const image = document.createElement('img');
            for (const attr of copy.attributes) image.setAttribute(attr.name, attr.value);
            image.alt = source.getAttribute('alt') || 'Visual preview';
            try {
                const w = source.naturalWidth || source.width, h = source.naturalHeight || source.height;
                if (!w || !h || mediaBytes > 6 * 1024 * 1024) throw Error();
                const scale = Math.min(1, 1000 / Math.max(w, h));
                const canvas = document.createElement('canvas'); canvas.width = Math.max(1, w * scale); canvas.height = Math.max(1, h * scale);
                canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
                const data = canvas.toDataURL('image/png'); mediaBytes += data.length;
                if (mediaBytes > 8 * 1024 * 1024) throw Error();
                image.src = data;
                image.style.width = computed.width; image.style.height = computed.height;
            } catch { warnings.add('Some media previews could not be copied from memory.'); }
            return image;
        }
        const siblings = new Map();
        for (const child of source.childNodes) {
            const index = child.nodeType === Node.ELEMENT_NODE ? (siblings.get(child.localName) || 0) + 1 : 0;
            if (index) siblings.set(child.localName, index);
            const cloned = clone(child, `${selector} > ${child.localName}:nth-of-type(${index})`, id, scope);
            if (cloned) copy.append(cloned);
        }
        if (source.shadowRoot) warnings.add('Shadow-root contents are not editable in this copy.');
        return copy;
    }
    const copied = clone(root, '#app', null, 'shell');
    // React portals (menus, help, rename and image dialogs) live outside #app.
    // Copy their DOM too, without cloning unrelated scripts or the app twice.
    const portals = [...document.body.querySelectorAll('dialog,[role="dialog"],[role="menu"],[popover]')]
        .filter(node => !root.contains(node) && !node.parentElement.closest('dialog,[role="dialog"],[role="menu"],[popover]'));
    function selectorFor(node) {
        if (node.id && document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) return `#${CSS.escape(node.id)}`;
        if (node === document.body) return 'body';
        const index = [...node.parentElement.children].filter(sibling => sibling.localName === node.localName).indexOf(node) + 1;
        return `${selectorFor(node.parentElement)} > ${node.localName}:nth-of-type(${index})`;
    }
    const portalHTML = portals.map(node => clone(node, selectorFor(node), null, 'shell')?.outerHTML || '').join('');
    let css = '';
    for (const sheet of document.styleSheets) {
        try { css += [...sheet.cssRules].map(rule => rule.cssText).join('\n') + '\n'; }
        catch { warnings.add('A stylesheet was unavailable to copy.'); }
    }
    const attributes = element => [...element.attributes].filter(attr => /^(class|style|data-[\w-]+|lang|dir)$/.test(attr.name))
        .map(attr => `${attr.name}="${escape(attr.value)}"`).join(' ');
    const workspaces = [...root.querySelectorAll('[data-capture-tab]')].map(pane => {
        const id = pane.dataset.captureTab;
        const button = [...root.querySelectorAll('[data-sidebar-route],[data-design-route]')].find(button => button.dataset.sidebarRoute === id || button.dataset.designRoute === id);
        return { id, label: button?.textContent.trim().replace(/\s+/g, ' ').slice(0, 70) || id, available: !!pane.children.length, visible: !pane.hidden };
    });
    function menuContainer(label, parent, popup = false) {
        const id = `n${nodes.length}`;
        nodes.push({ id, parent, scope: 'menu', selector: label, tag: popup ? 'div' : 'nav', label,
            styles: { 'font-family': '"Segoe UI", sans-serif', 'font-size': '13px', 'font-weight': '400', 'font-style': 'normal',
                color: 'rgb(232, 237, 246)', 'background-color': 'rgb(28, 35, 48)', 'background-image': 'none',
                'border-color': 'rgb(86, 98, 119)', 'border-width': popup ? '1px' : '0px', 'border-style': popup ? 'solid' : 'none',
                'border-radius': '0px', padding: popup ? '4px' : '1px 6px', gap: popup ? 'normal' : '2px',
                'letter-spacing': 'normal', 'line-height': 'normal', 'text-align': 'left', width: 'auto', height: popup ? 'auto' : '34px' } });
        return id;
    }
    function menuItems(items, parent, trail = 'Menu bar') {
        return items.map(item => {
            const id = `n${nodes.length}`, selector = `${trail} > ${item.label}`;
            nodes.push({ id, parent, scope: 'menu', selector, tag: 'button', label: item.label, text: item.label,
                styles: { 'font-family': '"Segoe UI", sans-serif', 'font-size': '13px', 'font-weight': '400', 'font-style': 'normal',
                    color: 'rgb(232, 237, 246)', 'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none',
                    'border-color': 'rgb(232, 237, 246)', 'border-width': '0px', 'border-style': 'none', 'border-radius': '4px',
                    padding: '6px 12px', gap: 'normal', 'letter-spacing': 'normal', 'line-height': '20px', 'text-align': 'left', width: 'auto', height: 'auto' } });
            const popupId = item.items ? menuContainer(`${selector} submenu`, parent, true) : null;
            return `<div class="mirror-menu-item"><button data-mirror-id="${id}"${item.items ? ' data-mirror-menu="true"' : ''}>${escape(item.label)}</button>${item.items ? `<div class="mirror-menu-popup" data-mirror-id="${popupId}" hidden>${menuItems(item.items, popupId, selector)}</div>` : ''}</div>`;
        }).join('');
    }
    const menuId = menu.length ? menuContainer('Menu bar', null) : null;
    const menuHtml = menu.length ? `<nav class="mirror-menubar" data-mirror-id="${menuId}" aria-label="Menu bar design preview">${menuItems(menu, menuId)}</nav>` : '';
    return { version: 1, capturedAt: new Date().toISOString(), title: root.querySelector('.workspace-navigation > span')?.textContent || 'Application',
        width: innerWidth, height: innerHeight, html: copied.outerHTML + portalHTML, css, htmlAttributes: attributes(document.documentElement),
        bodyAttributes: attributes(document.body), menuHtml, nodes, workspaces, warnings: [...warnings] };
}
module.exports = { captureDesignSnapshot };
