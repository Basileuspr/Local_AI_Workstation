import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo, closeHistory } from '@tiptap/pm/history';
import { documentExtensions } from '../../src/documentEditor';
import { DEFAULT_STYLES, documentStyles, currentStyle, applyParagraphStyle, saveParagraphStyle, removeParagraphStyle, selectedParagraphs } from '../../src/documentStyles';

const schema = getSchema(documentExtensions());
const p = (text, attrs = {}, marks = []) => ({ type: 'paragraph', attrs, content: [{ type: 'text', text, marks }] });
function editorFor(content, styles = []) {
  const doc = schema.nodeFromJSON({ type: 'doc', attrs: { styles }, content });
  const editor = { state: EditorState.create({ schema, doc, selection: TextSelection.create(doc, 1), plugins: [history()] }), commands: { focus() {} } };
  editor.view = { dispatch(tr) { editor.state = editor.state.apply(tr); } };
  return editor;
}
const spec = patch => ({ ...DEFAULT_STYLES[0], id: 'callout', name: 'Callout', ...patch });

describe('named paragraph styles', () => {
  it('applies style references to all selected paragraphs without replacing text marks', () => {
    const editor = editorFor([p('First', { spaceAfter: 30 }), p('Second', {}, [{ type: 'bold' }])], [spec({ fontSize: 18 })]);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 14)));
    expect(selectedParagraphs(editor.state)).toHaveLength(2);
    applyParagraphStyle(editor, 'callout');
    expect(editor.state.doc.child(0).attrs).toMatchObject({ styleId: 'callout', spaceAfter: null });
    expect(editor.state.doc.child(1).firstChild.marks[0].type.name).toBe('bold');
    expect(editor.state.doc.textContent).toBe('FirstSecond');
  });
  it('edits a shared definition with undo while keeping direct paragraph overrides', () => {
    const editor = editorFor([p('A', { styleId: 'callout' }), p('B', { styleId: 'callout', spaceAfter: 2 })], [spec({ fontSize: 14 })]);
    saveParagraphStyle(editor, spec({ fontSize: 22, spaceAfter: 18 }));
    expect(currentStyle(editor).fontSize).toBe(22);
    expect(editor.state.doc.child(1).attrs.spaceAfter).toBe(2);
    undo(editor.state, editor.view.dispatch);
    expect(currentStyle(editor).fontSize).toBe(14);
  });
  it('resets direct formatting while retaining hyperlinks and can undo deletion atomically', () => {
    const editor = editorFor([p('Linked', { styleId: 'callout', spaceAfter: 22 }, [{ type: 'bold' }, { type: 'textStyle', attrs: { fontSize: '20pt' } }, { type: 'link', attrs: { href: 'https://example.com' } }])], [spec({})]);
    applyParagraphStyle(editor, 'callout', true);
    expect(editor.state.doc.firstChild.firstChild.marks.map(mark => mark.type.name)).toEqual(['link']);
    editor.view.dispatch(closeHistory(editor.state.tr));
    removeParagraphStyle(editor, 'callout');
    expect(currentStyle(editor).id).toBe('normal');
    expect(documentStyles(editor.state.doc).some(style => style.id === 'callout')).toBe(false);
    undo(editor.state, editor.view.dispatch);
    expect(currentStyle(editor).id).toBe('callout');
    expect(editor.state.doc.firstChild.textContent).toBe('Linked');
  });
  it('keeps the list schema valid when applying a heading style inside a list', () => {
    const editor = editorFor([{ type: 'bulletList', content: [{ type: 'listItem', content: [p('List heading')] }] }]);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));
    applyParagraphStyle(editor, 'heading-2');
    expect(editor.state.doc.firstChild.firstChild.firstChild.type.name).toBe('paragraph');
    expect(currentStyle(editor).level).toBe(2);
    expect(() => editor.state.doc.check()).not.toThrow();
  });
  it('rejects duplicate names and preserves immutable built-in identity', () => {
    const editor = editorFor([p('Text')]);
    expect(() => saveParagraphStyle(editor, spec({ name: 'Normal' }))).toThrow(/already exists/);
    expect(() => saveParagraphStyle(editor, { ...DEFAULT_STYLES[0], level: 1 })).toThrow(/cannot be changed/);
    expect(removeParagraphStyle(editor, 'normal')).toBe(false);
  });
});
