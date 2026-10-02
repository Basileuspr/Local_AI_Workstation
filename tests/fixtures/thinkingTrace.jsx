import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider, useDispatch, useStore } from '../../src/useStore';
import Header from '../../src/components/Header';
import '../../src/styles.css';

// UI-only fixture. Synthetic traces; no user history, model inference or terminal.
let trace = '', revision = 'preview', failExport = false;
window.fetch = async input => {
  const url = new URL(input, location.href);
  if (url.pathname === '/thinking/trace') {
    const offset = url.searchParams.get('revision') === revision ? Number(url.searchParams.get('offset')) : 0;
    return Response.json({ content: trace.slice(offset), offset, next_offset: trace.length, revision, more: false });
  }
  if (url.pathname === '/thinking/export') return failExport ? new Response('Unavailable', { status: 503 }) : new Response(trace);
  if (url.pathname === '/thinking/open-terminal') return Response.json({ opened: false, error: 'Terminal disabled in UI preview' });
  return Response.json({ documents: [], models: [] });
};
function Preview() {
  const dispatch = useDispatch(), state = useStore();
  const [status, setStatus] = useState('Empty preview');
  useEffect(() => {
    dispatch({ type: 'SET_MODELS', payload: [{ name: 'qwen3.5:9b', capabilities: ['completion', 'thinking'] }] });
    dispatch({ type: 'SET_SELECTED_MODEL', payload: 'qwen3.5:9b' });
  }, [dispatch]);
  return <div id="app"><main id="main" style={{ width: '100%' }}>
    <Header />
    <div style={{ padding: 28 }}>
      <h2>Thinking trace · UI preview</h2><p>Synthetic data. Chat draft and controls remain in place when the viewer closes.</p>
      <textarea aria-label="Chat draft" defaultValue="Keep this unfinished message." style={{ width: '90%', padding: 12 }} />
      <p><button onClick={() => { trace += '\n2026-10-02 | model: qwen3.5:9b\n' + Array.from({length: 45}, (_, i) => `Sample step ${i + 1}: recorded model output 🧠\n`).join('') + '[Response complete]\n\nmodel: mistral:latest\n[No thinking trace was emitted by this model for this response.]\n[Response complete]\n'; setStatus('Sample history ready'); }}>Add sample history</button>{' '}
      <button onClick={() => { trace = ''; revision += 'r'; setStatus('History reset'); }}>Reset sample history</button>{' '}
      <button onClick={() => { failExport = !failExport; dispatch({type:'HIDE_TOAST'}); setStatus(failExport ? 'Export failure enabled' : 'Exports restored'); }}>Toggle export failure</button></p>
      <p role="status">{status}</p>
      {state.toast && <p role="status">{state.toast.message}</p>}
    </div>
  </main></div>;
}
createRoot(document.getElementById('root')).render(<StoreProvider><Preview /></StoreProvider>);
