import { fields, fieldLabel, withChange, editCount, snapshotDocument } from './model.mjs';

const $ = id => document.getElementById(id);
const bridge = window.designMirror;
let state = { captures: [], requests: {} }, currentId, selectedId, workspace = '', reviewing = false;
let generation = 0, savedGeneration = 0, saveTask = null, saveError = false;
let applicationPlan = null, checkingApplication = 0, applying = false;
const history = [], originals = new WeakMap(), elementMaps = new WeakMap();
const frames = [$('before'), $('after')];
const capture = () => state.captures.find(item => item.id === currentId);
const selected = () => capture()?.snapshot.nodes.find(node => node.id === selectedId);
const nodeFor = (frame, id) => elementMaps.get(frame.contentDocument)?.get(id);
const text = (tag, value, className) => { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node; };
function status(message, error = false) { $('status').textContent = message; $('status').parentElement.classList.toggle('error', error); }
async function call(method, value) { const result = await bridge[method](value); if (result?.error) throw Error(result.error); return result; }

function save() {
    if (saveTask) return saveTask;
    saveError = false; $('retry-save').hidden = true;
    if (savedGeneration < generation) status('Saving design draft…');
    saveTask = (async () => {
        while (savedGeneration < generation) {
            const version = generation;
            await call('save', { captureIds: state.captures.map(item => item.id), requests: state.requests });
            savedGeneration = version;
        }
        status('Draft saved on this device. Preview edits take effect only when you choose Apply to app.');
    })().catch(error => { saveError = true; $('retry-save').hidden = false; status(`Draft not saved: ${error.message} Keep this window open and retry.`, true); })
        .finally(() => { saveTask = null; });
    return saveTask;
}
function changed(previous = state.requests) {
    checkingApplication++;
    applicationPlan = null; $('apply').disabled = true;
    history.push(previous); if (history.length > 60) history.shift();
    generation++; updateCount(); void save();
}
function updateCount() {
    const count = editCount(state.requests);
    $('count').textContent = count; $('review').disabled = !count;
    $('review').classList.toggle('ready', count > 0); $('export').disabled = !count;
    $('undo').disabled = !history.length;
}
function option(select, value, label) { const item = text('option', label); item.value = value; select.append(item); }
function renderCaptures() {
    $('captures').replaceChildren();
    for (const item of state.captures) option($('captures'), item.id, `${item.snapshot.title} · ${new Date(item.snapshot.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    $('captures').value = currentId || '';
    $('remove-capture').disabled = !capture();
    $('workspace').replaceChildren();
    option($('workspace'), '', 'As captured (including open dialogs)');
    for (const item of capture()?.snapshot.workspaces || []) {
        option($('workspace'), item.id, `${item.label}${item.available ? '' : ' · not loaded'}`);
        $('workspace').lastChild.disabled = !item.available;
    }
    $('workspace').value = workspace;
    $('capture-time').textContent = capture() ? new Date(capture().snapshot.capturedAt).toLocaleString() : '';
    $('warnings').replaceChildren(...(capture()?.snapshot.warnings || []).map(value => text('li', value)));
    renderElements();
}
function renderElements() {
    const select = $('elements'), query = $('search').value.trim().toLowerCase();
    select.replaceChildren();
    const snapshot = capture()?.snapshot;
    const visible = workspace ? [workspace] : snapshot?.workspaces.filter(item => item.visible).map(item => item.id) || [];
    const available = (snapshot?.nodes || []).filter(node => (['shell', 'menu'].includes(node.scope) || visible.includes(node.scope))
        && (!query || `${node.label} ${node.tag}`.toLowerCase().includes(query)));
    // Bound the chooser while click selection can still reach every captured node.
    for (const node of available.slice(0, 500)) option(select, node.id, `${node.tag} · ${node.label}`);
    const target = selected();
    if (target && ![...select.options].some(item => item.value === target.id)) option(select, target.id, `${target.tag} · ${target.label}`);
    select.value = selectedId || '';
}
function restoreAndApply(frame) {
    const snapshot = capture()?.snapshot, doc = frame.contentDocument;
    if (!snapshot || !doc?.body) return;
    const requests = frame.id === 'after' ? state.requests[currentId] || {} : {};
    for (const node of snapshot.nodes) {
        const element = nodeFor(frame, node.id);
        if (!element) continue;
        if (!originals.has(element)) originals.set(element, { style: element.getAttribute('style'), text: element.textContent, placeholder: element.getAttribute('placeholder') });
        const original = originals.get(element);
        if (original.style === null) element.removeAttribute('style'); else element.setAttribute('style', original.style);
        if (typeof node.text === 'string') element.textContent = original.text;
        if (typeof node.placeholder === 'string') {
            if (original.placeholder === null) element.removeAttribute('placeholder'); else element.setAttribute('placeholder', original.placeholder);
        }
        for (const [key, value] of Object.entries(requests[node.id] || {})) {
            if (key === 'text') element.textContent = value;
            else if (key === 'placeholder') element.setAttribute(key, value);
            else if (fields.some(field => field.key === key)) element.style.setProperty(key, value, 'important');
        }
    }
    highlight();
}
function selectWorkspace(value) {
    workspace = value; $('workspace').value = value;
    const snapshot = capture()?.snapshot;
    if (!snapshot) return;
    for (const frame of frames) {
        const doc = frame.contentDocument;
        for (const pane of doc?.querySelectorAll('[data-capture-tab]') || []) pane.hidden = value ? pane.dataset.captureTab !== value : !snapshot.workspaces.find(item => item.id === pane.dataset.captureTab)?.visible;
        const root = doc?.querySelector('#app');
        if (value) {
            root?.classList.remove('navigation-open');
            doc.querySelector('.workspace-panes')?.classList.remove('split-chat', 'split-stacked');
            doc.querySelectorAll('.pinned-workspace,.primary-workspace').forEach(node => node.classList.remove('pinned-workspace', 'primary-workspace'));
            doc.querySelectorAll('[role="dialog"],dialog,[popover],.navigation-backdrop').forEach(node => {
                if (!node.closest('.sidebar-shell')) {
                    if (node.tagName === 'DIALOG' && node.open) node.close();
                    if (node.matches(':popover-open')) node.hidePopover();
                    node.hidden = true;
                }
            });
            const heading = doc.querySelector('.workspace-navigation > span');
            if (heading && !state.requests[currentId]?.[heading.dataset.mirrorId]?.text) heading.textContent = snapshot.workspaces.find(item => item.id === value)?.label || value;
            for (const button of doc.querySelectorAll('[data-sidebar-route]')) {
                if (button.dataset.sidebarRoute === value) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
            }
            for (const sidebar of doc.querySelectorAll('[data-capture-sidebar]')) sidebar.hidden = sidebar.dataset.captureSidebar !== value;
        }
    }
    renderElements();
}
function highlight() {
    for (const frame of frames) {
        frame.contentDocument?.querySelectorAll('[data-mirror-selected]').forEach(node => node.removeAttribute('data-mirror-selected'));
        nodeFor(frame, selectedId)?.setAttribute('data-mirror-selected', '');
    }
}
function revealTarget(frame, element) {
    let parent = element?.parentElement;
    while (parent && parent !== frame.contentDocument.body) {
        if (parent.tagName === 'DETAILS') parent.open = true;
        if (parent.hidden && !parent.matches('[data-capture-tab]')) parent.hidden = false;
        if (parent.hasAttribute('popover') && !parent.matches(':popover-open')) parent.showPopover();
        if (parent.tagName === 'DIALOG' && !parent.open) parent.showModal();
        parent = parent.parentElement;
    }
    element?.scrollIntoView({ block: 'center', inline: 'nearest' });
}
function choose(id, scroll = false) {
    selectedId = id; highlight(); renderElements(); renderInspector();
    $('element-picker').open = !selected();
    if (scroll && selected()) { $('selected-label').tabIndex = -1; $('selected-label').focus({ preventScroll: true }); }
    if (scroll) for (const frame of frames) revealTarget(frame, nodeFor(frame, id));
    if (reviewing) document.querySelectorAll('.change-card').forEach(node => node.classList.toggle('active', node.dataset.capture === currentId && node.dataset.target === selectedId));
}
function toggleSection() {
    for (const frame of frames) {
        const node = nodeFor(frame, selectedId);
        if (!node) continue;
        const menu = node.hasAttribute('data-mirror-menu') && node.nextElementSibling;
        const details = node.closest('summary')?.parentElement || (node.tagName === 'DETAILS' ? node : null);
        const controlled = node.getAttribute('aria-controls')?.split(' ').map(id => frame.contentDocument.getElementById(id)).filter(Boolean);
        if (menu) menu.hidden = !menu.hidden;
        else if (details) details.open = !details.open;
        else controlled?.forEach(item => {
            if (item.hasAttribute('popover')) { item.hidden = false; item.togglePopover(); node.setAttribute('aria-expanded', String(item.matches(':popover-open'))); }
            else { item.hidden = !item.hidden; node.setAttribute('aria-expanded', String(!item.hidden)); }
        });
    }
}
function mountFrames() {
    const item = capture();
    for (const frame of frames) {
        frame.onload = () => {
            if (!item || capture()?.id !== item.id) return;
            const doc = frame.contentDocument;
            elementMaps.set(doc, new Map([...doc.querySelectorAll('[data-mirror-id]')].map(node => [node.dataset.mirrorId, node])));
            if (!workspace) for (const modal of doc.querySelectorAll('dialog[data-mirror-modal]')) { modal.removeAttribute('open'); modal.showModal(); }
            if (!workspace) for (const popup of doc.querySelectorAll('[data-mirror-popover-open]')) popup.showPopover();
            restoreAndApply(frame);
            if (workspace) selectWorkspace(workspace);
            doc.querySelectorAll('[data-mirror-scroll-top]').forEach(node => { node.scrollTop = Number(node.dataset.mirrorScrollTop); node.scrollLeft = Number(node.dataset.mirrorScrollLeft); });
            // Capture events before any native control defaults; the copy has no
            // application handlers and its sandbox refuses all script execution.
            doc.addEventListener('pointerdown', event => {
                const element = event.target.closest('[data-mirror-id]');
                if (element) choose(element.dataset.mirrorId);
                if (event.target.closest('input,select,textarea,button,a')) event.preventDefault();
            }, true);
            doc.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); }, true);
            doc.addEventListener('dblclick', event => { event.preventDefault(); toggleSection(); }, true);
            doc.addEventListener('submit', event => event.preventDefault(), true);
            doc.addEventListener('keydown', event => { if (event.key !== 'Tab') event.preventDefault(); }, true);
            doc.addEventListener('scroll', event => {
                if (!reviewing) return;
                const other = frames.find(value => value !== frame), source = event.target;
                const target = source === doc ? other.contentDocument?.scrollingElement : nodeFor(other, source.dataset?.mirrorId);
                const scrollSource = source === doc ? doc.scrollingElement : source;
                if (target && scrollSource && (target.scrollTop !== scrollSource.scrollTop || target.scrollLeft !== scrollSource.scrollLeft)) {
                    target.scrollTop = scrollSource.scrollTop; target.scrollLeft = scrollSource.scrollLeft;
                }
            }, { capture: true, passive: true });
            if (selectedId) { highlight(); if (reviewing) revealTarget(frame, nodeFor(frame, selectedId)); }
            scaleFrames();
        };
        frame.srcdoc = item ? snapshotDocument(item.snapshot) : '<!doctype html><body style="background:#10141c;color:#a2aec1;font:16px sans-serif;padding:32px">Add the current app view to start a design.</body>';
    }
    scaleFrames();
}
function scaleFrames() {
    for (const frame of frames) {
        const snapshot = capture()?.snapshot;
        const width = snapshot?.width || 1200, height = (snapshot?.height || 800) + 34;
        const viewport = frame.closest('.viewport');
        const scale = $('zoom').value === 'fit' ? Math.min(1, (viewport.clientWidth || 600) / width, Math.max(200, innerHeight * .70) / height) : Number($('zoom').value);
        frame.style.width = `${width}px`; frame.style.height = `${height}px`; frame.style.transform = `scale(${scale})`;
        frame.parentElement.style.width = `${width * scale}px`; frame.parentElement.style.height = `${height * scale}px`;
    }
}
function setChange(key, value) {
    const node = selected(); if (!node) return;
    const previous = state.requests;
    if (value !== null && fields.some(field => field.key === key)) {
        if (!CSS.supports(key, value) || /[{};<>\\]|url\s*\(|@|expression\s*\(/i.test(value)
            || key === 'background-image' && /["']|(?:image-set|image|paint|element|var|env)\s*\(/i.test(value)) { status('Choose a valid color or style value. Backgrounds support colors and gradients without external images.', true); return; }
        // Canonicalize colors/lengths before comparing with the captured value.
        const probe = document.createElement('span'); probe.style.setProperty(key, value);
        value = probe.style.getPropertyValue(key);
    }
    state.requests = withChange(state.requests, currentId, node, key, value);
    if (JSON.stringify(previous) === JSON.stringify(state.requests)) return;
    restoreAndApply($('after')); changed(previous);
    $('reset-element').disabled = !state.requests[currentId]?.[node.id];
}
function renderInspector() {
    const node = selected();
    $('selection').hidden = !node; $('selection-empty').hidden = !!node;
    if (!node) return;
    $('tag').textContent = `${node.scope} / ${node.tag}`;
    $('selected-label').textContent = node.label;
    $('target-path').textContent = node.selector;
    $('parent').disabled = !node.parent;
    $('reset-element').disabled = !state.requests[currentId]?.[node.id];
    const target = nodeFor($('after'), node.id);
    $('reveal').hidden = !(target?.hasAttribute('data-mirror-menu') || target?.hasAttribute('aria-controls') || target?.matches('summary,details'));
    const changes = state.requests[currentId]?.[node.id] || {};
    $('note').value = changes.note || '';
    $('fields').replaceChildren();
    for (const field of [...(typeof node.text === 'string' ? [{ key: 'text', label: 'Display text' }] : []), ...(typeof node.placeholder === 'string' ? [{ key: 'placeholder', label: 'Placeholder text' }] : []), ...fields]) {
        const original = node[field.key] ?? node.styles[field.key] ?? '', value = changes[field.key] ?? original;
        const wrapper = text('div', '', 'field'), label = text('label', field.label), line = text('div', '', 'field-line');
        let control;
        if (field.options) {
            control = document.createElement('select');
            for (const optionValue of [...new Set([original, ...field.options, value])]) option(control, optionValue, optionValue === original ? `Original · ${optionValue.slice(0, 65)}` : optionValue);
            control.value = value;
            control.onchange = () => setChange(field.key, control.value);
        } else {
            control = document.createElement('input'); control.maxLength = 500;
            if (field.unit) {
                control.type = 'number'; control.min = field.min; control.max = field.max; control.step = .5;
                control.value = /^-?[\d.]+px$/.test(value) ? parseFloat(value) : '';
                control.placeholder = original;
                control.oninput = () => { if (control.value !== '' && control.validity.valid) setChange(field.key, `${control.value}${field.unit}`); };
            } else {
                control.type = 'text'; control.value = value;
                control[field.color ? 'onchange' : 'oninput'] = () => setChange(field.key, control.value);
            }
        }
        control.id = `edit-${field.key}`; label.htmlFor = control.id;
        line.append(control);
        if (field.color) {
            const picker = document.createElement('input'); picker.type = 'color'; picker.setAttribute('aria-label', `${field.label} picker`);
            const rgb = value.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
            picker.value = rgb ? '#' + rgb.slice(1).map(value => Number(value).toString(16).padStart(2, '0')).join('') : /^#[\da-f]{6}$/i.test(value) ? value : '#000000';
            picker.oninput = () => { control.value = picker.value; setChange(field.key, picker.value); }; line.append(picker);
        }
        const reset = text('button', '↺'); reset.title = `Restore original ${field.label.toLowerCase()}`; reset.setAttribute('aria-label', reset.title);
        reset.onclick = () => { setChange(field.key, null); renderInspector(); }; line.append(reset);
        wrapper.append(label, line, text('span', `Original: ${original || '(empty)'}`, 'original-value')); $('fields').append(wrapper);
    }
}
function renderReview() {
    const container = $('changes'); container.replaceChildren();
    for (const item of state.captures) for (const node of item.snapshot.nodes) {
        const changes = state.requests[item.id]?.[node.id]; if (!changes) continue;
        const card = text('article', '', 'change-card'); card.dataset.capture = item.id; card.dataset.target = node.id;
        const heading = document.createElement('header'), title = document.createElement('div');
        title.append(text('h3', node.label), text('p', `${item.snapshot.title} · ${node.scope} · ${node.selector}`));
        const compare = text('button', 'Compare target'); compare.onclick = () => {
            currentId = item.id; selectedId = node.id;
            workspace = ['shell', 'menu'].includes(node.scope) ? '' : node.scope;
            renderCaptures();
            mountFrames();
            $('comparison').scrollIntoView({ block: 'start' });
            container.querySelectorAll('.change-card').forEach(element => element.classList.toggle('active', element === card));
        };
        heading.append(title, compare); card.append(heading);
        const table = document.createElement('table'), row = document.createElement('tr');
        for (const label of ['PROPERTY', 'ORIGINAL', 'REQUESTED', 'APPLICATION CHECK']) row.append(text('th', label));
        const head = document.createElement('thead'); head.append(row); table.append(head);
        const body = document.createElement('tbody');
        for (const [key, value] of Object.entries(changes)) {
            const row = document.createElement('tr');
            for (const cell of [fieldLabel(key), key === 'note' ? '—' : node[key] ?? node.styles[key] ?? '', value || '(empty)']) row.append(text('td', cell));
            const check = applicationPlan?.rows.find(entry => entry.captureId === item.id && entry.nodeId === node.id && entry.property === key);
            const detail = text('td', check ? check.reason : 'Checking…', `application-${check?.status || 'pending'}`);
            if (check?.current !== undefined) detail.append(text('small', `App now: ${check.current || '(empty)'}`));
            row.append(detail);
            body.append(row);
        }
        table.append(body); card.append(table); container.append(card);
    }
    if (!container.children.length) container.append(text('p', 'No requested edits. Return to the playground and select an element.', 'review-empty'));
}
function setReview(value) {
    reviewing = value; $('workbench').classList.toggle('reviewing', value);
    $('inspector').hidden = value; $('before-panel').hidden = !value; $('back').hidden = !value; $('review-list').hidden = !value;
    $('canvas-title').textContent = value ? 'Your original. Your proposed design.' : 'Select a detail. Try a new look.';
    $('canvas-kicker').textContent = value ? 'COMPARE YOUR REQUESTS' : 'YOUR APPLICATION, AS A PLAYGROUND';
    $('canvas-help').textContent = value ? 'Identical viewport sizes · Linked scrolling · Frozen originals stay available after Apply' : 'Click to edit · Double-click menus and disclosures to open them · Scroll to reach more controls';
    if (value) { restoreAndApply($('before')); renderReview(); void checkApplication(); }
    scaleFrames(); window.scrollTo(0, 0);
}
async function checkApplication() {
    const check = ++checkingApplication;
    applicationPlan = null; $('apply').disabled = true;
    $('application-status').textContent = 'Checking the current app against your requests…';
    try {
        await save(); if (saveError) throw Error('Save the draft before applying.');
        const plan = await call('prepareApplication');
        if (check !== checkingApplication) return;
        applicationPlan = plan;
        $('undo-application').disabled = !plan.canUndo || applying;
        const blocked = plan.rows.filter(row => row.status === 'blocked').length;
        const done = plan.rows.filter(row => row.status === 'applied').length;
        $('application-status').textContent = `${plan.ready} ready to apply · ${done} already applied · ${blocked} request-only or unavailable. Only ready changes will be applied.`;
        $('apply').textContent = plan.ready ? `Apply ${plan.ready} ${plan.ready === 1 ? 'change' : 'changes'} to app` : 'Apply to app';
        $('apply').disabled = !plan.ready || applying;
        if (reviewing) renderReview();
        return true;
    } catch (error) {
        if (check === checkingApplication) { $('application-status').textContent = error.message; status(error.message, true); }
        return false;
    }
}
async function changeApplication(undo = false) {
    if (applying || !undo && !applicationPlan?.ready) return;
    const ticket = applicationPlan?.ticket;
    applying = true; $('apply').disabled = true; $('undo-application').disabled = true;
    document.querySelector('main').inert = true; $('capture').disabled = true;
    status(undo ? 'Restoring the previous applied design…' : 'Applying your reviewed changes…');
    let message, failed = false;
    try {
        const result = await call(undo ? 'undoApplication' : 'applyToApp', { ticket });
        message = undo ? 'Last application undone. The previous design is restored and saved.' : `${result.count} ${result.count === 1 ? 'change applied' : 'changes applied'} and saved for future restarts. Undo last application can restore the previous design.`;
    } catch (error) { message = error.message; failed = true; }
    finally {
        applying = false; document.querySelector('main').inert = false; $('capture').disabled = false;
        await checkApplication(); status(message, failed);
    }
}
$('apply').onclick = () => { void changeApplication(); };
$('undo-application').onclick = () => { void changeApplication(true); };
$('refresh-application').onclick = () => { void checkApplication(); };
$('captures').onchange = () => { currentId = $('captures').value; workspace = ''; selectedId = null; renderCaptures(); renderInspector(); mountFrames(); };
$('workspace').onchange = () => { workspace = $('workspace').value; selectedId = null; mountFrames(); renderElements(); renderInspector(); };
$('elements').onchange = () => choose($('elements').value, true);
$('search').oninput = renderElements;
$('zoom').onchange = scaleFrames;
$('parent').onclick = () => choose(selected()?.parent, true);
$('reveal').onclick = toggleSection;
$('note').oninput = () => setChange('note', $('note').value);
$('reset-element').onclick = () => { const previous = state.requests; state.requests = structuredClone(previous); delete state.requests[currentId]?.[selectedId]; if (!Object.keys(state.requests[currentId] || {}).length) delete state.requests[currentId]; changed(previous); restoreAndApply($('after')); renderInspector(); };
$('undo').onclick = () => { if (!history.length) return; state.requests = history.pop(); generation++; updateCount(); void save(); restoreAndApply($('after')); renderInspector(); };
$('review').onclick = () => setReview(true);
$('back').onclick = () => { setReview(false); renderInspector(); };
$('retry-save').onclick = () => { void save(); };
$('capture').onclick = async () => {
    $('capture').disabled = true;
    document.querySelector('main').inert = true;
    try {
        await save(); if (saveError) return;
        status('Copying the rendered app…');
        const item = await call('capture'); state.captures.push(item); currentId = item.id; selectedId = null; workspace = '';
        renderCaptures(); renderInspector(); mountFrames(); if (reviewing) { renderReview(); void checkApplication(); }
        status('New copy captured and saved. Earlier requests are still in your draft.');
    } catch (error) { status(error.message, true); } finally { $('capture').disabled = false; document.querySelector('main').inert = false; }
};
$('remove-capture').onclick = () => $('remove-dialog').showModal();
$('cancel-remove').onclick = () => $('remove-dialog').close();
$('confirm-remove').onclick = () => {
    const previous = state.requests; state.requests = structuredClone(previous); delete state.requests[currentId];
    state.captures = state.captures.filter(item => item.id !== currentId); history.length = 0;
    currentId = state.captures.at(-1)?.id; selectedId = null; workspace = ''; generation++; void save();
    $('remove-dialog').close(); renderCaptures(); renderInspector(); mountFrames(); updateCount(); if (reviewing) { renderReview(); void checkApplication(); }
};
$('export').onclick = async () => {
    $('export').disabled = true;
    try { await save(); if (saveError) return; const result = await call('exportReview'); if (result.exported) status('Requested edits exported as JSON. Export does not change the app.'); }
    catch (error) { status(error.message, true); } finally { updateCount(); }
};
window.addEventListener('beforeunload', event => {
    if (applying) { event.preventDefault(); event.returnValue = ''; return; }
    if (savedGeneration < generation) { event.preventDefault(); event.returnValue = ''; status(saveError ? 'Retry saving before closing to keep the latest edits.' : 'Finishing the draft save. Close this window again in a moment.', true); void save(); }
});
let resizeFrame;
new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(scaleFrames); }).observe($('comparison'));
try {
    if (!bridge) throw Error('Open UI Design Mirror from the application’s Design menu.');
    state = await call('load'); currentId = state.captures.at(-1)?.id;
    renderCaptures(); mountFrames(); updateCount();
    if (await checkApplication()) status(state.warning || 'Choose an element in the copy to start. Changes stay in this design draft.', !!state.warning);
} catch (error) { status(error.message, true); }
