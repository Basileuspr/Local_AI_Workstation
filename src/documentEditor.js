import { Extension, Node, mergeAttributes } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';

export const DOCUMENT_FONTS = ['Aptos', 'Arial', 'Calibri', 'Cambria', 'Comic Sans MS', 'Consolas', 'Courier New', 'Georgia', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
export const DEFAULT_PAGE = { paper: 'Letter', orientation: 'portrait', top: 1, bottom: 1, left: 1, right: 1 };
export const PAPER_SIZES = { Letter: [8.5, 11], A4: [8.2677, 11.6929], Legal: [8.5, 14] };
export const EMPTY_DOCUMENT = { type: 'doc', content: [{ type: 'paragraph' }] };
export const PLANNED_RIBBONS = {
  Diagram: 'Shapes, connectors, SmartArt, diagram layout and arrangement.',
  Draw: 'Pens, ink, lasso selection, drawing canvas and ink-to-math.',
  Outlining: 'Full outline editing, promote/demote and document restructuring. Heading navigation is available in View.',
  Design: 'Themes, style sets, page colors, watermarks and page borders.',
  References: 'Table of contents, footnotes, endnotes, citations, bibliography, captions, index and cross-references.',
  Mailings: 'Mail merge, recipients, envelopes and labels.',
  Developer: 'Content controls, XML mapping, templates and document protection. VBA, COM and Word add-ins are not part of this Python editor.',
};

const ParagraphLayout = Extension.create({
  name: 'paragraphLayout',
  addGlobalAttributes() {
    return [{ types: ['paragraph', 'heading'], attributes: {
      indent: { default: 0, parseHTML: el => Number(el.dataset.indent) || 0,
        renderHTML: attrs => ({ 'data-indent': attrs.indent, style: `margin-left: ${attrs.indent * 0.25}in` }) },
      spaceBefore: { default: 0, parseHTML: el => Number(el.dataset.spaceBefore) || 0,
        renderHTML: attrs => ({ 'data-space-before': attrs.spaceBefore, style: `margin-top: ${attrs.spaceBefore}pt` }) },
      spaceAfter: { default: 8, parseHTML: el => el.dataset.spaceAfter === undefined ? 8 : Number(el.dataset.spaceAfter),
        renderHTML: attrs => ({ 'data-space-after': attrs.spaceAfter, style: `margin-bottom: ${attrs.spaceAfter}pt` }) },
      lineSpacing: { default: 1.15, parseHTML: el => Number(el.dataset.lineSpacing) || 1.15,
        renderHTML: attrs => ({ 'data-line-spacing': attrs.lineSpacing, style: `line-height: ${attrs.lineSpacing}` }) },
    } }];
  },
});

const PageBreak = Node.create({
  name: 'pageBreak', group: 'block', atom: true, selectable: true,
  parseHTML: () => [{ tag: 'div[data-page-break]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': '', class: 'de-page-break', contenteditable: 'false' }), 'Page break'],
});
const LocalImage = Image.extend({
  addAttributes() { return { ...this.parent?.(), width: { default: 480, parseHTML: el => Number(el.getAttribute('width')) || 480 } }; },
  parseHTML() { return [{ tag: 'img[src^="data:image/"]', getAttrs: el => /^data:image\/(png|jpeg|webp);base64,/.test(el.getAttribute('src') || '') ? null : false }]; },
});

export function documentExtensions() {
  return [StarterKit.configure({ heading: { levels: [1, 2, 3] }, blockquote: false, code: false, codeBlock: false, horizontalRule: false,
    link: { openOnClick: false, autolink: false, linkOnPaste: false, protocols: ['http', 'https', 'mailto'],
      isAllowedUri: url => /^(https?:\/\/|mailto:)[^\s<>]+$/i.test(url) } }),
  TextStyleKit.configure({ backgroundColor: false, lineHeight: false }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }), Highlight.configure({ multicolor: true }),
  LocalImage.configure({ allowBase64: true }), TableKit.configure({ table: { resizable: false } }),
  Subscript, Superscript, ParagraphLayout, PageBreak];
}

export function resetDocumentContent(editor, content) {
  const previous = editor.state;
  editor.view.updateState(EditorState.create({ schema: previous.schema,
    doc: previous.schema.nodeFromJSON(content), plugins: previous.plugins }));
}

// Paste only the supported formatting. Remote images never enter the document.
export function cleanDocumentPaste(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,svg,math').forEach(el => el.remove());
  doc.querySelectorAll('*').forEach(el => {
    for (const attr of [...el.attributes]) if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    if (el.tagName === 'IMG' && !/^data:image\/(png|jpeg|webp);base64,/.test(el.getAttribute('src') || '')) el.remove();
    if (el.tagName === 'A' && !/^(https?:\/\/|mailto:)[^\s<>]+$/i.test(el.getAttribute('href') || '')) el.removeAttribute('href');
    if (el.style.fontFamily && !DOCUMENT_FONTS.includes(el.style.fontFamily.replaceAll('"', '').replaceAll("'", ''))) el.style.fontFamily = '';
    if (el.style.fontSize) {
      const match = el.style.fontSize.match(/^(\d+(?:\.\d+)?)(px|pt)$/);
      const pt = match ? Number(match[1]) * (match[2] === 'px' ? .75 : 1) : 12;
      el.style.fontSize = `${Math.min(96, Math.max(6, pt))}pt`;
    }
  });
  return doc.body.innerHTML;
}

export function documentMatches(doc, query, matchCase = false) {
  if (!query || query.length > 1000) return [];
  const matches = [], pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'gu' : 'giu');
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    // leafText occupies one position, preserving offsets across hard breaks.
    const text = node.textBetween(0, node.content.size, '', '\n');
    for (const match of text.matchAll(pattern)) {
      if (matches.length >= 10000) break;
      matches.push({ from: pos + 1 + match.index, to: pos + 1 + match.index + match[0].length });
    }
    return false;
  });
  return matches;
}

export function documentStats(doc) {
  let text = '', paragraphs = 0, pictures = 0;
  doc.descendants(node => {
    if (node.isTextblock) { text += node.textBetween(0, node.content.size, '', '\n') + '\n'; paragraphs++; }
    if (node.type.name === 'image') pictures++;
  });
  return { words: text.trim() ? text.trim().split(/\s+/u).length : 0, characters: text.replace(/\n$/, '').length, paragraphs, pictures };
}

export function pageDimensions(layout) {
  const dims = PAPER_SIZES[layout.paper] || PAPER_SIZES.Letter;
  return layout.orientation === 'landscape' ? [dims[1], dims[0]] : dims;
}

const DB_NAME = 'law-document-editor-v1';
async function draftDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
let draftQueue = Promise.resolve();
export function editorDraft(operation, value) {
  const next = draftQueue.then(() => draftOperation(operation, value));
  draftQueue = next.catch(() => {});
  return next;
}
async function draftOperation(operation, value) {
  const db = await draftDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('drafts', operation === 'get' ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('drafts');
      const request = operation === 'get' ? store.get('current') : operation === 'put' ? store.put(value, 'current') : store.delete('current');
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Draft storage was interrupted.'));
    });
  } finally { db.close(); }
}
