export function SelectionCheckbox({selection, item, label, disabled = false}) {
  if (!selection.enabled) return null;
  return <input className="selection-checkbox" type="checkbox" aria-label={`Select ${label}`} checked={selection.has(item)}
    disabled={disabled} onClick={event => event.stopPropagation()} onChange={() => selection.toggle(item)} />;
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
      <small>Select all applies to this list's current search, across pages.</small>
    </> : items.length > 0 && <button type="button" disabled={busy} onClick={selection.start}>Select {label}</button>}
    {batch?.busy && <span role="status">Applying changes…</span>}
    {batch?.feedback && <p className={batch.hasError ? "bulk-error" : "bulk-feedback"} role={batch.hasError ? "alert" : "status"}>{batch.feedback}</p>}
  </div>;
}
