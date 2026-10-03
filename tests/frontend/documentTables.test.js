import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { mergeCells, splitCell, addColumnAfter, deleteColumn, deleteTable, TableMap, tableEditing } from '@tiptap/pm/tables';
import { documentExtensions } from '../../src/documentEditor';
import { columnWidths, setColumnWidths, selectCellRange, selectTablePart, canRepeatFirstRow, documentTableBoundsPlugin, firstRowIsHeader, toggleFirstHeaderRow } from '../../src/documentTables';

const schema = getSchema(documentExtensions());
function editorFor(rows = 3, columns = 3) {
  const cells = Array.from({ length: rows }, (_, r) => ({ type: 'tableRow', content: Array.from({ length: columns }, (_, c) => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${r}:${c}` }] }] })) }));
  const doc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'table', content: cells }] });
  const editor = { state: EditorState.create({ schema, doc, selection: TextSelection.create(doc, 4), plugins: [tableEditing(), documentTableBoundsPlugin()] }), commands: { focus() {} } };
  editor.view = { dispatch(transaction) { editor.state = editor.state.applyTransaction(transaction).state; } };
  return editor;
}

describe('document table editing', () => {
  it('toggles the full first header row even in a one-cell table', () => {
    const single = editorFor(1, 1);
    toggleFirstHeaderRow(single);
    expect(firstRowIsHeader(single.state.doc.firstChild)).toBe(true);
    toggleFirstHeaderRow(single);
    expect(firstRowIsHeader(single.state.doc.firstChild)).toBe(false);
    const editor = editorFor(3, 3);
    selectCellRange(editor, { top: 2, bottom: 3, left: 1, right: 2 });
    toggleFirstHeaderRow(editor);
    expect(firstRowIsHeader(editor.state.doc.firstChild)).toBe(true);
    expect(editor.state.doc.firstChild.child(2).child(1).type.name).toBe('tableCell');
  });
  it('keeps drag and pasted column widths exportable and blocks a thirteenth column', () => {
    const editor = editorFor(1, 12);
    selectCellRange(editor, { top: 0, bottom: 1, left: 11, right: 12 });
    addColumnAfter(editor.state, editor.view.dispatch);
    expect(TableMap.get(editor.state.doc.firstChild).width).toBe(12);
    const first = editor.state.doc.firstChild.firstChild.firstChild;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(2, undefined, { ...first.attrs, colwidth: [2500] }));
    expect(columnWidths(editor.state.doc.firstChild)[0]).toBe(1600);
    editor.view.dispatch(editor.state.tr.setNodeMarkup(2, undefined, { ...first.attrs, colwidth: [28.7] }));
    expect(columnWidths(editor.state.doc.firstChild)[0]).toBe(29);
    expect(TableMap.get(editor.state.doc.firstChild).problems).toBeNull();
  });
  it('merges and splits a rectangular range without losing text', () => {
    const editor = editorFor();
    expect(selectCellRange(editor, { top: 0, bottom: 2, left: 0, right: 2 })).toBe(true);
    expect(mergeCells(editor.state, editor.view.dispatch)).toBe(true);
    const table = editor.state.doc.firstChild, merged = table.firstChild.firstChild;
    expect(merged.attrs).toMatchObject({ colspan: 2, rowspan: 2 });
    expect(merged.textContent).toBe('0:00:11:01:1');
    expect(canRepeatFirstRow(table)).toBe(false);
    expect(TableMap.get(table).problems).toBeNull();
    expect(splitCell(editor.state, editor.view.dispatch)).toBe(true);
    expect(editor.state.doc.firstChild.firstChild.childCount).toBe(3);
    expect(editor.state.doc.textContent).toContain('0:00:11:01:1');
  });
  it('updates each column width consistently across merged and ordinary cells', () => {
    const editor = editorFor();
    selectCellRange(editor, { top: 0, bottom: 2, left: 0, right: 2 });
    mergeCells(editor.state, editor.view.dispatch);
    expect(setColumnWidths(editor, [96, 144, 192])).toBe(true);
    const table = editor.state.doc.firstChild;
    expect(columnWidths(table)).toEqual([96, 144, 192]);
    expect(table.firstChild.firstChild.attrs.colwidth).toEqual([96, 144]);
    expect(table.child(2).child(1).attrs.colwidth).toEqual([144]);
    expect(TableMap.get(table).problems).toBeNull();
    expect(setColumnWidths(editor, [2, 3, 4])).toBe(false);
  });
  it('selects rows, columns and the full grid and supports insertion beside merges', () => {
    const editor = editorFor();
    selectCellRange(editor, { top: 0, bottom: 1, left: 0, right: 2 });
    mergeCells(editor.state, editor.view.dispatch);
    expect(addColumnAfter(editor.state, editor.view.dispatch)).toBe(true);
    expect(TableMap.get(editor.state.doc.firstChild).width).toBe(4);
    selectCellRange(editor, { top: 0, bottom: 1, left: 2, right: 3 });
    expect(deleteColumn(editor.state, editor.view.dispatch)).toBe(true);
    expect(TableMap.get(editor.state.doc.firstChild).width).toBe(3);
    selectTablePart(editor, 'row');
    expect(editor.state.selection.isRowSelection()).toBe(true);
    selectTablePart(editor, 'column');
    expect(editor.state.selection.isColSelection()).toBe(true);
    selectTablePart(editor, 'table');
    expect(editor.state.selection.isRowSelection()).toBe(true);
    expect(editor.state.selection.isColSelection()).toBe(true);
    expect(deleteTable(editor.state, editor.view.dispatch)).toBe(true);
    expect(editor.state.doc.firstChild.type.name).toBe('paragraph');
  });
});
