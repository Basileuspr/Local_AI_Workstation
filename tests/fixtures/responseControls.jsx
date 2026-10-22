import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider, useDispatch, useStore } from '../../src/useStore';
import Header from '../../src/components/Header';
import SettingsPanel from '../../src/components/SettingsPanel';
import MarkdownMessage from '../../src/components/MarkdownMessage';
import CodeMessage from '../../src/components/CodeMessage';
import '../../src/styles.css';
import '../../src/components/WorkspaceControls.css';

// All requests and clipboard writes are intercepted; no app data or clipboard changes.
window.fetch = async () => new Response(JSON.stringify({ items: [], models: [], requests: [] }), { headers: { 'Content-Type': 'application/json' } });
window.responseControlQA = { copied: [], state: null };
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.responseControlQA.copied.push(value); } } });
const source = '```javascript\n' + Array.from({length: 60}, (_, index) => `  const value${index} = "${'sample '.repeat(15)}";`).join('\n') + '\n```';
function Preview() {
  const state = useStore(), dispatch = useDispatch(), [phone, setPhone] = useState(false);
  useEffect(() => {
    dispatch({ type: 'SET_MODELS', payload: [{ name: 'fixture', contextLength: 8192 }] });
    dispatch({ type: 'SET_SELECTED_MODEL', payload: 'fixture' });
  }, [dispatch]);
  window.responseControlQA.state = { responseLength: state.responseLength, numPredict: state.numPredict };
  return <div id="app"><main id="main" style={{ overflow: 'auto', width: '100%' }}><div data-capture-tab="chats" className="chat-pane">
    <Header /><SettingsPanel /><div style={{ padding: 16 }}><button onClick={() => setPhone(value => !value)}>{phone ? 'Desktop renderer' : 'Phone renderer'}</button>
      {phone ? <CodeMessage>{source}</CodeMessage> : <MarkdownMessage>{source}</MarkdownMessage>}
    </div></div></main></div>;
}
createRoot(document.getElementById('root')).render(<StoreProvider><Preview /></StoreProvider>);
