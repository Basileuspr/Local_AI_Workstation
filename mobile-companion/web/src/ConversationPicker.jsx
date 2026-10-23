import React, { useEffect, useState } from 'react';

export default function ConversationPicker({ sessions, session, selectedId, online, busy, onSelect, onSave, onDraftChange }) {
  const [mode, setMode] = useState(null), [title, setTitle] = useState('');
  useEffect(() => { setMode(null); setTitle(''); }, [selectedId]);
  useEffect(() => { onDraftChange(!!mode && !!title.trim()); }, [mode, title, onDraftChange]);
  function open(next) { setTitle(next === 'rename' ? session.title : ''); setMode(next); }
  return <div className="conversation-controls">
    <div className="session-picker"><label>Conversation<select disabled={!online} value={selectedId || ''} onChange={event => onSelect(event.target.value)}>
      <option value="">Choose a conversation</option>{sessions.map(item => <option key={item.id} value={item.id}>{item.title || 'Untitled chat'}</option>)}
    </select></label><button type="button" disabled={!online || busy} onClick={() => open('new')} aria-label="New conversation">＋ New</button>
      <button type="button" disabled={!online || busy || !session} onClick={() => open('rename')} aria-label="Rename conversation">Rename</button></div>
    {mode && <form className="panel conversation-name" onSubmit={async event => { event.preventDefault(); if (await onSave(mode, title.trim())) { setMode(null); setTitle(''); } }}>
      <label>{mode === 'new' ? 'New conversation name' : 'Conversation name'}<input aria-label="Conversation name" autoFocus disabled={busy} maxLength={100} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <div className="row"><button className="primary" disabled={!online || busy || !title.trim()}>{mode === 'new' ? 'Create conversation' : 'Save name'}</button>
        <button type="button" disabled={busy} onClick={() => { setMode(null); setTitle(''); }}>Cancel</button></div>
      <p className="muted">Names are shared with your desktop. Messages and images stay in this conversation.</p>
    </form>}
  </div>;
}
