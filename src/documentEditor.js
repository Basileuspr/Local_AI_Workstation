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
import { PAGE_DETAIL_DEFAULTS, PAGINATION_OPTIONS } from './documentPageLayout';
import { DocumentTableProperties, DocumentTableView, DocumentTableCell, DocumentTableHeader } from './documentTables';
import { DocumentStyles, DOCUMENT_FONTS } from './documentStyles';
import { DocumentReferences, Bookmark, TableOfContents, safeDocumentLink, normalizeReferences } from './documentReferences';
import { DocumentNotes, DocumentNote, normalizeNotes } from './documentNotes';
import { DocumentCitations, DocumentCitation, DocumentBibliography, normalizeCitations } from './documentCitations';

export { DOCUMENT_FONTS };
export const DEFAULT_PAGE = { paper: 'Letter', orientation: 'portrait', top: 1, bottom: 1, left: 1, right: 1, ...PAGE_DETAIL_DEFAULTS };
export const PAPER_SIZES = { Letter: [8.5, 11], A4: [8.2677, 11.6929], Legal: [8.5, 14] };
export const EMPTY_DOCUMENT = { type: 'doc', content: [{ type: 'paragraph' }] };
export const PLANNED_RIBBONS = {
  Diagram: 'Shapes, connectors, SmartArt, diagram layout and arrangement.',
  Draw: 'Pens, ink, lasso selection, drawing canvas and ink-to-math.',
  Outlining: 'Full outline editing, promote/demote and document restructuring. Heading navigation is available in View.',
  Design: 'Themes, style sets, page colors, watermarks and page borders.',
  Mailings: 'Mail merge, recipients, envelopes and labels.',
  Developer: 'Content controls, XML mapping, templates and document protection. VBA, COM and Word add-ins are not part of this Python editor.',
};

const ParagraphLayout = Extension.create({
  name: 'paragraphLayout',
  addGlobalAttributes() {
    return [{ types: ['paragraph', 'heading'], attributes: {
      ...Object.fromEntries(PAGINATION_OPTIONS.map(([key]) => {
        const attribute = 'data-' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
        return [key, { default: null,
          parseHTML: el => el.hasAttribute(attribute) ? el.getAttribute(attribute) === 'true' : null,
          renderHTML: attrs => attrs[key] === null ? {} : { [attribute]: String(attrs[key]) },
        }];
      })),
      ...Object.fromEntries([['indent', 'margin-left', 'in', .25], ['spaceBefore', 'margin-top', 'pt', 1], ['spaceAfter', 'margin-bottom', 'pt', 1], ['lineSpacing', 'line-height', '', 1]].map(([key, property, unit, scale]) => {
        const attribute = 'data-' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
        return [key, { default: null, parseHTML: el => el.hasAttribute(attribute) ? Number(el.getAttribute(attribute)) : null,
          renderHTML: attrs => attrs[key] == null ? {} : { [attribute]: attrs[key], style: `${property}:${attrs[key] * scale}${unit}` } }];
      })),
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
      isAllowedUri: safeDocumentLink } }),
  TextStyleKit.configure({ backgroundColor: false, lineHeight: false }),
  TextAlign.configure({ types: ['heading', 'paragraph'], defaultAlignment: null }), Highlight.configure({ multicolor: true }),
  LocalImage.configure({ allowBase64: true }), TableKit.configure({ table: { resizable: true, cellMinWidth: 24, View: DocumentTableView }, tableCell: false, tableHeader: false }),
  DocumentTableCell, DocumentTableHeader, DocumentTableProperties,
  Subscript, Superscript, ParagraphLayout, PageBreak, DocumentStyles, DocumentReferences, Bookmark, TableOfContents, DocumentNotes, DocumentNote, DocumentCitations, DocumentCitation, DocumentBibliography];
}

export function resetDocumentContent(editor, content) {
  const previous = editor.state;
  let state = EditorState.create({ schema: previous.schema, doc: previous.schema.nodeFromJSON(content), plugins: previous.plugins });
  const normalized = normalizeReferences(state);
  // Construct the normalized state afresh, keeping import/recovery outside Undo.
  if (normalized) state = EditorState.create({ schema: state.schema, doc: normalized.doc, plugins: previous.plugins });
  const notes = normalizeNotes(state);
  if (notes) state = EditorState.create({ schema: state.schema, doc: notes.doc, plugins: previous.plugins });
  const citations = normalizeCitations(state);
  if (citations) state = EditorState.create({ schema: state.schema, doc: citations.doc, plugins: previous.plugins });
  editor.view.updateState(state);
}

// Paste only the supported formatting. Remote images never enter the document.
export function cleanDocumentPaste(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,svg,math').forEach(el => el.remove());
  doc.querySelectorAll('*').forEach(el => {
    for (const attr of [...el.attributes]) if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    if (el.tagName === 'IMG' && !/^data:image\/(png|jpeg|webp);base64,/.test(el.getAttribute('src') || '')) el.remove();
    if (el.tagName === 'A' && !safeDocumentLink(el.getAttribute('href') || '')) el.removeAttribute('href');
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
    // Point bookmarks have a model position but no text. Map actual character
    // offsets so a bookmark inside a word does not break counts or find results.
    let text = ''; const positions = [];
    node.descendants((child, offset) => {
      const value = child.isText ? child.text : child.type.name === 'hardBreak' ? '\n' : '';
      for (let i = 0; i < value.length; i++) positions.push(pos + 1 + offset + i);
      text += value;
    });
    for (const match of text.matchAll(pattern)) {
      if (matches.length >= 10000) break;
      matches.push({ from: positions[match.index], to: positions[match.index + match[0].length - 1] + 1 });
    }
    return false;
  });
  return matches;
}

export function documentStats(doc) {
  let text = '', paragraphs = 0, pictures = 0;
  doc.descendants(node => {
    if (node.isTextblock) { text += node.textBetween(0, node.content.size, '', leaf => leaf.type.name === 'hardBreak' ? '\n' : '') + '\n'; paragraphs++; }
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
