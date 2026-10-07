import { Extension, Node } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';

export const CITATION_STYLES = [['apa', 'APA author–date (basic)'], ['numeric', 'Numbered']];
export const SOURCE_TYPES = [['book', 'Book'], ['article', 'Journal article'], ['website', 'Website']];
export const SOURCE_FIELDS = { title: 500, year: 4, publisher: 200, journal: 200, volume: 40, issue: 40, pages: 80, siteName: 200, url: 2048, doi: 200, edition: 80 };
export const newSourceId = () => 'LAW_S' + crypto.randomUUID().replaceAll('-', '');
const newCitationId = () => 'cite-' + crypto.randomUUID().replaceAll('-', '');
export const emptySource = () => ({ id: newSourceId(), type: 'book', authors: [], ...Object.fromEntries(Object.keys(SOURCE_FIELDS).map(key => [key, ''])) });
export const printable = (value, max) => typeof value === 'string' && value.length <= max && !/[\x00-\x1f\ud800-\udfff]/u.test(value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''));
export function sourceError(source) {
  if (!source || !/^LAW_S[0-9a-f]{32}$/.test(source.id || '') || !SOURCE_TYPES.some(([id]) => id === source.type)) return 'Invalid source ID or type.';
  for (const [key, max] of Object.entries(SOURCE_FIELDS)) if (!printable(source[key] ?? '', max)) return `${key} is too long or contains unsupported characters.`;
  if (!source.title?.trim()) return 'Enter a source title.';
  if (source.year && !/^[0-9]{4}$/.test(source.year)) return 'Enter a four-digit year, or leave it blank.';
  if (source.url && !/^https?:\/\/[^\s<>]+$/i.test(source.url)) return 'Source URLs must use http or https.';
  if (source.doi && !/^10\.\d{4,9}\/[^\s<>]+$/.test(source.doi)) return 'Enter a DOI such as 10.1234/example, without the URL prefix.';
  if (!Array.isArray(source.authors) || source.authors.length > 20) return 'Use up to 20 authors.';
  for (const author of source.authors) {
    if (!author || typeof author !== 'object' || !['family', 'given', 'literal'].every(key => printable(author[key] ?? '', 120))) return 'Invalid author name.';
    if (!(author.literal || author.family)?.trim() || (author.literal && (author.family || author.given))) return 'Enter a family name or an organization name for each author.';
  }
  return '';
}
export function canonicalSource(source) {
  const error = sourceError(source); if (error) throw new Error(error);
  return { id: source.id, type: source.type, authors: source.authors.map(author => author.literal ? { literal: author.literal.trim() } : { family: author.family.trim(), given: (author.given || '').trim() }), ...Object.fromEntries(Object.keys(SOURCE_FIELDS).map(key => [key, (source[key] || '').trim()])) };
}
export const sourceCatalog = doc => doc.attrs.sources || [];
export const citationStyle = doc => doc.attrs.citationStyle || 'apa';
export function citationsIn(doc) {
  const citations = []; let bibliography = null;
  doc.descendants((node, pos) => {
    if (node.type.name === 'documentCitation') citations.push({ node, pos, ...node.attrs });
    if (node.type.name === 'documentBibliography') bibliography = { node, pos, ...node.attrs };
  });
  return { citations, bibliography };
}
const authorName = author => author.literal || author.family;
const initials = given => (given.match(/[\p{L}\p{N}]+/gu) || []).map(word => [...word][0].toUpperCase() + '.').join(' ');
export function sourceAuthors(source, reference = false, narrative = false) {
  const names = source.authors.map(author => reference ? author.literal || `${author.family}${author.given ? ', ' + initials(author.given) : ''}` : authorName(author));
  if (!names.length) return source.title;
  if (!reference && names.length >= 3) return names[0] + ' et al.';
  if (names.length === 1) return names[0];
  return names.slice(0, -1).join(', ') + (reference ? ', & ' : narrative ? ' and ' : ' & ') + names.at(-1);
}
const sortKey = source => [source.authors.map(author => [authorName(author), author.given || ''].join(',')).join(';') || source.title, source.year || '', source.title].join('|').toLowerCase();
// Match Python's Unicode scalar ordering, including supplementary characters.
const compare = (a, b) => {
  const left = [...a], right = [...b];
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const difference = left[index].codePointAt(0) - right[index].codePointAt(0); if (difference) return difference;
  }
  return left.length - right.length;
};
const contextCache = new WeakMap();
export function citationContext(doc) {
  if (contextCache.has(doc)) return contextCache.get(doc);
  const sources = [...sourceCatalog(doc)].sort((a, b) => compare(sortKey(a), sortKey(b)) || compare(a.id, b.id));
  const map = new Map(sources.map(source => [source.id, source])), years = new Map(), groups = new Map(), numbers = new Map();
  const used = new Set(citationsIn(doc).citations.flatMap(item => item.sourceIds));
  const includeAll = citationsIn(doc).bibliography?.includeUncited;
  for (const source of sources.filter(source => includeAll || used.has(source.id))) {
    const key = JSON.stringify([source.authors, source.year]);
    if (source.authors.length) groups.set(key, [...(groups.get(key) || []), source]);
  }
  for (const group of groups.values()) group.forEach((source, index) => {
    let ordinal = index + 1, suffix = ''; while (ordinal) { ordinal--; suffix = String.fromCharCode(97 + ordinal % 26) + suffix; ordinal = Math.floor(ordinal / 26); }
    years.set(source.id, (source.year || 'n.d.') + (group.length > 1 ? (source.year ? '' : '-') + suffix : ''));
  });
  for (const item of citationsIn(doc).citations) for (const id of item.sourceIds) if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
  for (const source of sources) if (!numbers.has(source.id)) numbers.set(source.id, numbers.size + 1);
  const result = { sources, map, years, numbers, style: citationStyle(doc) }; contextCache.set(doc, result); return result;
}
export function citationLabel(attrs, context) {
  const items = attrs.sourceIds.map(id => ({ id, source: context.map.get(id) }));
  const locator = attrs.locator ? ', ' + attrs.locator : '';
  let label;
  if (context.style === 'numeric') label = '[' + items.map(({ id, source }) => source ? context.numbers.get(id) : 'Missing source').join(', ') + locator + ']';
  else {
    const values = items.map(({ id, source }) => source ? [sourceAuthors(source, false, attrs.mode === 'narrative'), context.years.get(id) || source.year || 'n.d.'] : ['Missing source', '']);
    label = attrs.mode === 'narrative' && values.length === 1 ? values[0][0] + ' (' + values[0][1] + locator + ')' : '(' + values.map(value => value.filter(Boolean).join(', ')).join('; ') + locator + ')';
  }
  return (attrs.prefix ? attrs.prefix + ' ' : '') + label + (attrs.suffix ? ' ' + attrs.suffix : '');
}
export function bibliographyEntries(doc, includeUncited = false) {
  const context = citationContext(doc), used = new Set(citationsIn(doc).citations.flatMap(item => item.sourceIds));
  let sources = context.sources.filter(source => includeUncited || used.has(source.id));
  if (context.style === 'numeric') sources.sort((a, b) => context.numbers.get(a.id) - context.numbers.get(b.id));
  return sources.map(source => {
    const parts = [], add = (text, italic = false, href = null) => { if (text) parts.push({ text, italic, href }); };
    const names = source.authors.length ? sourceAuthors(source, true) : '';
    const authors = names ? names + (names.endsWith('.') ? ' ' : '. ') : '';
    if (context.style === 'numeric') add('[' + context.numbers.get(source.id) + '] ');
    add(authors);
    const year = context.years.get(source.id) || source.year || 'n.d.';
    if (context.style === 'apa' && authors) add('(' + year + '). ');
    add(source.title, source.type !== 'article'); add('. ');
    if (context.style === 'apa' && !authors) add('(' + year + '). ');
    if (source.type === 'book') { if (source.edition) add('(' + source.edition + '). '); if (source.publisher) add(source.publisher + '. '); }
    if (source.type === 'article') {
      add(source.journal, true); if (source.volume) { add(', '); add(source.volume, true); }
      if (source.issue) add('(' + source.issue + ')'); if (source.pages) add(', ' + source.pages); if (source.journal || source.volume || source.pages) add('. ');
    }
    if (source.type === 'website' && source.siteName && source.siteName !== source.authors[0]?.literal) add(source.siteName + '. ');
    if (context.style === 'numeric') add(year + '. ');
    const href = source.doi ? 'https://doi.org/' + source.doi : source.url;
    if (href) add(href, false, href);
    else if (parts.length) parts.at(-1).text = parts.at(-1).text.trimEnd();
    return { source, parts };
  });
}
export function citationError(attrs) {
  if (!attrs || !Array.isArray(attrs.sourceIds) || !attrs.sourceIds.length || attrs.sourceIds.length > 10 || new Set(attrs.sourceIds).size !== attrs.sourceIds.length || attrs.sourceIds.some(id => !/^LAW_S[0-9a-f]{32}$/.test(id))) return 'Choose 1–10 different sources.';
  if (!['parenthetical', 'narrative'].includes(attrs.mode)) return 'Choose a citation display mode.';
  for (const key of ['locator', 'prefix', 'suffix']) if (!printable(attrs[key] ?? '', 120)) return 'Citation details support up to 120 printable characters.';
  return '';
}
export function saveSource(editor, source) {
  if (editor.isEditable === false) return false;
  const value = canonicalSource(source), sources = [...sourceCatalog(editor.state.doc)], index = sources.findIndex(item => item.id === value.id);
  if (index < 0) { if (sources.length >= 100) throw new Error('This document already has 100 sources.'); sources.push(value); } else sources[index] = value;
  editor.view.dispatch(closeHistory(editor.state.tr).setDocAttribute('sources', sources)); return value.id;
}
export function removeSource(editor, id) {
  if (editor.isEditable === false) return false;
  if (citationsIn(editor.state.doc).citations.some(item => item.sourceIds.includes(id))) throw new Error('This source is cited. Remove or retarget its citations before deleting it.');
  editor.view.dispatch(closeHistory(editor.state.tr).setDocAttribute('sources', sourceCatalog(editor.state.doc).filter(source => source.id !== id))); return true;
}
export function importSources(editor, value) {
  if (editor.isEditable === false) return false;
  if (!value || value.version !== 1 || !Array.isArray(value.sources) || value.sources.length > 100) throw new Error('Open a version 1 source list with up to 100 sources.');
  const incoming = value.sources.map(canonicalSource), sources = [...sourceCatalog(editor.state.doc)];
  for (const source of incoming) {
    const existing = sources.find(item => item.id === source.id);
    if (existing && JSON.stringify(canonicalSource(existing)) === JSON.stringify(source)) continue;
    if (existing) source.id = newSourceId();
    sources.push(source);
  }
  if (sources.length > 100) throw new Error('The combined list would exceed 100 sources.');
  editor.view.dispatch(closeHistory(editor.state.tr).setDocAttribute('sources', sources)); return sources.length;
}
export function saveCitation(editor, attrs, id = null) {
  if (editor.isEditable === false) return false;
  const error = citationError(attrs); if (error) throw new Error(error);
  if (attrs.sourceIds.some(sourceId => !sourceCatalog(editor.state.doc).some(source => source.id === sourceId))) throw new Error('Choose sources from this document.');
  const tr = closeHistory(editor.state.tr), list = citationsIn(tr.doc).citations;
  if (id) { const item = list.find(item => item.id === id); if (!item) throw new Error('The citation no longer exists.'); tr.setNodeMarkup(item.pos, undefined, { ...attrs, id }); }
  else {
    if (list.length >= 1000) throw new Error('This document already has 1,000 citations.');
    if (!editor.state.selection.$from.parent.isTextblock) throw new Error('Place the cursor in a text paragraph first.');
    const pos = editor.state.selection.to;
    id = newCitationId(); tr.insert(pos, editor.schema.nodes.documentCitation.create({ ...attrs, id }));
    tr.setSelection(TextSelection.create(tr.doc, pos + 1));
  }
  editor.view.dispatch(tr); return id;
}
export function removeCitation(editor, id) {
  if (editor.isEditable === false) return false;
  const item = citationsIn(editor.state.doc).citations.find(item => item.id === id); if (!item) return false;
  editor.view.dispatch(closeHistory(editor.state.tr).delete(item.pos, item.pos + 1)); return true;
}
export function setCitationStyle(editor, style) {
  if (editor.isEditable === false || !CITATION_STYLES.some(([id]) => id === style)) return false;
  editor.view.dispatch(closeHistory(editor.state.tr).setDocAttribute('citationStyle', style)); return true;
}
export function saveBibliography(editor, attrs) {
  if (editor.isEditable === false) return false;
  if (!printable(attrs.title, 100) || !attrs.title.trim() || typeof attrs.includeUncited !== 'boolean') throw new Error('Enter a bibliography title of 1–100 characters.');
  const { bibliography } = citationsIn(editor.state.doc), tr = closeHistory(editor.state.tr);
  if (bibliography) tr.setNodeMarkup(bibliography.pos, undefined, { ...attrs, title: attrs.title.trim() });
  else { const { $from } = editor.state.selection; tr.insert($from.depth ? $from.after(1) : $from.pos, editor.schema.nodes.documentBibliography.create({ ...attrs, title: attrs.title.trim() })); }
  editor.view.dispatch(tr); return true;
}
export function removeBibliography(editor) {
  if (editor.isEditable === false) return false;
  const { bibliography } = citationsIn(editor.state.doc); if (!bibliography) return false;
  editor.view.dispatch(closeHistory(editor.state.tr).delete(bibliography.pos, bibliography.pos + bibliography.node.nodeSize)); return true;
}
export function goToCitation(editor, id) {
  const item = citationsIn(editor.state.doc).citations.find(item => item.id === id); if (!item) return false;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(item.pos))).scrollIntoView());
  const $pos = editor.state.doc.resolve(item.pos); editor.view.nodeDOM?.($pos.before($pos.depth))?.scrollIntoView?.({ block: 'center' });
  if (editor.isEditable !== false) editor.commands.focus(); return true;
}
export function normalizeCitations(state) {
  const tr = state.tr, seen = new Set();
  state.doc.descendants((node, pos) => { if (node.type.name !== 'documentCitation') return;
    let id = node.attrs.id; if (!/^cite-[0-9a-f]{32}$/.test(id || '') || seen.has(id)) id = newCitationId(); seen.add(id);
    if (id !== node.attrs.id) tr.setNodeMarkup(pos, undefined, { ...node.attrs, id });
  }); return tr.docChanged ? tr : null;
}
export function citationPlugin() { return new Plugin({
  appendTransaction: (transactions, _old, state) => transactions.some(tr => tr.docChanged) ? normalizeCitations(state) : null,
  filterTransaction(tr) {
    if (!tr.docChanged) return true; let valid = true, bibliography = 0, citations = 0;
    tr.doc.descendants((node, _pos, parent) => { if (node.type.name === 'documentBibliography') { bibliography++; if (parent.type.name !== 'doc') valid = false; } if (node.type.name === 'documentCitation') citations++; });
    return valid && bibliography <= 1 && citations <= 1000 && sourceCatalog(tr.doc).length <= 100;
  },
}); }
export const DocumentCitations = Extension.create({ name: 'documentCitations',
  addGlobalAttributes: () => [{ types: ['doc'], attributes: { sources: { default: [], rendered: false }, citationStyle: { default: 'apa', rendered: false } } }],
  addProseMirrorPlugins: () => [citationPlugin()],
});
const openCitation = (editor, id) => editor.view.dom.dispatchEvent(new CustomEvent('document-citation-open', { bubbles: true, detail: { id } }));
export const DocumentCitation = Node.create({ name: 'documentCitation', group: 'inline', inline: true, atom: true, marks: '',
  addAttributes: () => ({ id: { default: null, rendered: false }, sourceIds: { default: [], rendered: false }, mode: { default: 'parenthetical', rendered: false }, locator: { default: '', rendered: false }, prefix: { default: '', rendered: false }, suffix: { default: '', rendered: false } }),
  // Clipboard citations become their visible text. Source lists travel through DOCX/JSON.
  renderHTML({ node }) { return ['span', { class: 'de-citation' }, citationLabel(node.attrs, citationContext(this.editor.state.doc))]; },
  renderText: () => '',
  addNodeView() { return ({ editor, node }) => {
    const dom = document.createElement('span'), button = document.createElement('button'); dom.className = 'de-citation'; dom.contentEditable = 'false'; button.type = 'button'; dom.append(button); let current = node;
    const render = () => { const label = citationLabel(current.attrs, citationContext(editor.state.doc)); button.textContent = label; button.setAttribute('aria-label', 'Edit citation ' + label); };
    button.addEventListener('mousedown', event => event.preventDefault()); button.addEventListener('click', () => openCitation(editor, current.attrs.id)); render(); editor.on('transaction', render);
    return { dom, stopEvent: () => true, ignoreMutation: () => true, update(next) { if (next.type !== current.type) return false; current = next; render(); return true; }, destroy() { editor.off('transaction', render); } };
  }; },
});
export const DocumentBibliography = Node.create({ name: 'documentBibliography', group: 'block', atom: true, selectable: true, isolating: true,
  addAttributes: () => ({ title: { default: 'References' }, includeUncited: { default: false } }),
  renderHTML({ node }) {
    const entries = bibliographyEntries(this.editor.state.doc, node.attrs.includeUncited);
    return ['section', { class: 'de-bibliography' }, ['h2', {}, node.attrs.title], ...entries.map(entry => ['p', {}, ...entry.parts.map(part => [part.href ? 'a' : part.italic ? 'em' : 'span', part.href ? { href: part.href, target: '_blank', rel: 'noopener noreferrer' } : {}, part.text])])];
  },
  addNodeView() { return ({ editor, node }) => {
    const dom = document.createElement('section'); dom.className = 'de-bibliography'; dom.contentEditable = 'false'; dom.setAttribute('aria-label', 'Bibliography'); let current = node, last = '';
    const render = () => {
      const entries = bibliographyEntries(editor.state.doc, current.attrs.includeUncited), signature = JSON.stringify([current.attrs, entries]); if (signature === last) return; last = signature;
      const title = document.createElement('h2'); title.textContent = current.attrs.title; const content = document.createElement('div');
      for (const entry of entries) { const p = document.createElement('p'); for (const part of entry.parts) { const span = document.createElement(part.href ? 'a' : part.italic ? 'em' : 'span'); span.textContent = part.text; if (part.href) { span.href = part.href; span.target = '_blank'; span.rel = 'noopener noreferrer'; } p.append(span); } content.append(p); }
      if (!entries.length) { const p = document.createElement('p'); p.textContent = 'Insert a citation or include uncited sources to populate this bibliography.'; content.append(p); }
      dom.replaceChildren(title, content);
    }; render(); editor.on('transaction', render);
    return { dom, stopEvent: event => !!event.target.closest?.('a'), ignoreMutation: () => true, update(next) { if (next.type !== current.type) return false; current = next; render(); return true; }, destroy() { editor.off('transaction', render); } };
  }; },
});
