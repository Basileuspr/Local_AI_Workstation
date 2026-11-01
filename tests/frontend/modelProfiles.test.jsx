import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { reducer } from '../../src/useStore';
import { modelProfileKey } from '../../src/modelProfiles';
import { pickPreferences } from '../../src/preferences';
import { getContextUsage, buildContextMessages, rotateContextMemory } from '../../src/contextMemory';
import ModelStatus from '../../src/components/ModelStatus';

const models = [
  { name: 'reasoner', digest: 'v1', contextLength: 8192, trained_context_length: 131072, capabilities: ['completion','tools','thinking'],
    chat_profile: { contextWindow: 8192, maxContext: 131072, thinking: 'medium', thinkingChoices: ['low','medium','high'], responseLength: 2048 } },
  { name: 'small', digest: 's1', contextLength: 4096, trained_context_length: 4096, capabilities: ['completion'],
    chat_profile: { contextWindow: 4096, maxContext: 4096, thinking: null, thinkingChoices: [], responseLength: 1024 } },
];
const select = (state, name) => reducer(state, { type: 'SET_SELECTED_MODEL', payload: name });
const initial = () => reducer({ models: [], modelProfiles: {}, selectedModel: '' }, { type: 'SET_MODELS', payload: models });

it('switches context, thinking, output and sampling together and restores the saved installed-model profile', () => {
  let state = select(initial(), 'reasoner');
  expect(state).toMatchObject({ contextWindow: 8192, thinking: 'medium', responseLength: 2048 });
  state = reducer(state, { type: 'SET_PARAM', key: 'contextWindow', value: 16384 });
  state = reducer(state, { type: 'SET_PARAM', key: 'thinking', value: 'high' });
  state = reducer(state, { type: 'SET_PARAM', key: 'temperature', value: .2 });
  state = reducer(state, { type: 'SET_RESPONSE_LENGTH', payload: 4096 });
  state = select(state, 'small');
  expect(state).toMatchObject({ contextWindow: 4096, thinking: null, responseLength: 1024, temperature: .7 });
  state = reducer(state, { type: 'SET_RESPONSE_LENGTH', payload: 8192 });
  expect(state.responseLength).toBe(2048);
  expect(select(state, 'reasoner')).toMatchObject({ contextWindow: 16384, thinking: 'high', responseLength: 4096, temperature: .2 });
  const restored = reducer({ ...pickPreferences(state), models: [] }, { type: 'SET_MODELS', payload: models });
  expect(select(restored, 'reasoner')).toMatchObject({ contextWindow: 16384, thinking: 'high', responseLength: 4096 });
});

it('session loading applies its model profile; new model weights do not inherit stale settings', () => {
  let state = select(initial(), 'reasoner');
  state = reducer(state, { type: 'SET_PARAM', key: 'contextWindow', value: 65536 });
  state = reducer(state, { type: 'SET_SESSION', payload: { id: 'session', messages: [], selectedModel: 'small' } });
  expect(state.contextWindow).toBe(4096);
  state = select(state, 'reasoner');
  const changed = [{ ...models[0], digest: 'v2' }, models[1]];
  state = reducer(state, { type: 'SET_MODELS', payload: changed });
  expect(state.contextWindow).toBe(8192);
  expect(state.modelProfiles[modelProfileKey(models[0])].contextWindow).toBe(65536);
});

it('bounds smaller windows and resets only the selected model', () => {
  let state = select(initial(), 'reasoner');
  state = reducer(state, { type: 'SET_RESPONSE_LENGTH', payload: 3000 });
  state = select(state, 'small');
  state = reducer(state, { type: 'SET_PARAM', key: 'contextWindow', value: 32768 });
  state = reducer(state, { type: 'SET_PARAM', key: 'thinking', value: 'high' });
  expect(state).toMatchObject({ contextWindow: 4096, thinking: null });
  state = reducer(state, { type: 'RESET_MODEL_PROFILE' });
  expect(select(state, 'reasoner').responseLength).toBe(3000);
});

it('uses earlier original turns when a switched profile has room without erasing the saved summary', async () => {
  const messages = Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'Detailed fact. '.repeat(180) }));
  const args = { messages, memorySummary: 'Earlier summary', summarizedMessageCount: 6, responseLength: 1024, restoreHistory: true };
  expect(getContextUsage({ ...args, contextWindow: 4096 }).restoredHistory).toBe(false);
  const usage = getContextUsage({ ...args, contextWindow: 16384 });
  expect(usage.restoredHistory).toBe(true);
  expect(buildContextMessages(messages, args.memorySummary, 6, { ...args, contextWindow: 16384 })).toEqual(messages);
  const result = await rotateContextMemory({ ...args, contextWindow: 16384, api: { compactMemory: () => { throw Error('Should fit'); } } });
  expect(result.memorySummary).toBe('Earlier summary');
  expect(result.summarizedMessageCount).toBe(6);
});

it('does not compact a modest chat simply because Knowledge and saved memory are enabled', async () => {
  const messages = Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'fact '.repeat(150) }));
  const result = await rotateContextMemory({ messages, contextWindow: 8192, responseLength: 1024, useKnowledgeBase: true, useDurableMemory: true,
    api: { compactMemory: () => { throw Error('Premature compaction'); } } });
  expect(result.summarizedMessageCount).toBe(0);
  expect(result.usage.usableInputTokens).toBe(6656);
  expect(getContextUsage({ messages: [], contextWindow: 4096, responseLength: 1024, useKnowledgeBase: true }).usableInputTokens).toBe(2560);
});

it('plain text distinguishes next-request settings, model ceilings and actual matching-model receipts', () => {
  const usage = getContextUsage({ messages: [], contextWindow: 16384, responseLength: 2048 });
  const messages = [{ context_usage: { model: 'reasoner', configured_context_limit: 8192, prompt_tokens: 500, generated_tokens: 100,
    count_kind: 'provider_reported', generation_tokens_per_second: 20, thinking_requested: false, thinking_emitted: true } },
    { context_usage: { model: 'other', prompt_tokens: 99999 } }];
  const html = renderToStaticMarkup(<ModelStatus model={models[0]} usage={usage} thinking="medium" messages={messages}/>);
  for (const text of ['16,384 context tokens', '131,072 tokens', '2,048 output tokens', 'Medium (requested)', '500 prompt tokens', '20.0 tokens/s', 'despite the Off request']) expect(html).toContain(text);
  expect(html).not.toContain('99,999');
});
