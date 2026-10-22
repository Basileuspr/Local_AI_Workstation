import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { afterEach, expect, it, vi } from 'vitest';
import CodeBlock from '../../src/components/CodeBlock';
import CodeMessage from '../../src/components/CodeMessage';
import MarkdownMessage from '../../src/components/MarkdownMessage';
import ResponseLengthControl from '../../src/components/ResponseLengthControl';
import { effectiveOutputBudget, normalizeResponseLength, validResponseLength } from '../../src/responseBudget';
import { reducer } from '../../src/useStore';
import { loadPreferences, pickPreferences, PREFERENCES_STORAGE_KEY } from '../../src/preferences';

let root;
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; vi.unstubAllGlobals(); });
async function mount(component) {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(component));
}

it('keeps an exact custom cap through both control paths and a saved-preference round trip', () => {
  let state = reducer({}, { type: 'SET_PARAM', key: 'numPredict', value: 1537 });
  expect(state).toMatchObject({ numPredict: 1537, responseLength: 1537 });
  state = reducer(state, { type: 'SET_RESPONSE_LENGTH', payload: 3001 });
  expect(state).toMatchObject({ numPredict: 3001, responseLength: 3001 });
  const saved = JSON.stringify(pickPreferences(state));
  const storage = { getItem: key => key === PREFERENCES_STORAGE_KEY ? saved : null };
  vi.stubGlobal('window', { localStorage: storage }); vi.stubGlobal('localStorage', storage);
  expect(loadPreferences()).toMatchObject({ numPredict: 3001, responseLength: 3001 });
  expect(reducer(state, { type: 'SET_RESPONSE_LENGTH', payload: -1 })).toMatchObject({ numPredict: -1, responseLength: -1 });
  expect(reducer(state, { type: 'APPLY_PROFILE', payload: 'coding' })).toMatchObject({ numPredict: 4096, responseLength: 4096, activeProfile: 'coding' });
});

it.each([0, '', null, false, NaN, 1.5, 32769, -2])('rejects invalid output caps (%s) without changing the applied value', value => {
  expect(validResponseLength(value)).toBe(false);
  expect(normalizeResponseLength(value)).toBe(1024);
  const state = { responseLength: 1537 };
  expect(reducer(state, { type: 'SET_RESPONSE_LENGTH', payload: value })).toBe(state);
});

it('explains context reductions and automatic limits without promising word counts', () => {
  expect(effectiveOutputBudget(8192, 8192)).toBe(4096);
  expect(effectiveOutputBudget(-1, 32768)).toBe(2048);
  const html = renderToStaticMarkup(<ResponseLengthControl value={1537} contextWindow={2048} onChange={() => {}} />);
  expect(html).toContain('value="1537"');
  expect(html).toContain('up to 1,024 output tokens');
  expect(html).toContain('Tokens include thinking and answer text');
  expect(html).toContain('aria-label="Maximum output tokens"');
  expect(html).not.toContain('Unlimited');
});

it.each([CodeMessage, MarkdownMessage])('renders safe, independent boards for closed and still-streaming fences', Component => {
  const html = renderToStaticMarkup(<Component>{'Prose\n```html\n<script>alert(1)</script>\n```\nMore\n~~~py\n  print(2)'}</Component>);
  expect(html.match(/aria-label="Copy code"/g)).toHaveLength(2);
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).toContain('  print(2)');
});

it('updates only the streaming reply in its original chat without erasing adjacent messages', () => {
  const state = { currentSessionId: 'one', conversationHistory: [{ id: 'a', content: 'Keep' }, { id: 'b', content: '' }] };
  const action = { type: 'UPDATE_STREAMING_MESSAGE', sessionId: 'one', messageId: 'b', content: '```js\nlet x' };
  const next = reducer(state, action);
  expect(next.conversationHistory[0]).toBe(state.conversationHistory[0]);
  expect(next.conversationHistory[1].content).toBe(action.content);
  expect(reducer(state, { ...action, sessionId: 'another' })).toBe(state);
  expect(reducer(state, { ...action, messageId: 'missing' })).toBe(state);
});

it('copies only the current code, preserves whitespace, and reports clipboard denial honestly', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  await mount(<CodeBlock language="js" code={'  const x = 1;\n\n\treturn x;'} />);
  await act(async () => document.querySelector('button').click());
  expect(writeText).toHaveBeenLastCalledWith('  const x = 1;\n\n\treturn x;');
  expect(document.querySelector('[role=status]').textContent).toBe('Copied');
  await act(async () => root.render(<CodeBlock language="js" code="updated" />));
  expect(document.querySelector('[role=status]').textContent).toBe('');
  writeText.mockRejectedValueOnce(new Error('permission denied'));
  await act(async () => document.querySelector('button').click());
  expect(writeText).toHaveBeenLastCalledWith('updated');
  expect(document.querySelector('[role=status]').textContent).toContain('Copy unavailable');
  expect(document.querySelector('pre').textContent).toBe('updated');
});
