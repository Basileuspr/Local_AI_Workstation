import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { CellSelection, TableMap, isInTable, selectedRect } from '@tiptap/pm/tables';
import { TableCell, TableHeader, TableView } from '@tiptap/extension-table';

const cellContent = '(paragraph | heading | bulletList | orderedList | image)+';
export const DocumentTableCell = TableCell.extend({ content: cellContent });
export const DocumentTableHeader = TableHeader.extend({ content: cellContent });

function cellColor(value) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toUpperCase();
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(value || '');
  return rgb && rgb.slice(1).every(n => +n <= 255) ? '#' + rgb.slice(1).map(n => (+n).toString(16).padStart(2, '0')).join('').toUpperCase() : null;
}

export const DocumentTableProperties = Extension.create({
  name: 'documentTableProperties',
  addGlobalAttributes() {
    return [
      { types: ['table'], attributes: {
        tableAlignment: { default: 'left', parseHTML: el => el.dataset.tableAlignment || 'left', renderHTML: attrs => ({ 'data-table-alignment': attrs.tableAlignment }) },
        borderPreset: { default: 'grid', parseHTML: el => el.dataset.borderPreset || 'grid', renderHTML: attrs => ({ 'data-border-preset': attrs.borderPreset }) },
        repeatHeader: { default: false, parseHTML: el => el.dataset.repeatHeader === 'true', renderHTML: attrs => ({ 'data-repeat-header': String(attrs.repeatHeader) }) },
      } },
      { types: ['tableCell', 'tableHeader'], attributes: {
        backgroundColor: { default: null, parseHTML: el => cellColor(el.style.backgroundColor), renderHTML: attrs => attrs.backgroundColor ? { style: `background-color: ${attrs.backgroundColor}` } : {} },
        verticalAlign: { default: 'top', parseHTML: el => ['top', 'middle', 'bottom'].includes(el.style.verticalAlign) ? el.style.verticalAlign.replace('middle', 'center') : 'top', renderHTML: attrs => ({ style: `vertical-align: ${attrs.verticalAlign === 'center' ? 'middle' : attrs.verticalAlign}` }) },
      } },
    ];
  },
  addProseMirrorPlugins() {
    return [documentTableBoundsPlugin()];
  },
});

export function documentTableBoundsPlugin() {
  return new Plugin({ filterTransaction(transaction) {
      if (!transaction.docChanged) return true;
      let valid = true;
      transaction.doc.descendants(node => {
        if (node.type.name !== 'table') return;
        const map = TableMap.get(node);
        if (map.height > 100 || map.width > 12) valid = false;
        return false;
      });
      return valid;
    },
    appendTransaction(transactions, _oldState, state) {
      if (!transactions.some(transaction => transaction.docChanged)) return null;
      const transaction = state.tr;
      state.doc.descendants((node, pos) => {
        if (!['tableCell', 'tableHeader'].includes(node.type.name) || !node.attrs.colwidth) return;
        // Drag resizing and pasted HTML also pass through the DOCX width limits.
        const colwidth = node.attrs.colwidth.map(width => !Number.isFinite(width) || width === 0 ? 0 : Math.max(24, Math.min(1600, Math.round(width))));
        if (colwidth.some((width, index) => width !== node.attrs.colwidth[index])) transaction.setNodeMarkup(pos, undefined, { ...node.attrs, colwidth });
      });
      return transaction.docChanged ? transaction : null;
    },
  });
}

// Tiptap's default table view updates widths, but not custom table attributes.
export class DocumentTableView extends TableView {
  constructor(...args) { super(...args); this.syncAppearance(); }
  update(node) { const result = super.update(node); if (result) this.syncAppearance(); return result; }
  syncAppearance() {
    const { tableAlignment = 'left', borderPreset = 'grid', repeatHeader = false } = this.node.attrs;
    this.table.dataset.tableAlignment = tableAlignment;
    this.table.dataset.borderPreset = borderPreset;
    this.table.dataset.repeatHeader = String(repeatHeader);
    this.table.style.marginLeft = tableAlignment === 'left' ? '0' : 'auto';
    this.table.style.marginRight = tableAlignment === 'right' ? '0' : 'auto';
    if (!this.table.style.width) this.table.style.width = '100%';
  }
}

export function tableContext(state) {
  return isInTable(state) ? selectedRect(state) : null;
}

export function columnWidths(table, availablePixels = 624) {
  const map = TableMap.get(table);
  return Array.from({ length: map.width }, (_, column) => {
    const pos = map.map[column], cell = table.nodeAt(pos), rect = map.findCell(pos);
    return cell.attrs.colwidth?.[column - rect.left] || Math.max(24, Math.round(availablePixels / map.width));
  });
}

export function setColumnWidths(editor, widths) {
  const context = tableContext(editor.state);
  if (!context || widths.length !== context.map.width || widths.some(w => !Number.isInteger(w) || w < 24 || w > 1600)) return false;
  const transaction = editor.state.tr;
  for (const pos of new Set(context.map.map)) {
    const cell = context.table.nodeAt(pos), rect = context.map.findCell(pos);
    transaction.setNodeMarkup(context.tableStart + pos, undefined, { ...cell.attrs, colwidth: widths.slice(rect.left, rect.right) });
  }
  editor.view.dispatch(transaction);
  editor.commands.focus();
  return true;
}

export function fittedWidths(widths, target) {
  const total = widths.reduce((sum, value) => sum + value, 0);
  return widths.map(value => Math.max(24, Math.min(1600, Math.round(value / total * target))));
}

export function selectCellRange(editor, { top, left, bottom, right }) {
  const context = tableContext(editor.state);
  if (!context || ![top, left, bottom, right].every(Number.isInteger) || top < 0 || left < 0 || top >= bottom || left >= right || bottom > context.map.height || right > context.map.width) return false;
  const anchor = context.tableStart + context.map.map[top * context.map.width + left];
  const head = context.tableStart + context.map.map[(bottom - 1) * context.map.width + right - 1];
  editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, anchor, head)));
  editor.commands.focus();
  return true;
}

export function selectTablePart(editor, part) {
  const context = tableContext(editor.state);
  if (!context) return false;
  return selectCellRange(editor, { top: part === 'row' ? context.top : 0,
    bottom: part === 'row' ? context.bottom : context.map.height,
    left: part === 'column' ? context.left : 0, right: part === 'column' ? context.right : context.map.width });
}

export function canRepeatFirstRow(table) {
  let allowed = true;
  table.firstChild?.forEach(cell => { if (cell.attrs.rowspan > 1) allowed = false; });
  return allowed;
}

export function firstRowIsHeader(table) {
  let header = true;
  table.firstChild.forEach(cell => { if (cell.type.name !== 'tableHeader') header = false; });
  return header;
}

export function toggleFirstHeaderRow(editor) {
  const context = tableContext(editor.state);
  if (!context) return false;
  const type = editor.state.schema.nodes[firstRowIsHeader(context.table) ? 'tableCell' : 'tableHeader'];
  const transaction = editor.state.tr;
  for (const pos of context.map.cellsInRect({ top: 0, bottom: 1, left: 0, right: context.map.width })) {
    transaction.setNodeMarkup(context.tableStart + pos, type, context.table.nodeAt(pos).attrs);
  }
  editor.view.dispatch(transaction);
  editor.commands.focus();
  return true;
}
