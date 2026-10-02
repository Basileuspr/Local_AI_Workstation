import { useEffect, useRef, useState } from "react";
import { checklistItems } from "../markdownTasks";

export default function ChatChecklistEditor({ content, initialItems, onItemsChange, busy, onSave, onCancel }) {
  const nextKey = useRef(0);
  const [items, setItems] = useState(() => (initialItems || checklistItems(content)).map(item => ({ ...item, key: nextKey.current++ })));
  useEffect(() => { onItemsChange?.(items.map(({ key, ...item }) => item)); }, [items, onItemsChange]);
  const list = useRef(null);
  function update(key, patch) { setItems(current => current.map(item => item.key === key ? { ...item, ...patch } : item)); }
  return <form className="chat-checklist-editor" aria-label="Edit checklist" onSubmit={event => {
    event.preventDefault(); if (!busy) onSave(items.map(({ key, ...item }) => item));
  }} onKeyDown={event => { if (event.key === "Escape" && !busy) { event.preventDefault(); event.stopPropagation(); onCancel(); } }}>

    <div ref={list} className="checklist-edit-items">{items.map((item, index) => <div className="checklist-edit-row" key={item.key}>
      <input type="checkbox" aria-label={`Item ${index + 1} completed`} checked={item.checked} disabled={busy} onChange={event => update(item.key, { checked: event.target.checked })} />
      <input type="text" autoFocus={index === 0} aria-label={`Checklist item ${index + 1}`} value={item.text} maxLength={4000} disabled={busy}
        onChange={event => update(item.key, { text: event.target.value })} />
      <button type="button" aria-label={`Remove item ${index + 1}`} disabled={busy} onClick={() => setItems(current => current.filter(entry => entry.key !== item.key))}>Remove</button>
    </div>)}</div>
    {!items.length && <p>No items. Add an item or save the empty list.</p>}
    <div className="checklist-edit-actions">
      <button type="button" disabled={busy || items.length >= 500} onClick={() => {
        setItems(current => [...current, { key: nextKey.current++, line_index: null, text: "", checked: false }]);
        requestAnimationFrame(() => list.current?.querySelector('.checklist-edit-row:last-child input[type=text]')?.focus());
      }}>Add item</button>
      <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save list"}</button>
      <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}
