import {useEffect, useId, useRef, useState} from 'react';
import './ActionMenu.css';

// Action-only popovers: editors and their drafts stay in their own workspaces.
// The native top layer keeps menus reachable inside scrolling or pinned panes.
export default function ActionMenu({label = 'More actions', title, actions}) {
  const id = useId(), trigger = useRef(null), panel = useRef(null);
  const [open, setOpen] = useState(false);
  const available = actions.filter(Boolean);
  function position() {
    const node = panel.current, anchor = trigger.current;
    if (!node || !anchor) return;
    const rect = anchor.getBoundingClientRect(), margin = 8;
    node.style.maxHeight = `${Math.max(80, window.innerHeight - margin * 2)}px`;
    const bounds = node.getBoundingClientRect();
    const below = rect.bottom + 4;
    node.style.left = `${Math.max(margin, Math.min(rect.right - bounds.width, window.innerWidth - bounds.width - margin))}px`;
    node.style.top = `${Math.max(margin, Math.min(below + bounds.height <= window.innerHeight - margin ? below : rect.top - bounds.height - 4, window.innerHeight - bounds.height - margin))}px`;
  }
  function close() { panel.current?.hidePopover(); trigger.current?.focus({preventScroll:true}); }
  function toggle() {
    if (panel.current?.matches(':popover-open')) close();
    else { panel.current?.showPopover(); position(); }
  }
  useEffect(() => {
    if (!open) return;
    // Keep the menu with its anchor when the workspace scrolls or changes size.
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [open]);
  function keyboard(event) {
    const buttons = [...panel.current.querySelectorAll('button:not(:disabled)')];
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement);
    let next;
    if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
    if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = buttons.length - 1;
    if (next !== undefined) { event.preventDefault(); buttons[next].focus({preventScroll:true}); }
  }
  return <span className="action-menu">
    <button ref={trigger} type="button" className="action-menu-trigger" title={title || label}
      aria-expanded={open} aria-controls={id} disabled={!available.length} onClick={toggle}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); panel.current.showPopover(); position(); const buttons = panel.current.querySelectorAll('button:not(:disabled)'); (event.key === 'ArrowUp' ? buttons[buttons.length - 1] : buttons[0])?.focus({preventScroll:true}); } }}>
      {label} <span aria-hidden="true">⌄</span>
    </button>
    <div id={id} ref={panel} popover="auto" className="action-menu-panel" role="group" aria-label={label}
      onToggle={event => { const showing = event.currentTarget.matches(':popover-open'); setOpen(showing); if (showing) position(); }} onKeyDown={keyboard}>
      {available.map(action => <button type="button" key={action.label} disabled={action.disabled} title={action.title}
        className={action.danger ? 'action-menu-danger' : undefined} onClick={event => { close(); action.onClick(event); }}>{action.label}</button>)}
    </div>
  </span>;
}
