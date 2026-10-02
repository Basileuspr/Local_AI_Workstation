import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { normalizeNavigationOrder, orderedSections, reorderIds, saveNavigationOrder } from '../navigationOrder';
import './TabOrderEditor.css';

export default function TabOrderEditor({ value, onSave, onClose }) {
  const [draft, setDraft] = useState(() => normalizeNavigationOrder(value));
  const [error, setError] = useState('');
  const dialog = useRef(null), dragging = useRef(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  function move(section, from, to) {
    setDraft(current => section === 'sections'
      ? { ...current, sections: reorderIds(current.sections, from, to) }
      : { ...current, tabs: { ...current.tabs, [section]: reorderIds(current.tabs[section], from, to) } });
  }
  function row(item, index, length, section) {
    return <li key={item.id} draggable data-order-id={item.id} data-order-list={section}
      onDragStart={event => { dragging.current = { section, index }; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id); }}
      onDragEnd={() => { dragging.current = null; }}
      onDragOver={event => { if (dragging.current?.section === section) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
      onDrop={event => { event.preventDefault(); if (dragging.current?.section === section) move(section, dragging.current.index, index); dragging.current = null; }}>
      <span className="tab-order-handle" aria-hidden="true">⠿</span><span className="tab-order-label">{item.label}</span>
      <button type="button" disabled={index === 0} aria-label={`Move ${item.label} up`} onClick={() => move(section, index, index - 1)}>↑</button>
      <button type="button" disabled={index === length - 1} aria-label={`Move ${item.label} down`} onClick={() => move(section, index, index + 1)}>↓</button>
    </li>;
  }
  const sections = orderedSections(draft);
  return createPortal(<dialog ref={dialog} className="tab-order-dialog" aria-label="Arrange app tabs" onCancel={onClose}>
    <header><h2>Arrange app tabs</h2><button type="button" onClick={onClose} aria-label="Close tab arrangement">✕</button></header>

    <h3>Navigation sections</h3><ol aria-label="Section priority">{sections.map((section, index) => row(section, index, sections.length, 'sections'))}</ol>
    {sections.map(section => <section key={section.id}><h3>{section.label}</h3><ol aria-label={`${section.label} tab priority`}>{section.items.map((item, index) => row(item, index, section.items.length, section.id))}</ol></section>)}
    {error && <p role="alert">{error}</p>}
    <footer><button type="button" onClick={() => { setDraft(normalizeNavigationOrder()); setError(''); }}>Reset to default</button><span /><button type="button" onClick={onClose}>Cancel</button><button type="button" onClick={() => {
      try { const saved = saveNavigationOrder(draft); window.dispatchEvent(new Event('navigation-order-changed')); onSave(saved); }
      catch (error) { setError(error.message || 'Could not save tab order.'); }
    }}>Save tab order</button></footer>
  </dialog>, document.body);
}
