import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo, redo, closeHistory } from '@tiptap/pm/history';
import { documentExtensions, documentMatches, documentStats, resetDocumentContent } from '../../src/documentEditor';
import { documentNotes, noteNumber, noteBodyError, notePlugin, insertNote, updateNote, deleteNote, convertNotes, saveNoteSettings, DocumentNotes, noteEditorExtensions } from '../../src/documentNotes';

const schema = getSchema(documentExtensions());
const body = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
function editorFor() {
  const editor = { schema, isEditable: true, state: EditorState.create({ schema, doc: schema.nodeFromJSON(body('Body text')), plugins: [history(), notePlugin()] }), commands: { focus() {} } };
  editor.view = { dispatch(tr) { editor.state = editor.state.applyTransaction(tr).state; }, updateState(next) { editor.state = next; } };
  return editor;
}
const select = (editor, from, to = from) => editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));

describe('footnotes and endnotes', () => {
  it('preserves selected text, numbers in document order independently, and excludes markers from search/counts', () => {
    const editor = editorFor(); select(editor, 1, 5); insertNote(editor, 'footnote');
    select(editor, 1); insertNote(editor, 'endnote'); insertNote(editor, 'footnote');
    const notes = documentNotes(editor.state.doc);
    expect(notes.map(item => [item.kind, item.label])).toEqual([['endnote', 'i'], ['footnote', '1'], ['footnote', '2']]);
    expect(editor.state.doc.textContent).toBe('Body text');
    expect(documentStats(editor.state.doc).words).toBe(2);
    expect(documentMatches(editor.state.doc, 'Body', false)).toHaveLength(1);
  });
  it('updates note text in main Undo history, deletes without paragraph loss and restores full note with Undo/Redo', () => {
    const editor = editorFor(), id = insertNote(editor, 'footnote');
    updateNote(editor, id, body('Formatted note')); deleteNote(editor, id);
    expect(documentNotes(editor.state.doc)).toHaveLength(0);
    expect(editor.state.doc.textContent).toBe('Body text');
    undo(editor.state, editor.view.dispatch);
    expect(documentNotes(editor.state.doc)[0].body).toEqual(body('Formatted note'));
    undo(editor.state, editor.view.dispatch);
    expect(documentNotes(editor.state.doc)[0].body.content[0].content).toBeUndefined();
    undo(editor.state, editor.view.dispatch); expect(documentNotes(editor.state.doc)).toHaveLength(0);
    redo(editor.state, editor.view.dispatch); expect(documentNotes(editor.state.doc)).toHaveLength(1);
  });
  it('converts one/all notes and numbering as undoable document edits', () => {
    const editor = editorFor(), id = insertNote(editor, 'footnote'); insertNote(editor, 'endnote');
    convertNotes(editor, 'endnote', id); expect(documentNotes(editor.state.doc).map(item => item.label)).toEqual(['i', 'ii']);
    saveNoteSettings(editor, { footnote: { format: 'lowerLetter', start: 27 }, endnote: { format: 'upperRoman', start: 4 } });
    expect(documentNotes(editor.state.doc).map(item => item.label)).toEqual(['IV', 'V']);
    convertNotes(editor, 'footnote'); expect(documentNotes(editor.state.doc).map(item => item.label)).toEqual(['aa', 'ab']);
    undo(editor.state, editor.view.dispatch); expect(documentNotes(editor.state.doc).every(item => item.kind === 'endnote')).toBe(true);
    expect(() => saveNoteSettings(editor, { footnote: { format: 'decimal', start: 0 }, endnote: { format: 'decimal', start: 1 } })).toThrow();
  });
  it('copies a note as an independent ID and resets note documents without cross-file Undo', () => {
    const editor = editorFor(); insertNote(editor, 'footnote');
    const original = documentNotes(editor.state.doc)[0];
    editor.view.dispatch(editor.state.tr.insert(2, original.node));
    const notes = documentNotes(editor.state.doc);
    expect(new Set(notes.map(item => item.id)).size).toBe(2);
    updateNote(editor, notes[1].id, body('Independent'));
    expect(documentNotes(editor.state.doc)[0].body).toEqual(original.body);
    const recovered = editor.state.doc.toJSON(); resetDocumentContent(editor, recovered);
    expect(documentNotes(editor.state.doc)).toHaveLength(2);
    expect(undo(editor.state, editor.view.dispatch)).toBe(false);
  });
  it('guards editing in read-only mode and enforces note count at transaction level', () => {
    const editor = editorFor(), id = insertNote(editor, 'footnote'); editor.isEditable = false;
    expect(insertNote(editor, 'endnote')).toBe(false); expect(updateNote(editor, id, body('No'))).toBe(false);
    expect(deleteNote(editor, id)).toBe(false); expect(convertNotes(editor, 'endnote')).toBe(false);
    editor.isEditable = true;
    const node = documentNotes(editor.state.doc)[0].node;
    editor.view.dispatch(editor.state.tr.insert(2, Array(200).fill(node)));
    expect(documentNotes(editor.state.doc)).toHaveLength(1);
    const bindings = DocumentNotes.config.addKeyboardShortcuts.call({ editor });
    expect(bindings['Mod-z']()).toBe(false); editor.isEditable = false;
    expect(bindings['Mod-z']()).toBe(true); expect(bindings['Mod-y']()).toBe(true);
    let called = 0; editor.commands.undo = () => { called++; return true; };
    const noteBindings = noteEditorExtensions(editor).at(-1).config.addKeyboardShortcuts();
    noteBindings['Mod-z'](); expect(called).toBe(0);
  });
  it('validates note limits, safe links, fonts, and the Unicode character budget', () => {
    expect(noteBodyError(body('😀'.repeat(5000)))).toBe('');
    expect(noteBodyError(body('😀'.repeat(5001)))).toContain('10,000');
    expect(noteBodyError({ type: 'doc', content: Array(41).fill({ type: 'paragraph' }) })).toContain('40');
    for (const href of ['javascript:alert(1)', '#Target', 'file:///private']) {
      const value = body('Text'); value.content[0].content[0].marks = [{ type: 'link', attrs: { href } }];
      expect(noteBodyError(value)).toContain('http');
    }
    expect(noteNumber(49, 'upperRoman')).toBe('XLIX'); expect(noteNumber(702, 'lowerLetter')).toBe('zz');
    expect(noteBodyError({ type: 'doc', content: [null] })).toBeTruthy();
    const malformed = body('Text'); malformed.content[0].content[0].marks = [{ type: 'link', attrs: [1] }];
    expect(noteBodyError(malformed)).toBeTruthy();
  });
});
