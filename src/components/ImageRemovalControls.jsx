import { useSelection } from '../useSelection';
import './ImageRemovalControls.css';

export function useImageRemoval(items, onRemove, {label = 'images', disabled = false, scope = '', key = item => item.id} = {}) {
  const selection = useSelection(items, key, scope);
  function remove(chosen) {
    if (disabled || !chosen.length) return;
    onRemove(chosen);
    selection.forget(chosen);
  }
  return {
    toolbar: items.length > 0 && <div className="image-removal-toolbar" role="group" aria-label={`Remove ${label}`}>
      <span>{selection.items.length} selected</span>
      <button type="button" disabled={disabled} onClick={() => selection.selectAll(items)}>Select all</button>
      <button type="button" disabled={disabled || !selection.items.length} onClick={selection.clear}>Clear selection</button>
      <button type="button" disabled={disabled || !selection.items.length} onClick={() => remove(selection.items)}>Remove selected</button>
    </div>,
    controls: (item, name) => <div className="image-removal-controls">
      <label><input type="checkbox" disabled={disabled} checked={selection.has(item)}
        onChange={() => selection.toggle(item)} aria-label={`Select ${name}`} />Select</label>
      <button type="button" disabled={disabled} onClick={() => remove([item])} aria-label={`Remove ${name}`}>Remove</button>
    </div>,
  };
}
