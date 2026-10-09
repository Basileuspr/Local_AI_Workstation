import { Extension, Node } from '@tiptap/core';
import { Plugin, TextSelection, NodeSelection } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';
import { closeHistory } from '@tiptap/pm/history';
import { documentReferences, goToReference } from './documentReferences';
import { printable } from './documentCitations';

export const CAPTION_ID = /^LAW_C[0-9a-f]{32}$/;
export const CAPTION_LABEL = /^[A-Za-z][A-Za-z0-9 _-]{0,29}$/;
export const CAPTION_FORMATS = [['decimal', '1, 2, 3'], ['upperRoman', 'I, II, III'], ['lowerRoman', 'i, ii, iii'], ['upperLetter', 'A, B, C'], ['lowerLetter', 'a, b, c']];
export const DEFAULT_CAPTION_LABELS = ['Figure', 'Table', 'Equation'];
const freshId = () => 'LAW_C' + crypto.randomUUID().replaceAll('-', '');
const freshReferenceId = () => 'xref-' + crypto.randomUUID().replaceAll('-', '');
export function captionNumber(number, format = 'decimal') {
  if (format.endsWith('Letter')) {
    let text = ''; while (number) { number--; text = String.fromCharCode(65 + number % 26) + text; number = Math.floor(number / 26); }
    return format === 'lowerLetter' ? text.toLowerCase() : text;
  }
  if (format.endsWith('Roman')) {
    let text = ''; for (const [value, symbol] of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']]) while (number >= value) { text += symbol; number -= value; }
    return format === 'lowerRoman' ? text.toLowerCase() : text;
  }
  return String(number);
}
export const captionSettings = doc => doc.attrs.captionSettings || {};
export function captionsIn(doc) {
  const captions = [], references = [];
  doc.descendants((node, pos) => { if (node.type.name === 'documentCaption') captions.push({ ...node.attrs, node, pos }); if (node.type.name === 'documentCrossReference') references.push({ ...node.attrs, node, pos }); });
  return { captions, references };
}
const cache = new WeakMap();
export function captionContext(doc) {
  if (cache.has(doc)) return cache.get(doc);
  const counters = new Map(), settings = captionSettings(doc);
  const captions = captionsIn(doc).captions.map(item => {
    const key = item.label.toLowerCase(), rule = settings[item.label] || { start: 1, format: 'decimal' };
    const ordinal = counters.has(key) ? counters.get(key) + 1 : rule.start; counters.set(key, ordinal);
    const number = captionNumber(ordinal, rule.format), labelNumber = item.label + ' ' + number;
    return { ...item, ordinal, number, labelNumber, full: labelNumber + (item.text ? ': ' + item.text : '') };
  });
  const result = { captions, map: new Map(captions.map(item => [item.id, item])) }; cache.set(doc, result); return result;
}
const targetCache = new WeakMap();
export function crossReferenceTargets(doc) {
  if (targetCache.has(doc)) return targetCache.get(doc);
  const refs = documentReferences(doc), targets = new Map();
  for (const item of refs.targets.values()) targets.set(item.name, { ...item, kind: item.level ? 'heading' : 'bookmark', full: item.text });
  for (const item of captionContext(doc).captions) targets.set(item.id, { ...item, name: item.id, kind: 'caption' });
  targetCache.set(doc, targets); return targets;
}
export function crossReferenceText(attrs, doc) {
  const target = crossReferenceTargets(doc).get(attrs.target);
  if (!target) return '[Missing reference: ' + attrs.target + ']';
  return target.kind === 'caption' ? target[attrs.display] ?? target.full : target.full;
}
export function captionError(attrs) {
  if (!attrs || !CAPTION_LABEL.test(attrs.label || '') || attrs.label !== attrs.label.trim()) return 'Use a label of 1–30 letters, numbers, spaces, underscores or hyphens, beginning with a letter.';
  if (!printable(attrs.text ?? '', 1000)) return 'Caption text supports up to 1,000 printable characters.';
  return '';
}
export function saveCaption(editor, attrs, id = null, position = 'after') {
  if (editor.isEditable === false) return false;
  const value = { label: attrs.label?.trim(), text: attrs.text ?? '' }, error = captionError(value); if (error) throw new Error(error);
  const all = captionsIn(editor.state.doc).captions, labels = new Set([...Object.keys(captionSettings(editor.state.doc)), ...all.map(item => item.label)]);
  value.label = [...labels].find(label => label.toLowerCase() === value.label.toLowerCase()) || value.label;
  if (!labels.has(value.label) && labels.size >= 20) throw new Error('A document supports up to 20 caption labels.');
  const tr = closeHistory(editor.state.tr);
  if (id) {
    const item = all.find(item => item.id === id); if (!item) throw new Error('The caption no longer exists.');
    tr.setNodeMarkup(item.pos, undefined, { ...value, id });
  } else {
    if (all.length >= 200) throw new Error('A document supports up to 200 captions.');
    if (!['before', 'after'].includes(position)) throw new Error('Choose above or below the current block.');
    const { $from, from, to } = editor.state.selection;
    const pos = $from.depth ? (position === 'before' ? $from.before(1) : $from.after(1)) : position === 'before' ? from : to;
    id = freshId(); tr.insert(pos, editor.schema.nodes.documentCaption.create({ ...value, id })); tr.setSelection(NodeSelection.create(tr.doc, pos));
  }
  editor.view.dispatch(tr); return id;
}
export function removeCaption(editor, id) {
  if (editor.isEditable === false) return false;
  const item = captionsIn(editor.state.doc).captions.find(item => item.id === id); if (!item) return false;
  editor.view.dispatch(closeHistory(editor.state.tr).delete(item.pos, item.pos + item.node.nodeSize)); return true;
}
export function moveCaption(editor, id, direction) {
  if (editor.isEditable === false) return false;
  if (![1,-1].includes(direction)) throw new Error('Move a caption up or down one block.');
  const item = captionsIn(editor.state.doc).captions.find(item => item.id === id); if (!item) return false;
  const doc = editor.state.doc, index = doc.resolve(item.pos).index(0), neighborIndex = index + direction;
  if (neighborIndex < 0 || neighborIndex >= doc.childCount) return false;
  const neighbor = doc.child(neighborIndex), start = direction < 0 ? item.pos - neighbor.nodeSize : item.pos;
  const nodes = direction < 0 ? [item.node,neighbor] : [neighbor,item.node], pos = direction < 0 ? start : start + neighbor.nodeSize;
  const tr = closeHistory(editor.state.tr).replaceWith(start,start + item.node.nodeSize + neighbor.nodeSize,nodes);
  tr.setSelection(NodeSelection.create(tr.doc,pos)); editor.view.dispatch(tr); return true;
}
export function saveCaptionNumbering(editor, label, rule) {
  if (editor.isEditable === false) return false;
  if (!CAPTION_LABEL.test(label) || !CAPTION_FORMATS.some(([format]) => format === rule.format) || !Number.isInteger(rule.start) || rule.start < 1 || rule.start > 9999) throw new Error('Choose a numbering format and starting number from 1–9,999.');
  const settings = { ...captionSettings(editor.state.doc), [label]: { format: rule.format, start: rule.start } };
  const labels = new Set([...Object.keys(settings), ...captionsIn(editor.state.doc).captions.map(item => item.label)]);
  if (labels.size > 20 || new Set([...labels].map(value => value.toLowerCase())).size !== labels.size) throw new Error('Use up to 20 different caption labels.');
  editor.view.dispatch(closeHistory(editor.state.tr).setDocAttribute('captionSettings', settings)); return true;
}
export function saveCrossReference(editor, attrs, id = null) {
  if (editor.isEditable === false) return false;
  const target = crossReferenceTargets(editor.state.doc).get(attrs.target);
  if (!target) throw new Error('Choose an existing caption, heading or bookmark.');
  if (!['full','labelNumber','number','text'].includes(attrs.display) || (target.kind !== 'caption' && attrs.display !== 'full') || typeof attrs.hyperlink !== 'boolean') throw new Error('Choose a supported reference display.');
  const value = { target: attrs.target, display: attrs.display, hyperlink: attrs.hyperlink }, tr = closeHistory(editor.state.tr), all = captionsIn(tr.doc).references;
  if (id) { const item = all.find(item => item.id === id); if (!item) throw new Error('The cross-reference no longer exists.'); tr.setNodeMarkup(item.pos, undefined, { ...value, id }); }
  else {
    if (all.length >= 1000) throw new Error('A document supports up to 1,000 cross-references.');
    if (!editor.state.selection.$from.parent.isTextblock) throw new Error('Place the cursor in a text paragraph first.');
    const pos = editor.state.selection.to; id = freshReferenceId(); tr.insert(pos, editor.schema.nodes.documentCrossReference.create({ ...value, id })); tr.setSelection(TextSelection.create(tr.doc, pos + 1));
  }
  editor.view.dispatch(tr); return id;
}
export function removeCrossReference(editor, id) {
  if (editor.isEditable === false) return false;
  const item = captionsIn(editor.state.doc).references.find(item => item.id === id); if (!item) return false;
  editor.view.dispatch(closeHistory(editor.state.tr).delete(item.pos, item.pos + 1)); return true;
}
export function normalizeCaptions(state, preferred = new Map()) {
  const tr = state.tr, seen = new Set(), reserved = new Set();
  state.doc.descendants(node => { if (node.type.name === 'bookmark') reserved.add(node.attrs.name?.toLowerCase()); });
  state.doc.descendants((node, pos) => {
    if (!['documentCaption', 'documentCrossReference'].includes(node.type.name)) return;
    const caption = node.type.name === 'documentCaption', pattern = caption ? CAPTION_ID : /^xref-[0-9a-f]{32}$/;
    let id = node.attrs.id;
    if (!pattern.test(id || '') || seen.has(id) || reserved.has(id?.toLowerCase()) || (preferred.has(id) && preferred.get(id) !== pos)) id = caption ? freshId() : freshReferenceId();
    seen.add(id); if (id !== node.attrs.id) tr.setNodeMarkup(pos, undefined, { ...node.attrs, id });
  }); return tr.docChanged ? tr : null;
}
export function captionPlugin() { return new Plugin({
  appendTransaction(transactions, old, state) {
    if (!transactions.some(tr => tr.docChanged)) return null;
    const mapping = new Mapping(), preferred = new Map(); transactions.forEach(tr => mapping.appendMapping(tr.mapping));
    old.doc.descendants((node, pos) => { if (!['documentCaption','documentCrossReference'].includes(node.type.name)) return; const result = mapping.mapResult(pos, 1); if (!result.deleted) preferred.set(node.attrs.id, result.pos); });
    return normalizeCaptions(state, preferred);
  },
  filterTransaction(tr) {
    if (!tr.docChanged) return true; let valid = true;
    tr.doc.descendants((node, _pos, parent) => { if (node.type.name === 'documentCaption' && parent.type.name !== 'doc') valid = false; });
    const { captions, references } = captionsIn(tr.doc), labels = new Set([...Object.keys(captionSettings(tr.doc)), ...captions.map(item => item.label)]);
    return valid && captions.length <= 200 && references.length <= 1000 && labels.size <= 20;
  },
}); }
export const DocumentCaptions = Extension.create({ name: 'documentCaptions',
  addGlobalAttributes: () => [{ types: ['doc'], attributes: { captionSettings: { default: {}, rendered: false } } }],
  addProseMirrorPlugins: () => [captionPlugin()],
});
const open = (editor, kind, id) => editor.view.dom.dispatchEvent(new CustomEvent('document-caption-open', { bubbles: true, detail: { kind, id } }));
export const DocumentCaption = Node.create({ name: 'documentCaption', group: 'block', atom: true, isolating: true,
  addAttributes: () => ({ id: { default: null, rendered: false }, label: { default: 'Figure', rendered: false }, text: { default: '', rendered: false } }),
  renderHTML({ node }) { return ['p', { class: 'de-caption' }, captionContext(this.editor.state.doc).map.get(node.attrs.id)?.full || node.attrs.text]; },
  renderText: () => '',
  addNodeView() { return ({ editor, node }) => {
    const dom = document.createElement('p'), button = document.createElement('button'); dom.className = 'de-caption'; dom.contentEditable = 'false'; button.type = 'button'; dom.append(button); let current = node;
    const render = () => { const caption = captionContext(editor.state.doc).map.get(current.attrs.id); button.textContent = caption?.full || current.attrs.text; button.setAttribute('aria-label', 'Edit caption ' + (caption?.labelNumber || current.attrs.label)); };
    button.addEventListener('mousedown', event => event.preventDefault()); button.addEventListener('click', () => open(editor, 'caption', current.attrs.id)); render(); editor.on('transaction', render);
    return { dom, stopEvent: () => true, ignoreMutation: () => true, update(next) { if (next.type !== current.type) return false; current = next; render(); return true; }, destroy() { editor.off('transaction', render); } };
  }; },
});
export const DocumentCrossReference = Node.create({ name: 'documentCrossReference', group: 'inline', inline: true, atom: true, marks: '',
  addAttributes: () => ({ id: { default: null, rendered: false }, target: { default: '', rendered: false }, display: { default: 'full', rendered: false }, hyperlink: { default: true, rendered: false } }),
  renderHTML({ node }) { const text = crossReferenceText(node.attrs, this.editor.state.doc); return node.attrs.hyperlink ? ['a', { href: '#' + node.attrs.target }, text] : ['span', {}, text]; },
  renderText: () => '',
  addNodeView() { return ({ editor, node }) => {
    const dom = document.createElement('span'), button = document.createElement('button'); dom.contentEditable = 'false'; button.type = 'button'; dom.append(button); let current = node;
    const render = () => { dom.className = 'de-cross-reference' + (current.attrs.hyperlink ? ' is-link' : ''); button.textContent = crossReferenceText(current.attrs, editor.state.doc); button.setAttribute('aria-label', 'Edit cross-reference ' + button.textContent); };
    button.addEventListener('mousedown', event => event.preventDefault()); button.addEventListener('click', event => { if (current.attrs.hyperlink && (event.ctrlKey || event.metaKey || editor.isEditable === false)) goToReference(editor, current.attrs.target); else open(editor, 'reference', current.attrs.id); }); render(); editor.on('transaction', render);
    return { dom, stopEvent: () => true, ignoreMutation: () => true, update(next) { if (next.type !== current.type) return false; current = next; render(); return true; }, destroy() { editor.off('transaction', render); } };
  }; },
});
