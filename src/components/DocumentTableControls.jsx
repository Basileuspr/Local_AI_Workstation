import { canRepeatFirstRow, columnWidths, fittedWidths, selectTablePart, setColumnWidths, firstRowIsHeader, toggleFirstHeaderRow } from '../documentTables';

export function TableLayoutRibbon({ editor, context, disabled, available, openDialog, Group, Button }) {
  const command = name => editor.chain().focus()[name]().run();
  const cellRange = { top: context.top + 1, bottom: context.bottom, left: context.left + 1, right: context.right };
  const widths = columnWidths(context.table, available);
  const mergeCrossesHeader = context.table.attrs.repeatHeader && context.top === 0 && context.bottom > 1;
  return <>
    <Group name="Selection" className="de-table-selection"><Button label="Select table cells by range" disabled={disabled} onClick={() => openDialog('Select table cells', cellRange)}>Select cells…</Button>
      {['row', 'column', 'table'].map(part => <Button key={part} label={`Select ${part}`} disabled={disabled} onClick={() => selectTablePart(editor, part)}>Select {part}</Button>)}</Group>
    <Group name="Rows & Columns" className="de-table-rows"><div className="de-row">
      <Button label="Insert row above" disabled={disabled || context.map.height >= 100} onClick={() => command('addRowBefore')}>↑ Row</Button>
      <Button label="Insert row below" disabled={disabled || context.map.height >= 100} onClick={() => command('addRowAfter')}>↓ Row</Button>
      <Button label="Delete selected rows" disabled={disabled} onClick={() => command(context.top === 0 && context.bottom === context.map.height ? 'deleteTable' : 'deleteRow')}>Delete rows</Button></div><div className="de-row">
      <Button label="Insert column left" disabled={disabled || context.map.width >= 12} onClick={() => command('addColumnBefore')}>← Column</Button>
      <Button label="Insert column right" disabled={disabled || context.map.width >= 12} onClick={() => command('addColumnAfter')}>→ Column</Button>
      <Button label="Delete selected columns" disabled={disabled} onClick={() => command(context.left === 0 && context.right === context.map.width ? 'deleteTable' : 'deleteColumn')}>Delete columns</Button></div></Group>
    <Group name="Merge" className="de-table-merge"><Button label="Merge selected cells" disabled={disabled || mergeCrossesHeader || !editor.can().mergeCells()} onClick={() => command('mergeCells')}>Merge cells</Button>
      <Button label="Split merged cell" disabled={disabled || !editor.can().splitCell()} onClick={() => command('splitCell')}>Split cell</Button>{mergeCrossesHeader && <span className="de-shortcut">Turn off Repeat first row<br/>to merge into later rows.</span>}</Group>
    <Group name="Cell Size" className="de-table-size"><Button label="Set table column widths" disabled={disabled} onClick={() => openDialog('Column widths', { widths: widths.map(width => (width / 96).toFixed(3)) })}>Column widths…</Button>
      <Button label="Distribute table columns equally" disabled={disabled} onClick={() => setColumnWidths(editor, widths.map(() => Math.max(24, Math.round(widths.reduce((sum, n) => sum + n, 0) / widths.length))))}>Distribute columns</Button>
      <Button label="Fit table to page width" disabled={disabled} onClick={() => setColumnWidths(editor, fittedWidths(widths, available))}>Fit to page</Button></Group>
    <Group name="Table"><Button label="Delete table" disabled={disabled} onClick={() => command('deleteTable')}>Delete table</Button>
      <span className="de-shortcut">{context.map.height} rows × {context.map.width} columns<br/>Drag a column edge to resize</span></Group>
  </>;
}

export function TableDesignRibbon({ editor, context, disabled, Group, Button }) {
  const cell = { ...editor.getAttributes('tableCell'), ...editor.getAttributes('tableHeader') };
  const fills = [['', 'No fill'], ['#E8EEF7', 'Light blue'], ['#FFF2CC', 'Pale yellow'], ['#E2F0D9', 'Light green'], ['#FCE4D6', 'Peach'], ['#F2F2F2', 'Light gray'], ['#FFFFFF', 'White']];
  const fill = (cell.backgroundColor || '').toUpperCase();
  const table = context.table.attrs;
  const update = patch => editor.chain().focus().updateAttributes('table', patch).run();
  const setCell = (key, value) => editor.chain().focus().setCellAttribute(key, value).run();
  return <>
    <Group name="Header"><Button label="Toggle first header row" disabled={disabled} active={firstRowIsHeader(context.table)} onClick={() => toggleFirstHeaderRow(editor)}>Header row</Button>
      <label><input type="checkbox" disabled={disabled || !canRepeatFirstRow(context.table)} checked={table.repeatHeader} onChange={event => update({ repeatHeader: event.target.checked })}/>Repeat first row</label></Group>
    <Group name="Shading" className="de-table-shading"><label>Fill<select aria-label="Cell shading" disabled={disabled} value={fills.some(([value]) => value === fill) ? fill : 'custom'} onChange={event => setCell('backgroundColor', event.target.value || null)}>{fills.map(([value, name]) => <option key={value} value={value}>{name}</option>)}<option value="custom" disabled>Custom color</option></select></label>
      <label className="de-cell-color">Custom<input type="color" aria-label="Cell background color" value={cell.backgroundColor || '#FFFFFF'} disabled={disabled} onChange={event => setCell('backgroundColor', event.target.value)}/></label>
      <Button label="Clear cell shading" disabled={disabled} onClick={() => setCell('backgroundColor', null)}>Clear fill</Button></Group>
    <Group name="Borders"><label>Borders<select aria-label="Table borders" disabled={disabled} value={table.borderPreset} onChange={event => update({ borderPreset: event.target.value })}><option value="grid">All borders</option><option value="outer">Outside borders</option><option value="none">No borders</option></select></label></Group>
    <Group name="Alignment"><label>Table<select aria-label="Table alignment" disabled={disabled} value={table.tableAlignment} onChange={event => update({ tableAlignment: event.target.value })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
      <label>Cell text<select aria-label="Cell vertical alignment" disabled={disabled} value={cell.verticalAlign || 'top'} onChange={event => setCell('verticalAlign', event.target.value)}><option value="top">Top</option><option value="center">Center</option><option value="bottom">Bottom</option></select></label></Group>
    <div className="de-ribbon-note">Use Home for font and paragraph alignment.<br/>Repeating headers appear in the DOCX reader.</div>
  </>;
}

export function TableWidthFields({ fields, setFields, available }) {
  return <><div className="de-column-widths">{fields.widths.map((width, index) => <label key={index}>Column {index + 1}<input aria-label={`Column ${index + 1} width in inches`} type="number" required min="0.25" max="16.666" step="any" value={width} onChange={event => setFields(previous => ({ ...previous, widths: previous.widths.map((item, i) => i === index ? event.target.value : item) }))}/>in</label>)}</div>
    <p className="de-setting-hint">Available page width: {(available / 96).toFixed(2)} inches. Export scales tables wider than the writing area to fit. Merged cells use the combined widths of their columns.</p></>;
}

export function TableRangeFields({ fields, setFields, context }) {
  return <><p>Select a rectangular range. An existing merged cell is selected as a whole.</p><div className="de-setting-grid">{[['top', 'From row', context.map.height], ['bottom', 'To row', context.map.height], ['left', 'From column', context.map.width], ['right', 'To column', context.map.width]].map(([key, label, max]) =>
    <label key={key}>{label}<input aria-label={label} type="number" required min={key === 'bottom' ? fields.top : key === 'right' ? fields.left : 1} max={max} value={fields[key]} onChange={event => setFields(previous => ({ ...previous, [key]: event.target.value }))}/></label>)}</div></>;
}
