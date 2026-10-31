import React, { act, useReducer, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InputBar from '../../src/components/InputBar';
import { reducer } from '../../src/useStore';
import { ChatPaneProvider } from '../../src/ChatPane';
import { chatSubmissionQueue } from '../../src/chatSubmissionQueue';
import * as api from '../../src/api';

const store = vi.hoisted(() => ({ state: null, dispatch: null, refs: null }));
vi.mock('../../src/useStore.jsx', async original => ({
  ...await original(), useStore: () => store.state,
  useDispatch: () => store.dispatch, useRefs: () => store.refs,
}));
vi.mock('../../src/api', () => ({
  createSession: vi.fn(), loadSession: vi.fn(), appendSessionMessages: vi.fn(),
  streamChat: vi.fn(), parseFile: vi.fn(), compactMemory: vi.fn(),
}));
vi.mock('../../src/polling', () => ({ invalidatePolling: vi.fn() }));
vi.mock('../../src/chatSpeech', () => ({ chatSpeech: { completed: vi.fn() } }));
vi.mock('../../src/ImageGenerationContext', () => ({ useImageGeneration: () => ({}) }));
vi.mock('../../src/ImageDestinations', () => ({ useImageDestinations: () => null }));
vi.mock('../../src/ImagePrivacy', () => ({ useImagePrivacy: () => ({ ready: true, revision: 0 }) }));
vi.mock('../../src/components/ChatImageControls', () => ({ default: () => null }));
vi.mock('../../src/components/AudioWorkspace', () => ({ ChatAudio: () => null }));
vi.mock('../../src/components/PromptQueue', () => ({ QueueRequestStatus: () => null }));
vi.mock('../../src/components/WebAccess', () => ({ default: () => null }));
vi.mock('../../src/components/ImageEditor', () => ({ default: () => null }));
vi.mock('../../src/components/ChatToolReview', () => ({ default: () => null }));

let root, sessions;
const session = id => ({ id, title: 'Chat', revision: 1, messages: [], memory_summary: '', summarized_message_count: 0 });
const png = name => new File(['pixels'], name, { type: 'image/png' });
const snapshot = id => structuredClone(sessions.get(id));

function Harness({ sessionId, pane }) {
  const [state, dispatch] = useReducer(reducer, {
    currentSessionId: sessionId, conversationHistory: sessionId ? snapshot(sessionId).messages : [],
    sessionTitle: 'Chat', chatDraftVersion: 0, memorySummary: '', summarizedMessageCount: 0,
    selectedModel: 'vision', models: [{ name: 'vision', contextLength: 131072 }],
    responseLength: 1024, voiceOutput: {}, sessions: [],
  });
  const refs = useRef({});
  Object.assign(store, { state, dispatch, refs: refs.current });
  async function newChat() {
    const saved = await api.createSession();
    dispatch({ type: 'SET_SESSION', payload: { ...saved, messages: saved.messages } });
    return saved;
  }
  return <ChatPaneProvider id={pane}><InputBar onNewChat={newChat} /></ChatPaneProvider>;
}

async function mount(sessionId = null, pane = 'primary') {
  await act(async () => root.render(<Harness sessionId={sessionId} pane={pane} />));
}
async function stage(files) {
  await act(async () => window.dispatchEvent(new window.CustomEvent('stage-chat-images', { detail: files, cancelable: true })));
}
async function send(text = '') {
  document.querySelector('textarea').value = text;
  await act(async () => document.querySelector('[id^="send-btn"]').click());
  await act(async () => {
    // FileReader is asynchronous in Chromium; allow the new session to render
    // before the saved attachment and queued reply are delivered.
    await new Promise(resolve => setTimeout(resolve, 10));
  });
}
async function finished(count = 1) {
  await act(async () => {
    await vi.waitFor(() => {
      expect(api.streamChat).toHaveBeenCalledTimes(count);
      expect(chatSubmissionQueue.getSnapshot()).toHaveLength(0);
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', callback => callback());
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag, ...args) => {
    const node = createElement(tag, ...args);
    if (tag === 'dialog') Object.assign(node, { close: vi.fn(), showModal: vi.fn() });
    return node;
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal('FileReader', class {
    readAsDataURL() { setTimeout(() => { this.result = 'data:image/png;base64,QUJD'; this.onload(); }, 0); }
  });
  sessions = new Map([['existing', session('existing')]]);
  api.createSession.mockImplementation(async () => {
    const saved = session('created'); sessions.set(saved.id, saved); return snapshot(saved.id);
  });
  api.loadSession.mockImplementation(async id => snapshot(id));
  api.appendSessionMessages.mockImplementation(async (id, messages) => {
    const saved = sessions.get(id);
    saved.messages.push(...messages.map(message => message.images?.length
      ? { ...message, images: [`stored:${message.id}`] } : message));
    saved.revision++;
    return snapshot(id);
  });
  api.streamChat.mockImplementation(async () => new Response('data: {"token":"Image reaction","done":true}\n\n'));
  root = createRoot(document.getElementById('root'));
});
afterEach(async () => {
  await act(async () => { chatSubmissionQueue.cancelAll(); root.unmount(); });
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('composer submission', () => {
  it.each([
    [null, 'primary'], ['existing', 'primary'], [null, 'secondary'],
  ])('requests a reply for images alone (session %s, pane %s)', async (id, pane) => {
    await mount(id, pane);
    await stage([png('first.png'), png('second.png')]);
    await send(' \n ');
    await finished();
    const target = id || 'created';
    const request = api.streamChat.mock.calls[0][0];
    expect(request).toMatchObject({ sessionId: target, model: 'vision' });
    expect(request.messages).toHaveLength(2);
    expect(request.messages.every(message => message.role === 'user' && message.images.length === 1)).toBe(true);
    expect(request.messages.map(message => message.content)).toEqual([
      '[Image uploaded: first.png (0 KB)]', '[Image uploaded: second.png (0 KB)]',
    ]);
    expect(snapshot(target).messages.map(message => message.role)).toEqual(['user', 'user', 'assistant']);
    expect(snapshot(target).messages.at(-1).content).toBe('Image reaction');
    expect(document.querySelector('[aria-label="Pending attachments"]')).toBeNull();
    expect(store.state.toast).toBeUndefined();
  });

  it.each([null, 'existing'])('ignores an empty composer without creating a turn (session %s)', async id => {
    await mount(id); await send(' \n ');
    expect(api.createSession).not.toHaveBeenCalled();
    expect(api.appendSessionMessages).not.toHaveBeenCalled();
    expect(api.streamChat).not.toHaveBeenCalled();
  });

  it('keeps the typed prompt after its saved images in model context', async () => {
    await mount('existing'); await stage([png('photo.png')]); await send('What changed?'); await finished();
    const messages = api.streamChat.mock.calls[0][0].messages;
    expect(messages).toHaveLength(2);
    expect(messages[0].images).toHaveLength(1);
    expect(messages[1]).toEqual({ role: 'user', content: 'What changed?' });
    expect(snapshot('existing').messages.map(message => message.role)).toEqual(['user', 'user', 'assistant']);
  });

  it('queues an image-only follow-up after the earlier reply and ends its context with those images', async () => {
    await mount('existing');
    let release;
    api.streamChat.mockImplementationOnce(() => new Promise(resolve => {
      release = () => resolve(new Response('data: {"token":"Earlier reply","done":true}\n\n'));
    }));
    await send('Earlier request');
    await stage([png('follow-up.png')]); await send();
    expect(chatSubmissionQueue.getSnapshot().map(job => job.label)).toEqual(['Earlier request', 'Attachments']);
    await act(async () => release()); await finished(2);
    const messages = api.streamChat.mock.calls[1][0].messages;
    expect(messages.at(-1)).toMatchObject({ role: 'user', content: '[Image uploaded: follow-up.png (0 KB)]' });
    expect(messages.at(-1).images).toHaveLength(1);
    expect(messages.filter(message => message.images?.length)).toHaveLength(1);
    expect(messages.some(message => message.role === 'assistant' && message.content === 'Earlier reply')).toBe(true);
    expect(snapshot('existing').messages.filter(message => message.images?.length)).toHaveLength(1);
  });

  it('retains failed attachments and does not request a reply until retry succeeds', async () => {
    await mount('existing'); await stage([png('retry.png')]);
    api.appendSessionMessages.mockRejectedValueOnce(new Error('Disk full'));
    await send();
    expect(api.streamChat).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="Pending attachments"]')).not.toBeNull();
    expect(store.state.toast.message).toBe('Disk full');
    await send(); await finished();
    expect(snapshot('existing').messages).toHaveLength(2);
  });

  it('keeps the original target if the user navigates during an image save', async () => {
    await mount('existing'); await stage([png('photo.png')]);
    const append = api.appendSessionMessages.getMockImplementation();
    let release;
    api.appendSessionMessages.mockImplementationOnce((...args) => new Promise(resolve => {
      release = async () => resolve(await append(...args));
    }));
    await send();
    await act(async () => store.dispatch({ type: 'SET_SESSION', payload: { id: 'different', title: 'Other', messages: [] } }));
    await act(async () => release());
    expect(api.streamChat).not.toHaveBeenCalled();
    expect(snapshot('existing').messages[0].images).toHaveLength(1);
    expect(store.state.currentSessionId).toBe('different');
  });
});
