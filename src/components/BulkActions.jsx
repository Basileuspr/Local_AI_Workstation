import {preventSelectionText} from '../fileSelection';

export function SelectionCheckbox({selection, item, label, disabled = false}) {
  if (!selection.enabled) return null;
  return <input className="selection-checkbox" type="checkbox" aria-label={`Select ${label}`} checked={selection.has(item)}
    disabled={disabled} onMouseDown={preventSelectionText} onClick={event => { event.stopPropagation(); selection.toggle(item, event); }} onChange={() => {}} />;
}

export default function BulkActions({selection, items, label, actions, batch, disabled = false}) {
  const busy = disabled || batch?.busy;
  return <div className="bulk-actions" aria-label={`Manage ${label}`}>
    {selection.enabled ? <>
      <span role="status">{selection.items.length} selected</span>
      <button type="button" disabled={busy || !items.length} onClick={() => selection.selectAll(items)}>Select all ({items.length})</button>
      <button type="button" disabled={busy || !selection.items.length} onClick={selection.clear}>Clear selection</button>
      {actions.map(action => <button key={action.label} type="button" className={action.danger ? "danger" : ""}
        disabled={busy || !selection.items.length} onClick={() => action.onClick(selection.items)}>{action.label}</button>)}
      <button type="button" disabled={busy} onClick={selection.end}>Done selecting</button>

    </> : items.length > 0 && <button type="button" disabled={busy} onClick={selection.start}>Select {label}</button>}
    {batch?.busy && <span role="status">Applying changes…</span>}
    {batch?.feedback && <p className={batch.hasError ? "bulk-error" : "bulk-feedback"} role={batch.hasError ? "alert" : "status"}>{batch.feedback}</p>}
  </div>;
}
