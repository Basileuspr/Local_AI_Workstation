// Installed only in the application renderer, never in a mirror frame. No app
// actions, React state, input values, network or backend access are used here.
function installDesignRuntime() {
    if (window.__workstationDesignRuntime) return;
    let rules = [], owned = [], scheduled = false;
    const read = (element, property) => property === 'text' ? element.textContent
        : property === 'placeholder' ? element.getAttribute(property) || '' : getComputedStyle(element).getPropertyValue(property);
    function resolve(target, allowedText = []) {
        const candidates = [...document.querySelectorAll(target.selector)].filter(element => element.localName === target.tag
            && target.classes.every(value => element.classList.contains(value))
            && Object.entries(target.attributes).every(([key, value]) => element.getAttribute(key) === value)
            && (target.text === undefined || !element.children.length && [target.text, ...allowedText].includes(element.textContent)));
        return candidates.length === 1 ? candidates[0] : null;
    }
    function elementFor(target) {
        const texts = rules.filter(rule => rule.target.selector === target.selector).map(rule => rule.changes.text).filter(value => value !== undefined);
        return resolve(target, texts);
    }
    function inspect(rows) {
        const canonical = new Map();
        return rows.map(row => {
            if (row.reason && (!row.status || row.status === 'blocked')) return { ...row, status: 'blocked' };
            const element = elementFor(row.target);
            if (!element) return { ...row, status: 'blocked', reason: 'Target is missing, changed or ambiguous. Open that view in the app and capture it again.' };
            if (!['text', 'placeholder'].includes(row.property) && !CSS.supports(row.property, row.value)) {
                return { ...row, status: 'blocked', reason: 'This CSS value is not supported.' };
            }
            const existing = owned.find(item => item.element === element)?.rule;
            if (!canonical.has(element)) canonical.set(element, existing?.target || row.target);
            const current = read(element, row.property);
            const already = current === row.value || existing?.changes[row.property] === row.value
                && (row.property === 'text' || row.property === 'placeholder' ? current === row.value
                    : element.style.getPropertyValue(row.property) === normalized(row.property, row.value));
            return { ...row, target: canonical.get(element), ruleId: existing?.id, current,
                status: already ? 'applied' : 'ready', reason: already ? 'Already applied' : 'Ready to apply' };
        });
    }
    function normalized(property, value) { const style = document.createElement('span').style; style.setProperty(property, value); return style.getPropertyValue(property); }
    function restore() {
        for (const item of owned) {
            const { element, property, before, after } = item;
            if (property === 'text') {
                // Keep React's existing text nodes and event handlers intact.
                if (element.textContent === after && !element.children.length) {
                    for (const part of before) if (part.node.parentNode === element) part.node.nodeValue = part.value;
                    if (item.created?.parentNode === element) item.created.remove();
                }
            } else if (property === 'placeholder') {
                if (element.getAttribute(property) === after) {
                    if (before === null) element.removeAttribute(property); else element.setAttribute(property, before);
                }
            } else if (element.style.getPropertyValue(property) === after && element.style.getPropertyPriority(property) === 'important') {
                if (before.value) element.style.setProperty(property, before.value, before.priority); else element.style.removeProperty(property);
            }
        }
        owned = [];
    }
    function synchronize() {
        observer.disconnect();
        try {
            restore();
            // Resolve all elements before changing any ancestor style or label.
            const targets = rules.map(rule => [rule, resolve(rule.target)]);
            for (const [rule, element] of targets) {
                if (!element) continue;
                for (const [property, value] of Object.entries(rule.changes)) {
                    if (property === 'text') {
                        if (element.children.length) continue;
                        const before = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => ({ node, value: node.nodeValue }));
                        let created;
                        if (before.length) before.forEach((part, index) => { part.node.nodeValue = index ? '' : value; });
                        else { created = document.createTextNode(value); element.append(created); }
                        owned.push({ element, rule, property, before, after: value, created });
                    } else if (property === 'placeholder') {
                        const before = element.getAttribute(property); element.setAttribute(property, value);
                        owned.push({ element, rule, property, before, after: value });
                    } else {
                        const before = { value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) };
                        element.style.setProperty(property, value, 'important');
                        owned.push({ element, rule, property, before, after: element.style.getPropertyValue(property) });
                    }
                }
            }
        } finally { if (rules.length) observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true }); }
    }
    const observer = new MutationObserver(() => {
        if (!scheduled) { scheduled = true; queueMicrotask(() => { scheduled = false; synchronize(); }); }
    });
    window.__workstationDesignRuntime = Object.freeze({
        inspect,
        replace(next, expected = []) {
            const current = inspect(expected);
            if (current.some((row, index) => row.status !== 'ready' || row.current !== expected[index].current)) {
                throw Error('The app changed since review. Refresh the application check before applying.');
            }
            rules = next;
            synchronize();
            return true;
        },
    });
}
module.exports = { installDesignRuntime };
