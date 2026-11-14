import './workspaceControlsBackend';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider, useStore, useDispatch } from '../../src/useStore';
import { ChatWorkspaceProvider, useChatWorkspace } from '../../src/ChatWorkspace';
import DeferredWorkspace from '../../src/components/DeferredWorkspace';
import { MessageMarkdown } from '../../src/components/MessageList';

const qa = window.hardeningQA = { mounts: 0, unmounts: 0, oldContentReads: 0 };
const previous = { id: 'previous', role: 'assistant', get content() { qa.oldContentReads++; return '- [ ] Preserved checklist'; } };
const preview = () => {};
function Draft() {
  const [text, setText] = useState('');
  useEffect(() => { qa.mounts++; return () => { qa.unmounts++; }; }, []);
  return <textarea id="draft" value={text} onChange={event => setText(event.target.value)} />;
}
function Fixture() {
  const [active, setActive] = useState(false), [tick, setTick] = useState(0);
  const state = useStore(), dispatch = useDispatch(), workspace = useChatWorkspace();
  useEffect(() => {
    dispatch({ type: 'PUSH_MESSAGE', payload: previous });
    dispatch({ type: 'PUSH_MESSAGE', payload: { id: 'stream', role: 'assistant', content: 'Start' } });
  }, []);
  return <>
    <button id="toggle" onClick={() => setActive(value => !value)}>Toggle workspace</button>
    <section hidden={!active}><DeferredWorkspace active={active}><Draft /></DeferredWorkspace></section>
    <button id="stream" onClick={() => { setTick(value => value + 1); dispatch({ type: 'UPDATE_STREAMING_MESSAGE', sessionId: null, messageId: 'stream', content: `Reply ${tick + 1}` }); }}>Stream</button>
    <output id="ticks">{tick}</output><output id="pin">{workspace.pin?.messageId}</output>
    {state.conversationHistory.map(message => <article key={message.id} id={message.id}><MessageMarkdown message={message} messageId={message.id} sessionId="fixture" streaming={message.id === 'stream'} onImagePreview={preview} /></article>)}
  </>;
}
createRoot(document.getElementById('root')).render(<StoreProvider><ChatWorkspaceProvider remember={false}><Fixture /></ChatWorkspaceProvider></StoreProvider>);
