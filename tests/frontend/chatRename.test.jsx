import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { ChatSessionItem } from '../../src/components/ChatListActions';
import { applySessionRename } from '../../src/sessionPersistence';
import { reducer } from '../../src/useStore';

describe('accessible chat list renaming', () => {
  it('provides a native keyboard-accessible chat button and a visible labelled actions trigger', () => {
    const markup = renderToStaticMarkup(<ChatSessionItem session={{ id: 'a', title: 'A <script>', message_count: 2 }} active paneLabel="Chat A" onOpen={() => {}} onDelete={() => {}} onRename={() => {}}/>);
    expect(markup).toContain('aria-label="Open chat A &lt;script&gt;"');
    expect(markup).toContain('Right-click or press F2 to rename');
    expect(markup).toContain('aria-label="Chat actions for A &lt;script&gt;"');
    expect(markup).toContain('aria-haspopup="menu" aria-expanded="false"');
    expect(markup).toContain('aria-label="Delete chat A &lt;script&gt;"');
    expect(markup).toContain('2 msgs · Chat A');
    expect(markup).not.toContain('role="menu"');
  });
  it('updates shared titles without switching chats, replacing messages, or certifying a stale revision', () => {
    const history = [{ id: 'new', content: 'Newer reply' }];
    const state = { currentSessionId: 'a', sessionTitle: 'Old A', sessionRevision: 'local-newer', memorySummary: 'Local summary',
      conversationHistory: history, sessions: [{ id: 'a', title: 'Old A', message_count: 3 }, { id: 'b', title: 'Old B' }],
      sessionImages: [{ session_id: 'a', session_title: 'Old A', id: 'img-a' }, { session_id: 'b', session_title: 'Old B' }] };
    const actions = [], dispatch = vi.fn(action => actions.push(action));
    const saved = { id: 'a', title: 'Chosen name', previous_revision: 'server-revision', revision: 'renamed', messages: [{ id: 'stale' }], memory_summary: 'Server summary' };
    applySessionRename(dispatch, saved);
    const changed = actions.reduce(reducer, state);
    expect(changed.currentSessionId).toBe('a');
    expect(changed.conversationHistory).toBe(history);
    expect(changed.sessionRevision).toBe('local-newer');
    expect(changed.memorySummary).toBe('Local summary');
    expect(changed.sessionTitle).toBe('Chosen name');
    expect(changed.sessions).toEqual([{ id: 'a', title: 'Chosen name', message_count: 3 }, state.sessions[1]]);
    expect(changed.sessionImages[0].session_title).toBe('Chosen name');
    expect(changed.sessionImages[1]).toBe(state.sessionImages[1]);
    expect(actions.some(action => action.type === 'SET_SESSION')).toBe(false);
    const background = reducer(state, { type: 'SESSION_TITLE_UPDATED', payload: { id: 'b', title: 'Background name' } });
    expect(background.sessionTitle).toBe('Old A');
    expect(background.conversationHistory).toBe(history);
    expect(background.sessions[1].title).toBe('Background name');
  });
});
