import { Extension, Node, getMarkRange } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';
import { paragraphStyle } from './documentStyles';
import { captionContext, CAPTION_ID } from './documentCaptions';

export const BOOKMARK_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const HEADING_ID = /^LAW_H[0-9a-f]{32}$/;
export const safeDocumentLink = value => typeof value === 'string' && value.length <= 2048 &&
  (/^(https?:\/\/|mailto:)[^\s\x00-\x1f<>]+$/i.test(value) || (value.startsWith('#') && BOOKMARK_NAME.test(value.slice(1))));
const freshHeadingId = () => 'LAW_H' + crypto.randomUUID().replaceAll('-', '');

export function documentReferences(doc) {
  const headings = [], bookmarks = [], targets = new Map(), links = [];
  let toc = null;
  doc.descendants((node, pos) => {
    if (['paragraph', 'heading'].includes(node.type.name)) {
      const level = paragraphStyle(doc, node).level;
      const item = { name: node.attrs.referenceId, text: node.textContent || 'Untitled heading', level, pos: pos + 1 };
      if (item.name) targets.set(item.name, item);
      if (level) headings.push(item);
    }
    if (node.type.name === 'bookmark') {
      const item = { name: node.attrs.name, text: node.attrs.name, pos, node };
      bookmarks.push(item); targets.set(item.name, item);
    }
    if (node.type.name === 'tableOfContents') toc = { node, pos };
    if (node.isText) {
      const href = node.marks.find(mark => mark.type.name === 'link')?.attrs.href;
      if (href?.startsWith('#')) {
        const previous = links.at(-1);
        if (previous?.href === href && previous.pos + previous.size === pos) { previous.text += node.text; previous.size += node.nodeSize; }
        else links.push({ href, text: node.text, pos, size: node.nodeSize });
      }
    }
  });
  for (const item of captionContext(doc).captions) targets.set(item.id, { name: item.id, text: item.full, pos: item.pos });
  return { headings, bookmarks, targets, toc, links, broken: links.filter(link => !targets.has(link.href.slice(1))) };
}

// IDs live in the document so typing, restyling and moving a heading keep its links.
// A pasted/split copy gets a new ID; links already in the document keep the original.
export function normalizeReferences(state, preferred = new Map()) {
  const tr = state.tr, seen = new Set();
  const reserved = new Set(), originals = new Map();
  state.doc.descendants((node, pos) => {
    const name = node.type.name === 'bookmark' ? node.attrs.name : node.attrs.referenceId;
    if (name) {
      const key = name.toLowerCase(); reserved.add(key);
      if (!originals.has(key) || preferred.get(key) === pos) originals.set(key, pos);
    }
  });
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'bookmark') {
      let name = node.attrs.name;
      if (!BOOKMARK_NAME.test(name || '') || HEADING_ID.test(name)) name = 'Bookmark';
      if (seen.has(name.toLowerCase()) || (originals.has(name.toLowerCase()) && originals.get(name.toLowerCase()) !== pos)) {
        let index = 2, candidate;
        do { candidate = `${name.slice(0, 32)}_${index++}`; } while (reserved.has(candidate.toLowerCase()));
        name = candidate;
      }
      reserved.add(name.toLowerCase()); seen.add(name.toLowerCase());
      if (name !== node.attrs.name) tr.setNodeMarkup(pos, undefined, { ...node.attrs, name });
    } else if (['paragraph', 'heading'].includes(node.type.name)) {
      let id = node.attrs.referenceId;
      if (!id && !paragraphStyle(state.doc, node).level) return;
      if (!HEADING_ID.test(id || '') || seen.has(id.toLowerCase()) || originals.get(id.toLowerCase()) !== pos) id = freshHeadingId();
      seen.add(id.toLowerCase());
      if (id !== node.attrs.referenceId) tr.setNodeMarkup(pos, undefined, { ...node.attrs, referenceId: id });
    }
  });
  return tr.docChanged ? tr : null;
}

export function referencePlugin() {
  return new Plugin({
    appendTransaction(transactions, old, state) {
      if (!transactions.some(tr => tr.docChanged)) return null;
      const preferred = new Map(), mapping = new Mapping();
      transactions.forEach(tr => mapping.appendMapping(tr.mapping));
      old.doc.descendants((node, pos) => {
        const name = node.type.name === 'bookmark' ? node.attrs.name : node.attrs.referenceId;
        if (!name) return;
        const result = mapping.mapResult(pos, 1);
        if (!result.deleted) preferred.set(name.toLowerCase(), result.pos);
      });
      return normalizeReferences(state, preferred);
    },
    filterTransaction(tr) {
      if (!tr.docChanged) return true;
      let bookmarks = 0, contents = 0, valid = true;
      tr.doc.descendants((node, _pos, parent) => {
        if (node.type.name === 'bookmark') bookmarks++;
        if (node.type.name === 'tableOfContents') { contents++; if (parent.type.name !== 'doc') valid = false; }
      });
      return valid && bookmarks <= 100 && contents <= 1;
    },
  });
}

export function goToReference(editor, name) {
  const target = documentReferences(editor.state.doc).targets.get(name);
  if (!target) return false;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(target.pos))).scrollIntoView());
  if (editor.isEditable === false) {
    // ProseMirror does not own the browser selection in a read-only view.
    // Scroll the actual destination block rather than a stale browser caret.
    const $pos = editor.state.doc.resolve(target.pos);
    editor.view.nodeDOM?.($pos.depth ? $pos.before($pos.depth) : target.pos)?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  } else editor.commands.focus();
  return true;
}

export function bookmarkError(name, doc, previous = '') {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name) || HEADING_ID.test(name) || CAPTION_ID.test(name)) return 'Use 1–40 letters, numbers or underscores, starting with a letter. This name must not be a reserved heading or caption ID.';
  const { bookmarks, targets } = documentReferences(doc);
  if ([...targets.keys()].some(key => key !== previous && key.toLowerCase() === name.toLowerCase())) return 'A bookmark with this name already exists.';
  if (!previous && bookmarks.length >= 100) return 'This document already has 100 bookmarks.';
  return '';
}
export function saveBookmark(editor, name, previous = '') {
  if (editor.isEditable === false) return false;
  const error = bookmarkError(name, editor.state.doc, previous);
  if (error) throw new Error(error);
  const tr = editor.state.tr, refs = documentReferences(tr.doc);
  if (previous) {
    const item = refs.bookmarks.find(bookmark => bookmark.name === previous);
    if (!item) throw new Error('The bookmark no longer exists.');
    tr.setNodeMarkup(item.pos, undefined, { name });
    for (const link of refs.links.filter(link => link.href === '#' + previous)) {
      const mark = tr.doc.nodeAt(link.pos).marks.find(mark => mark.type.name === 'link');
      tr.addMark(link.pos, link.pos + link.size, editor.schema.marks.link.create({ ...mark.attrs, href: '#' + name }));
    }
    tr.doc.descendants((node, pos) => { if (node.type.name === 'documentCrossReference' && node.attrs.target === previous) tr.setNodeMarkup(pos, undefined, { ...node.attrs, target: name }); });
  } else {
    if (!editor.state.selection.$from.parent.isTextblock) throw new Error('Place the cursor in a text paragraph first.');
    // Do not replace selected text when adding a point bookmark.
    tr.insert(editor.state.selection.from, editor.schema.nodes.bookmark.create({ name }));
  }
  editor.view.dispatch(tr); return true;
}
export function removeBookmark(editor, name) {
  if (editor.isEditable === false) return false;
  const item = documentReferences(editor.state.doc).bookmarks.find(item => item.name === name);
  if (!item) return false;
  editor.view.dispatch(editor.state.tr.delete(item.pos, item.pos + 1)); return true;
}

export function setDocumentLink(editor, href, label = '') {
  if (editor.isEditable === false) return false;
  href = href.trim();
  if (!safeDocumentLink(href)) throw new Error('Use an https://, http:// or mailto: address, or select a document destination.');
  const refs = documentReferences(editor.state.doc), destination = refs.targets.get(href.slice(1));
  if (href.startsWith('#') && !destination) throw new Error('This destination is missing. Choose another heading or bookmark.');
  const tr = editor.state.tr, type = editor.schema.marks.link, { selection } = editor.state;
  let { from, to } = selection;
  if (selection.empty) {
    const existing = getMarkRange(selection.$from, type);
    if (existing) ({ from, to } = existing);
    else {
      if (!selection.$from.parent.isTextblock) throw new Error('Place the cursor in a text paragraph first.');
      const text = label.trim() || (href.startsWith('#') ? destination.text : href);
      tr.insertText(text, from); to = from + text.length;
    }
  }
  tr.addMark(from, to, type.create({ href }));
  tr.removeStoredMark(type);
  editor.view.dispatch(tr); editor.commands.focus(); return true;
}

export function saveContents(editor, attrs) {
  if (editor.isEditable === false) return false;
  if (!attrs.title?.trim() || attrs.title.length > 100 || /[\x00-\x1f]/.test(attrs.title) || ![1, 2, 3].includes(attrs.maxLevel)) throw new Error('Enter a contents title of 1–100 characters and choose heading levels 1–3.');
  const { toc } = documentReferences(editor.state.doc), tr = editor.state.tr;
  const node = editor.schema.nodes.tableOfContents.create({ ...attrs, title: attrs.title.trim() });
  if (toc) tr.setNodeMarkup(toc.pos, undefined, node.attrs);
  else {
    const { $from } = editor.state.selection;
    // Contents always lives in the document body, outside lists and tables.
    const pos = $from.depth ? ($from.parentOffset === 0 ? $from.before(1) : $from.after(1)) : $from.pos;
    tr.insert(pos, node);
  }
  editor.view.dispatch(tr); return true;
}
export function removeContents(editor) {
  if (editor.isEditable === false) return false;
  const { toc } = documentReferences(editor.state.doc);
  if (!toc) return false;
  editor.view.dispatch(editor.state.tr.delete(toc.pos, toc.pos + toc.node.nodeSize)); return true;
}

export const DocumentReferences = Extension.create({
  name: 'documentReferences',
  addGlobalAttributes() { return [{ types: ['paragraph', 'heading'], attributes: {
    referenceId: { default: null, parseHTML: () => null, renderHTML: attrs => attrs.referenceId ? { id: attrs.referenceId } : {} },
  } }]; },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [referencePlugin(), new Plugin({ props: { handleDOMEvents: { click(_view, event) {
      const href = event.target.closest?.('a')?.getAttribute('href');
      if (!href?.startsWith('#')) return false;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey || !editor.isEditable) { goToReference(editor, href.slice(1)); return true; }
      return false;
    } } } })];
  },
});

export const Bookmark = Node.create({
  name: 'bookmark', group: 'inline', inline: true, atom: true, selectable: true, marks: '',
  addAttributes() { return { name: { default: 'Bookmark', parseHTML: element => element.getAttribute('data-bookmark') } }; },
  parseHTML: () => [{ tag: 'span[data-bookmark]' }],
  renderHTML: ({ node }) => ['span', { 'data-bookmark': node.attrs.name, class: 'de-bookmark', contenteditable: 'false', title: `Bookmark: ${node.attrs.name}`, 'aria-label': `Bookmark: ${node.attrs.name}` }, '⌑'],
  renderText: () => '',
});

export const TableOfContents = Node.create({
  name: 'tableOfContents', group: 'block', atom: true, selectable: true, isolating: true,
  addAttributes: () => ({ title: { default: 'Contents' }, maxLevel: { default: 3 } }),
  // Clipboard HTML becomes ordinary text. Only document/recovery JSON carries live contents.
  renderHTML: ({ node }) => ['div', { 'data-table-of-contents': '', class: 'de-toc' }, node.attrs.title],
  addNodeView() { return ({ editor, node }) => {
    const dom = document.createElement('section'); dom.className = 'de-toc'; dom.contentEditable = 'false'; dom.setAttribute('aria-label', 'Table of contents');
    let current = node, last = '';
    const render = () => {
      const headings = documentReferences(editor.state.doc).headings.filter(item => item.level <= current.attrs.maxLevel);
      const signature = JSON.stringify([current.attrs, headings]);
      if (signature === last) return; last = signature;
      const title = document.createElement('h2'); title.textContent = current.attrs.title;
      const hint = document.createElement('small'); hint.textContent = 'Updates with headings · click an entry to jump';
      const list = document.createElement('div'); list.className = 'de-toc-entries';
      for (const item of headings) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = item.text;
        button.style.paddingLeft = `${(item.level - 1) * 18}px`;
        button.addEventListener('mousedown', event => event.preventDefault());
        button.addEventListener('click', () => goToReference(editor, item.name)); list.append(button);
      }
      if (!headings.length) { const empty = document.createElement('p'); empty.textContent = 'Apply Heading 1–3 or a custom heading style to add entries.'; list.append(empty); }
      dom.replaceChildren(title, hint, list);
    };
    render(); editor.on('transaction', render);
    return { dom, stopEvent: event => !!event.target.closest?.('button'), ignoreMutation: () => true,
      update(next) { if (next.type !== current.type) return false; current = next; render(); return true; },
      destroy() { editor.off('transaction', render); } };
  }; },
});
