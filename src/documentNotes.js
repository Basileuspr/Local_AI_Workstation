import { Extension, Node } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { DOCUMENT_FONTS } from './documentStyles';

export const NOTE_FORMATS = [['decimal', '1, 2, 3'], ['lowerRoman', 'i, ii, iii'], ['upperRoman', 'I, II, III'], ['lowerLetter', 'a, b, c'], ['upperLetter', 'A, B, C']];
export const EMPTY_NOTE = { type: 'doc', content: [{ type: 'paragraph' }] };
export const DEFAULT_NOTE_SETTINGS = { footnote: { format: 'decimal', start: 1 }, endnote: { format: 'lowerRoman', start: 1 } };
const newId = () => 'note-' + crypto.randomUUID().replaceAll('-', '');
export function noteSettings(doc) {
  return Object.fromEntries(['footnote', 'endnote'].map(kind => [kind, { ...DEFAULT_NOTE_SETTINGS[kind], ...doc.attrs.noteSettings?.[kind] }]));
}
export function noteNumber(number, format) {
  if (format.endsWith('Letter')) {
    let value = ''; while (number) { number--; value = String.fromCharCode(65 + number % 26) + value; number = Math.floor(number / 26); }
    return format === 'lowerLetter' ? value.toLowerCase() : value;
  }
  if (format.endsWith('Roman')) {
    let value = '';
    for (const [amount, symbol] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]) while (number >= amount) { value += symbol; number -= amount; }
    return format === 'lowerRoman' ? value.toLowerCase() : value;
  }
  return String(number);
}
export function documentNotes(doc) {
  const settings = noteSettings(doc), counts = { footnote: 0, endnote: 0 }, result = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'documentNote') return;
    const { id, kind, body } = node.attrs, ordinal = settings[kind].start + counts[kind]++;
    result.push({ id, kind, body, pos, node, label: noteNumber(ordinal, settings[kind].format), title: kind === 'footnote' ? 'Footnote' : 'Endnote' });
  });
  return result;
}
export function noteBodyError(body) {
  if (!body || body.type !== 'doc' || !Array.isArray(body.content) || !body.content.length || body.content.length > 40) return 'A note needs 1–40 paragraphs.';
  let characters = 0;
  for (const paragraph of body.content) {
    if (!paragraph || paragraph.type !== 'paragraph' || (paragraph.content && !Array.isArray(paragraph.content))) return 'Notes support paragraphs and text formatting.';
    for (const child of paragraph.content || []) {
      if (!child || !['text', 'hardBreak'].includes(child.type) || (child.type === 'text' && typeof child.text !== 'string')) return 'Notes support text and line breaks.';
      if (child.text && /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(child.text)) return 'Unsupported note text characters.';
      characters += child.text?.length || 0;
      if (child.marks && (!Array.isArray(child.marks) || child.marks.length > 10)) return 'Unsupported note formatting.';
      for (const mark of child.marks || []) {
        if (!mark || typeof mark !== 'object' || (mark.attrs && (typeof mark.attrs !== 'object' || Array.isArray(mark.attrs)))) return 'Unsupported note formatting.';
        const attrs = mark.attrs || {};
        if (!['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript', 'textStyle', 'highlight', 'link'].includes(mark.type)) return 'Unsupported note formatting.';
        if (mark.type === 'link' && (typeof attrs.href !== 'string' || attrs.href.length > 2048 || !/^(https?:\/\/|mailto:)[^\s\x00-\x1f<>]+$/i.test(attrs.href))) return 'Note links must use http, https or mailto.';
        if (mark.type === 'textStyle') {
          if (attrs.fontFamily && !DOCUMENT_FONTS.includes(attrs.fontFamily)) return 'Choose a supported note font.';
          if (attrs.fontSize) {
            const match = /^(\d+(?:\.\d+)?)(pt|px)$/.exec(attrs.fontSize), size = match ? Number(match[1]) * (match[2] === 'px' ? .75 : 1) : 0;
            if (size < 6 || size > 96) return 'Note font sizes must be 6–96 points.';
          }
        }
        if (attrs.color) {
          const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(attrs.color);
          if (!/^#[0-9a-f]{6}$/i.test(attrs.color) && !(rgb && rgb.slice(1).every(value => Number(value) <= 255))) return 'Unsupported note color.';
        }
      }
    }
  }
  return characters > 10000 ? 'A note can contain up to 10,000 characters.' : '';
}
function announce(editor, id) { editor.view.dom?.dispatchEvent(new CustomEvent('document-note-open', { bubbles: true, detail: { id } })); }
export function insertNote(editor, kind) {
  if (editor.isEditable === false) return false;
  if (!['footnote', 'endnote'].includes(kind)) throw new Error('Choose a footnote or endnote.');
  if (documentNotes(editor.state.doc).length >= 200) throw new Error('This document already has 200 notes.');
  if (!editor.state.selection.$from.parent.isTextblock) throw new Error('Place the cursor in a text paragraph first.');
  const id = newId(), pos = editor.state.selection.to;
  // Keep selected text and attach the reference after it.
  editor.view.dispatch(closeHistory(editor.state.tr).insert(pos, editor.schema.nodes.documentNote.create({ id, kind, body: structuredClone(EMPTY_NOTE) })));
  editor.view.dispatch(closeHistory(editor.state.tr)); announce(editor, id); return id;
}
export function updateNote(editor, id, body) {
  if (editor.isEditable === false) return false;
  const error = noteBodyError(body); if (error) throw new Error(error);
  const item = documentNotes(editor.state.doc).find(item => item.id === id);
  if (!item) return false;
  if (JSON.stringify(item.body) === JSON.stringify(body)) return true;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(item.pos, undefined, { ...item.node.attrs, body })); return true;
}
export function deleteNote(editor, id) {
  if (editor.isEditable === false) return false;
  const item = documentNotes(editor.state.doc).find(item => item.id === id);
  if (!item) return false;
  editor.view.dispatch(closeHistory(editor.state.tr).delete(item.pos, item.pos + 1)); return true;
}
export function convertNotes(editor, kind, id = null) {
  if (editor.isEditable === false || !['footnote', 'endnote'].includes(kind)) return false;
  const tr = closeHistory(editor.state.tr);
  for (const item of documentNotes(tr.doc)) if ((!id || item.id === id) && item.kind !== kind) tr.setNodeMarkup(item.pos, undefined, { ...item.node.attrs, kind });
  if (tr.docChanged) editor.view.dispatch(tr); return tr.docChanged;
}
export function saveNoteSettings(editor, settings) {
  if (editor.isEditable === false) return false;
  for (const kind of ['footnote', 'endnote']) if (!NOTE_FORMATS.some(([id]) => id === settings[kind]?.format) || !Number.isInteger(settings[kind]?.start) || settings[kind].start < 1 || settings[kind].start > 9999) throw new Error('Choose a supported format and a starting number from 1 to 9999.');
  editor.view.dispatch(closeHistory(editor.state.tr).setDocAttribute('noteSettings', settings)); return true;
}
export function goToNote(editor, id, open = true) {
  const item = documentNotes(editor.state.doc).find(item => item.id === id); if (!item) return false;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(item.pos))).scrollIntoView());
  if (editor.isEditable === false) {
    const $pos = editor.state.doc.resolve(item.pos); editor.view.nodeDOM($pos.before($pos.depth))?.scrollIntoView({ block: 'center', inline: 'nearest' });
  } else editor.commands.focus();
  if (open) announce(editor, id); return true;
}
export function normalizeNotes(state) {
  const tr = state.tr, ids = new Set();
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'documentNote') return;
    let id = node.attrs.id; if (!/^note-[0-9a-f]{32}$/.test(id || '') || ids.has(id)) id = newId();
    ids.add(id); if (id !== node.attrs.id) tr.setNodeMarkup(pos, undefined, { ...node.attrs, id });
  });
  return tr.docChanged ? tr : null;
}
export function notePlugin() { return new Plugin({
  appendTransaction(transactions, _old, state) { return transactions.some(tr => tr.docChanged) ? normalizeNotes(state) : null; },
  filterTransaction(tr) { return !tr.docChanged || documentNotes(tr.doc).length <= 200; },
}); }

export const DocumentNotes = Extension.create({
  name: 'documentNotes', priority: 1000,
  addGlobalAttributes() { return [{ types: ['doc'], attributes: { noteSettings: { default: null, rendered: false } } }]; },
  addProseMirrorPlugins: () => [notePlugin()],
  addKeyboardShortcuts() { return {
    'Mod-z': () => this.editor.isEditable === false,
    'Mod-y': () => this.editor.isEditable === false,
    'Mod-Shift-z': () => this.editor.isEditable === false,
    'Mod-Alt-f': () => { try { return !!insertNote(this.editor, 'footnote'); } catch { return true; } },
    'Mod-Alt-d': () => { try { return !!insertNote(this.editor, 'endnote'); } catch { return true; } },
  }; },
});
export const DocumentNote = Node.create({
  name: 'documentNote', group: 'inline', inline: true, atom: true, selectable: true, marks: '',
  addAttributes: () => ({ id: { default: null, rendered: false }, kind: { default: 'footnote', rendered: false }, body: { default: EMPTY_NOTE, rendered: false } }),
  parseHTML: () => [{ tag: 'sup[data-document-note]', getAttrs: element => {
    try {
      const raw = element.getAttribute('data-note-body') || ''; if (raw.length > 200000) return false;
      const body = JSON.parse(raw), kind = element.getAttribute('data-note-kind');
      return !noteBodyError(body) && ['footnote', 'endnote'].includes(kind) ? { id: newId(), kind, body } : false;
    } catch { return false; }
  } }],
  renderHTML: ({ node }) => ['sup', { 'data-document-note': node.attrs.id, 'data-note-kind': node.attrs.kind, 'data-note-body': JSON.stringify(node.attrs.body), class: 'de-note-marker' }, '*'],
  renderText: () => '',
  addNodeView() { return ({ editor, node }) => {
    const dom = document.createElement('sup'), button = document.createElement('button'); dom.className = 'de-note-marker'; dom.contentEditable = 'false'; button.type = 'button'; dom.append(button);
    let current = node;
    const render = () => { const item = documentNotes(editor.state.doc).find(item => item.id === current.attrs.id); button.textContent = item?.label || '*'; button.setAttribute('aria-label', `Edit ${current.attrs.kind} ${item?.label || ''}`); dom.dataset.documentNote = current.attrs.id; };
    button.addEventListener('mousedown', event => event.preventDefault()); button.addEventListener('click', () => announce(editor, current.attrs.id));
    render(); editor.on('transaction', render);
    return { dom, stopEvent: () => true, ignoreMutation: () => true, update(next) { if (next.type !== current.type) return false; current = next; render(); return true; }, destroy() { editor.off('transaction', render); } };
  }; },
});

export function noteEditorExtensions(parent) {
  return [StarterKit.configure({ undoRedo: false, heading: false, bulletList: false, orderedList: false, listItem: false, blockquote: false, code: false, codeBlock: false, horizontalRule: false,
    link: { openOnClick: false, autolink: false, linkOnPaste: false, isAllowedUri: url => /^(https?:\/\/|mailto:)[^\s\x00-\x1f<>]+$/i.test(url) } }),
    TextStyleKit.configure({ backgroundColor: false, lineHeight: false }), Highlight.configure({ multicolor: true }), Subscript, Superscript,
    TextAlign.configure({ types: ['paragraph'], defaultAlignment: null }), Extension.create({ name: 'noteEditing',
      addKeyboardShortcuts: () => ({ 'Mod-z': () => parent?.isEditable !== false && parent?.commands.undo() || true, 'Mod-y': () => parent?.isEditable !== false && parent?.commands.redo() || true, 'Mod-Shift-z': () => parent?.isEditable !== false && parent?.commands.redo() || true }),
      addProseMirrorPlugins: () => [new Plugin({ filterTransaction: tr => !tr.docChanged || !noteBodyError(tr.doc.toJSON()) })],
    })];
}
