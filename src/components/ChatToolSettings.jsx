import { useEffect, useState } from 'react';
import { useDispatch, useStore } from '../useStore';
import { fetchToolRegistry } from '../toolRegistry';
import './ChatTools.css';

export const defaultChatTools = ['system_stats', 'runtime_status', 'chat_models', 'knowledge_list', 'knowledge_search', 'knowledge_read'];

export default function ChatToolSettings() {
  const state = useStore(), dispatch = useDispatch();
  const [tools, setTools] = useState([]), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    if (state.toolUseEnabled) fetchToolRegistry({signal: controller.signal}).then(registry => {
      setTools(registry.tools.filter(tool => tool.llm_callable)); setError('');
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [state.toolUseEnabled]);
  const selected = state.chatToolIds || defaultChatTools;
  function set(key, value) { dispatch({type: 'SET_PARAM', key, value}); }
  return <section className="chat-tool-settings">
    <label><input type="checkbox" checked={!!state.toolUseEnabled} onChange={event => set('toolUseEnabled', event.target.checked)} /> Local model tool use</label>
    <p>Choose a model supporting tools. Selected read tools run during chat. Actions that change data require review. Up to 16 tools and 8 calls per reply.</p>
    {error && <p role="alert">{error}</p>}
    {state.toolUseEnabled && <details><summary>Selected tools ({selected.length})</summary>
      {tools.map(tool => <label key={tool.id} style={{display:'block'}}><input type="checkbox" checked={selected.includes(tool.id)}
        disabled={!selected.includes(tool.id) && selected.length >= 16}
        onChange={event => set('chatToolIds', event.target.checked ? [...selected, tool.id] : selected.filter(id => id !== tool.id))} />
        {tool.name}{tool.execution?.requires_review ? ' · Review required' : ''}</label>)}
    </details>}
  </section>;
}
