import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo, closeHistory } from '@tiptap/pm/history';
import { documentExtensions, documentMatches, documentStats, resetDocumentContent } from '../../src/documentEditor';
import { DEFAULT_STYLES, applyParagraphStyle } from '../../src/documentStyles';
import { documentReferences, normalizeReferences, referencePlugin, saveBookmark, removeBookmark, saveContents, removeContents, safeDocumentLink, setDocumentLink, goToReference } from '../../src/documentReferences';

const schema = getSchema(documentExtensions());
const p = (text, attrs = {}) => ({ type: 'paragraph', attrs, content: text ? [{ type: 'text', text }] : [] });
const h = (text, level = 1) => ({ ...p(text, { level }), type: 'heading' });
const link = (text, href) => ({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] });
function editorFor(content, styles = []) {
  const doc = schema.nodeFromJSON({ type: 'doc', attrs: { styles }, content });
  let state = EditorState.create({ schema, doc, plugins: [history(), referencePlugin()] });
  const normalized = normalizeReferences(state);
  if (normalized) state = EditorState.create({ schema, doc: normalized.doc, plugins: state.plugins });
  const editor = { schema, state, commands: { focus() {} } };
  editor.view = { dispatch(tr) { editor.state = editor.state.applyTransaction(tr).state; }, updateState(next) { editor.state = next; } };
  return editor;
}
const select = (editor, from, to = from) => editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));

describe('document references', () => {
  it('keeps heading destinations through typing and restyling; new copied headings get unique IDs', () => {
    const editor = editorFor([h('Alpha'), p('Body')]);
    const id = editor.state.doc.firstChild.attrs.referenceId;
    editor.view.dispatch(editor.state.tr.insertText(' revised', 6));
    expect(documentReferences(editor.state.doc).headings[0]).toMatchObject({ name: id, text: 'Alpha revised' });
    select(editor, 1); applyParagraphStyle(editor, 'normal');
    expect(documentReferences(editor.state.doc).targets.has(id)).toBe(true);
    expect(documentReferences(editor.state.doc).headings).toHaveLength(0);
    applyParagraphStyle(editor, 'heading-2');
    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, editor.state.doc.firstChild));
    const heads = documentReferences(editor.state.doc).headings;
    expect(heads[0].name).toBe(id); expect(heads[1].name).not.toBe(id);
    expect(heads.map(item => item.level)).toEqual([2, 2]);
  });
  it('adds a point bookmark without replacing a selection and renames all its links atomically with Undo', () => {
    const editor = editorFor([p('Target'), { type: 'paragraph', content: [link('Jump', '#Destination')] }]);
    select(editor, 1, 7); saveBookmark(editor, 'Destination');
    expect(editor.state.doc.firstChild.textContent).toBe('Target');
    editor.view.dispatch(closeHistory(editor.state.tr));
    saveBookmark(editor, 'Renamed', 'Destination');
    expect(documentReferences(editor.state.doc).links[0].href).toBe('#Renamed');
    undo(editor.state, editor.view.dispatch);
    expect(documentReferences(editor.state.doc).bookmarks[0].name).toBe('Destination');
    expect(documentReferences(editor.state.doc).links[0].href).toBe('#Destination');
  });
  it('reports a deleted destination, keeps its text and links, and repairs it with Undo', () => {
    const editor = editorFor([{ type: 'paragraph', content: [{ type: 'bookmark', attrs: { name: 'Target' } }, link('Text', '#Target')] }]);
    removeBookmark(editor, 'Target');
    expect(editor.state.doc.textContent).toBe('Text');
    expect(documentReferences(editor.state.doc).broken).toHaveLength(1);
    undo(editor.state, editor.view.dispatch);
    expect(documentReferences(editor.state.doc).broken).toHaveLength(0);
  });
  it('creates linked display text at the cursor without carrying the mark into new typing; retargeting keeps the label', () => {
    const editor = editorFor([p('Target'), p('')]);
    select(editor, 1); saveBookmark(editor, 'Destination');
    select(editor, editor.state.doc.content.size - 1);
    setDocumentLink(editor, '#Destination', 'Jump here');
    expect(documentReferences(editor.state.doc).links[0].text).toBe('Jump here');
    editor.view.dispatch(editor.state.tr.insertText(' plain'));
    expect(documentReferences(editor.state.doc).links[0].text).toBe('Jump here');
    select(editor, documentReferences(editor.state.doc).links[0].pos + 2);
    setDocumentLink(editor, 'https://example.com', 'ignored replacement');
    expect(editor.state.doc.lastChild.textContent).toBe('Jump here plain');
    expect(editor.state.doc.lastChild.firstChild.marks[0].attrs.href).toBe('https://example.com');
    expect(() => setDocumentLink(editor, '#Missing')).toThrow(/missing/);
  });
  it('bounds names, rejects duplicate destinations and respects read-only commands', () => {
    const editor = editorFor([p('Sample')]);
    select(editor, 1); saveBookmark(editor, 'Target');
    expect(() => saveBookmark(editor, 'target')).toThrow(/already exists/);
    expect(() => saveBookmark(editor, 'with spaces')).toThrow(/letters/);
    expect(() => saveBookmark(editor, 'LAW_H' + 'a'.repeat(32))).toThrow(/reserved/);
    editor.isEditable = false;
    expect(saveBookmark(editor, 'Another')).toBe(false);
    expect(removeBookmark(editor, 'Target')).toBe(false);
    expect(saveContents(editor, { title: 'Contents', maxLevel: 2 })).toBe(false);
    expect(removeContents(editor)).toBe(false);
    expect(documentReferences(editor.state.doc).bookmarks).toHaveLength(1);
  });
  it('uses custom heading styles in lists and tables, updates one contents block, and removes it with Undo', () => {
    const custom = { ...DEFAULT_STYLES[0], id: 'chapter', name: 'Chapter', level: 2 };
    const editor = editorFor([h('Top'), { type: 'bulletList', content: [{ type: 'listItem', content: [p('Listed', { styleId: 'chapter' })] }] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [h('Cell', 3)] }] }] }], [custom]);
    select(editor, 1); saveContents(editor, { title: 'On this page', maxLevel: 2 });
    const refs = documentReferences(editor.state.doc);
    expect(refs.toc.pos).toBe(0); expect(refs.headings.map(item => item.level)).toEqual([1, 2, 3]);
    saveContents(editor, { title: 'Guide', maxLevel: 3 });
    expect(editor.state.doc.childCount).toBe(4);
    expect(documentReferences(editor.state.doc).toc.node.attrs.title).toBe('Guide');
    editor.view.dispatch(closeHistory(editor.state.tr)); removeContents(editor);
    expect(documentReferences(editor.state.doc).toc).toBe(null);
    undo(editor.state, editor.view.dispatch);
    expect(documentReferences(editor.state.doc).toc.node.attrs.title).toBe('Guide');
  });
  it('inserts contents outside a selected table and rejects a second or nested contents node', () => {
    const editor = editorFor([{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('Cell')] }] }] }]);
    select(editor, 4); saveContents(editor, { title: 'Contents', maxLevel: 3 });
    expect(editor.state.doc.firstChild.type.name).toBe('tableOfContents');
    const before = editor.state.doc;
    editor.view.dispatch(editor.state.tr.insert(0, schema.nodes.tableOfContents.create()));
    expect(editor.state.doc.eq(before)).toBe(true);
  });
  it('finds and counts words across invisible bookmark positions', () => {
    const editor = editorFor([{ type: 'paragraph', content: [{ type: 'text', text: 'some' }, { type: 'bookmark', attrs: { name: 'Middle' } }, { type: 'text', text: 'where' }] }]);
    expect(documentStats(editor.state.doc).words).toBe(1);
    expect(documentStats(editor.state.doc).characters).toBe(9);
    expect(documentMatches(editor.state.doc, 'somewhere')).toEqual([{ from: 1, to: 11 }]);
    expect(documentMatches(editor.state.doc, 'where')).toEqual([{ from: 6, to: 11 }]);
  });
  it('normalizes imported headings while resetting Undo history', () => {
    const editor = editorFor([p('Old')]);
    editor.view.dispatch(editor.state.tr.insertText(' changed', 4));
    resetDocumentContent(editor, { type: 'doc', content: [h('Imported')] });
    expect(documentReferences(editor.state.doc).headings[0].name).toMatch(/^LAW_H[0-9a-f]{32}$/);
    expect(undo(editor.state, editor.view.dispatch)).toBe(false);
  });
  it('renames duplicate pasted bookmarks without changing existing link targets', () => {
    const editor = editorFor([{ type: 'paragraph', content: [{ type: 'bookmark', attrs: { name: 'Place' } }, link('Original', '#Place')] }]);
    editor.view.dispatch(editor.state.tr.insert(2, schema.nodes.bookmark.create({ name: 'Place' })));
    expect(documentReferences(editor.state.doc).bookmarks.map(item => item.name)).toEqual(['Place', 'Place_2']);
    expect(documentReferences(editor.state.doc).links[0].href).toBe('#Place');
  });
  it('preserves the original bookmark when a duplicate is inserted before it', () => {
    const editor = editorFor([{ type: 'paragraph', content: [{ type: 'bookmark', attrs: { name: 'Place' } }, link('Original', '#Place')] }]);
    editor.view.dispatch(editor.state.tr.insert(1, schema.nodes.bookmark.create({ name: 'Place' })));
    expect(documentReferences(editor.state.doc).bookmarks.map(item => item.name)).toEqual(['Place_2', 'Place']);
    expect(documentReferences(editor.state.doc).targets.get('Place').pos).toBe(2);
  });
  it('treats adjacent differently formatted link text as one link when checking and renaming', () => {
    const bold = link('bold', '#Place'); bold.marks.push({ type: 'bold' });
    const editor = editorFor([{ type: 'paragraph', content: [{ type: 'bookmark', attrs: { name: 'Place' } }, link('Plain ', '#Place'), bold] }]);
    expect(documentReferences(editor.state.doc).links).toHaveLength(1);
    saveBookmark(editor, 'Renamed', 'Place');
    expect(documentReferences(editor.state.doc).links[0].text).toBe('Plain bold');
    expect(editor.state.doc.firstChild.lastChild.marks.some(mark => mark.type.name === 'bold')).toBe(true);
  });
  it('scrolls to the actual destination block in read-only mode without changing content', () => {
    const editor = editorFor([p('Before'), { type: 'paragraph', content: [bookmarkNode('Place'), { type: 'text', text: 'Destination' }] }]);
    function bookmarkNode(name) { return { type: 'bookmark', attrs: { name } }; }
    const before = editor.state.doc; editor.isEditable = false;
    let scrolled, position;
    editor.view.nodeDOM = pos => { position = pos; return { scrollIntoView: options => { scrolled = options; } }; };
    expect(goToReference(editor, 'Place')).toBe(true);
    expect(position).toBe(8); expect(scrolled).toEqual({ block: 'center', inline: 'nearest' });
    expect(editor.state.doc.eq(before)).toBe(true);
    expect(goToReference(editor, 'Missing')).toBe(false);
  });
  it.each(['#Chapter_1', '#_Toc123', 'https://example.com/#part', 'mailto:editor@example.com'])('allows supported link %s', href => expect(safeDocumentLink(href)).toBe(true));
  it.each(['#', '#bad name', '#<script>', '#a/b', 'file:///secret', 'javascript:alert(1)', 'https://a\x00b'])('rejects unsafe link %s', href => expect(safeDocumentLink(href)).toBe(false));
});
