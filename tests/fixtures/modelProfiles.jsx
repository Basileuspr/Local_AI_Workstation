import './workspaceControlsBackend';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import '../../src/styles.css';
import '../../src/components/WorkspaceControls.css';

const models = [
  { name: 'Reasoning model', digest: 'r1', size: 12.8e9, parameter_size: '20B', quantization_level: 'MXFP4', context_length: 8192, trained_context_length: 131072,
    capabilities: ['completion', 'thinking', 'tools'], chat_profile: { contextWindow: 8192, maxContext: 131072, responseLength: 2048, thinking: 'medium', thinkingChoices: ['low', 'medium', 'high'] } },
  { name: 'Small model', digest: 's1', size: 2.1e9, context_length: 4096, trained_context_length: 4096,
    capabilities: ['completion'], chat_profile: { contextWindow: 4096, maxContext: 4096, responseLength: 1024, thinking: null, thinkingChoices: [] } },
];
window.modelProfileQA = { requests: [], sessions: {} };
const fallback = window.fetch;
window.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  const qa = window.modelProfileQA, body = options.body ? JSON.parse(options.body) : {};
  if (url.pathname === '/models') return json({ models });
  if (url.pathname === '/status') return json({ backend: { ok: true }, ollama: { reachable: true }, models: { chat_count: 2, embedding_ready: true }, knowledge_base: { ok: true, documents: 0 } });
  if (url.pathname === '/sessions/list') return json({ sessions: Object.values(qa.sessions) });
  if (url.pathname === '/sessions/new') {
    const id = `profile-chat-${Object.keys(qa.sessions).length + 1}`;
    qa.sessions[id] = { id, title: 'Profile check', messages: [], revision: 'v1' };
    return json(qa.sessions[id]);
  }
  if (/^\/sessions\/profile-chat-\d+\/messages\/append$/.test(url.pathname)) {
    const session = qa.sessions[url.pathname.split('/')[2]];
    session.messages.push(...body.messages); session.model = body.model;
    return json(session);
  }
  if (/^\/sessions\/profile-chat-\d+(\/metadata)?$/.test(url.pathname)) {
    const session = qa.sessions[url.pathname.split('/')[2]];
    if (options.method !== 'GET') Object.assign(session, body);
    return json(session);
  }
  if (url.pathname === '/chat') {
    qa.requests.push(body);
    const usage = { model: body.model, count_kind: 'provider_reported', prompt_tokens: 420, generated_tokens: 80,
      configured_context_limit: body.options.num_ctx, generation_tokens_per_second: 25, thinking_requested: body.think };
    return new Response(`data: ${JSON.stringify({ token: 'Profile request received.', done: true, context_usage: usage })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  }
  return fallback(input, options);
};
createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
