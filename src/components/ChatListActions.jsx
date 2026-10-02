import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './ChatListActions.css';
import { useDismissiblePopup } from '../useDismissiblePopup';

function ChatMenu({ menu, id, labelledBy, onClose, onRename }) {
  const ref = useRef(null), [position, setPosition] = useState({ left: menu.x, top: menu.y });
  useDismissiblePopup({ open: true, container: ref, onDismiss: () => onClose(false), returnFocus: menu.returnFocus });
  useLayoutEffect(() => {
    const node = ref.current, bounds = node.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(menu.x, window.innerWidth - bounds.width - 8)), top: Math.max(8, Math.min(menu.y, window.innerHeight - bounds.height - 8)) });
    node.querySelector('button').focus();
  }, [menu]);
  useEffect(() => {
    const dismiss = () => onClose(false);
    window.addEventListener('resize', dismiss); window.addEventListener('scroll', dismiss, true);
    return () => { window.removeEventListener('resize', dismiss); window.removeEventListener('scroll', dismiss, true); };
  }, [onClose]);
  return createPortal(<div ref={ref} id={id} role="menu" aria-labelledby={labelledBy} className="chat-list-menu" style={position}
    onClick={event => event.stopPropagation()} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
    onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) onClose(false); }}
    onKeyDown={event => {
      if (event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); onClose(true); }
      if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); ref.current.querySelector('button').focus(); }
    }}>
    <button type="button" role="menuitem" onClick={onRename}>Rename chat</button>
  </div>, document.body);
}

export function ChatSessionItem({ session, active, paneLabel = '', disabled = false, selection, onOpen, onDelete, onRename }) {
  const [menu, setMenu] = useState(null), openButton = useRef(null), actions = useRef(null);
  const id = useId();
  useEffect(() => { if (disabled) setMenu(null); }, [disabled]);
  function closeMenu(restoreFocus) { const target = menu?.returnFocus; setMenu(null); if (restoreFocus) target?.focus(); }
  function showMenu(event, pointer = false) {
    event.preventDefault(); event.stopPropagation();
    if (disabled) return;
    const target = pointer ? openButton.current : event.currentTarget;
    const bounds = target.getBoundingClientRect();
    setMenu({ x: pointer ? event.clientX : bounds.left, y: pointer ? event.clientY : bounds.bottom + 4, returnFocus: target });
  }
  function rename(target) { setMenu(null); onRename(session, target); }
  function keyboard(event) {
    if (event.key === 'F2') { event.preventDefault(); event.stopPropagation(); if (!disabled) rename(event.currentTarget); }
    else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) showMenu(event);
  }
  return <div className={`session-item ${active ? 'active' : ''}`} onContextMenu={event => showMenu(event, true)}
    onClick={() => { if (!disabled) onOpen(); }}>
    {selection}
    <button ref={openButton} type="button" className="session-info session-open-button" disabled={disabled}
      aria-label={`Open chat ${session.title}`} title={`${session.title} · Right-click or press F2 to rename`}
      onKeyDown={keyboard} onClick={event => { event.stopPropagation(); if (!disabled) onOpen(); }}>
      <span className="session-title">{session.title}</span><span className="session-meta">{session.message_count} msgs{paneLabel && ` · ${paneLabel}`}</span>
    </button>
    <button ref={actions} id={id + '-trigger'} type="button" className="session-actions-btn" disabled={disabled}
      aria-label={`Chat actions for ${session.title}`} aria-haspopup="menu" aria-expanded={!!menu} aria-controls={menu ? id + '-menu' : undefined}
      title="Chat actions" onKeyDown={keyboard} onClick={event => { if (menu) { event.stopPropagation(); closeMenu(true); } else showMenu(event); }}>⋯</button>
    <button type="button" className="delete-btn" disabled={disabled} aria-label={`Delete chat ${session.title}`} onClick={onDelete}>&times;</button>
    {menu && <ChatMenu menu={menu} id={id + '-menu'} labelledBy={id + '-trigger'} onClose={closeMenu} onRename={() => rename(menu.returnFocus)}/>}
  </div>;
}

export function ChatRenameDialog({ session, returnFocus, onSave, onClose }) {
  const dialog = useRef(null), input = useRef(null), submitting = useRef(false);
  const [title, setTitle] = useState(session.title || ''), [saving, setSaving] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const node = dialog.current;
    node.showModal(); input.current.focus(); input.current.select();
    return () => { node.close(); if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus(); };
  }, [returnFocus]);
  async function save(event) {
    event.preventDefault();
    if (submitting.current || !title.trim() || title.trim().length > 120) return;
    submitting.current = true; setSaving(true); setError('');
    try { await onSave(title.trim()); onClose(); }
    catch (failure) { setError(failure.message || 'Could not rename this chat. Please try again.'); }
    finally { submitting.current = false; setSaving(false); }
  }
  return createPortal(<dialog ref={dialog} className="chat-rename-dialog" aria-label="Rename chat"
    onCancel={event => { event.preventDefault(); if (!submitting.current) onClose(); }}>
    <form onSubmit={save} aria-busy={saving}>
      <h2>Rename chat</h2>
      <label>Chat name<input ref={input} autoFocus required maxLength={120} value={title} disabled={saving} onChange={event => setTitle(event.target.value)}/></label>
      {error && <p role="alert" className="chat-rename-error">{error}</p>}
      <footer><button type="button" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" disabled={saving || !title.trim() || title.trim().length > 120}>{saving ? 'Saving…' : 'Save name'}</button></footer>
    </form>
  </dialog>, document.body);
}
