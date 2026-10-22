import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { afterEach, expect, it, vi } from 'vitest';
import useFreshResource from '../../mobile/src/useFreshResource';
import Companion from '../../mobile/src/Companion';
import { androidPairingLink, consumePairingLink } from '../../mobile/src/pairing';

let root;
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; vi.useRealTimers(); vi.unstubAllGlobals(); });
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
async function mount(element, fetch) {
  vi.useFakeTimers();
  const dom = parseHTML('<html><body><main id="root"></main></body></html>');
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.document);
  vi.stubGlobal('navigator', { onLine: true }); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', fetch);
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(element));
}
function Resource({ path = '/api/session/a' }) {
  const { value, error } = useFreshResource(path);
  return <div>{value?.text || error?.message || 'Waiting'}</div>;
}
async function event(name) { await act(async () => window.dispatchEvent(new window.Event(name))); }

it('discards an old response after an offline/reconnect cycle and fetches again immediately', async () => {
  let old;
  await mount(<Resource />, vi.fn().mockImplementationOnce(() => new Promise(resolve => { old = resolve; })).mockResolvedValue(response({ text: 'Fresh' })));
  navigator.onLine = false; await event('offline');
  navigator.onLine = true; await event('online');
  expect(document.body.textContent).toBe('Fresh');
  await act(async () => old(response({ text: 'Stale' })));
  expect(document.body.textContent).toBe('Fresh');
});

it('clears data on failed refresh, backgrounding and authorization loss, including late responses', async () => {
  let late;
  const fetch = vi.fn().mockResolvedValueOnce(response({ text: 'Private' })).mockResolvedValueOnce(response({ detail: 'Unavailable' }, 503))
    .mockImplementationOnce(() => new Promise(resolve => { late = resolve; })).mockImplementation(async () => response({ text: 'Current' }));
  await mount(<Resource />, fetch);
  await act(async () => vi.advanceTimersByTimeAsync(2001));
  expect(document.body.textContent).not.toContain('Private');
  await event('pageshow'); await event('law-auth-lost');
  await act(async () => late(response({ text: 'Private again' })));
  expect(document.body.textContent).toContain('Pair this device');
  await event('pageshow'); expect(document.body.textContent).toBe('Current');
  await event('law-background'); expect(document.body.textContent).toBe('Waiting');
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(document.body.textContent).toBe('Waiting');
  await event('pageshow'); expect(document.body.textContent).toBe('Current');
});

it('prevents an old selected conversation returning after revocation', async () => {
  let late;
  await mount(<Companion />, vi.fn(async path => {
    if (path === '/api/state') return response({ sessions: [{ id: 'chat', title: 'Chat' }], jobs: [] });
    if (path === '/api/models') return response({ chat_models: [] });
    if (path === '/api/sessions/chat') return new Promise(resolve => { late = resolve; });
    throw Error(path);
  }));
  await act(async () => {
    const select = document.querySelector('.session-picker select');
    Object.defineProperty(select, 'value', { value: 'chat', configurable: true });
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await event('law-auth-lost');
  await act(async () => late(response({ id: 'chat', messages: [{ id: 'message', role: 'assistant', content: 'Private late answer' }] })));
  expect(document.querySelector('.pair')).not.toBeNull();
  expect(document.body.textContent).not.toContain('Private late answer');
});

it('keeps a scanned invitation through the initial unauthenticated check without automatically pairing', async () => {
  const code = 'a'.repeat(32), fetch = vi.fn(async () => response({ detail: 'Pair this device' }, 401));
  await mount(<Companion pairingCode={code} />, fetch);
  expect(document.querySelector('input[placeholder="Paste the invitation from your desktop"]').value).toBe(code);
  expect(fetch.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
});

it('scrubs QR fragments and restricts Android handoff to an explicit package and HTTPS origin', () => {
  const history = { replaceState: vi.fn() }, code = 'a'.repeat(32);
  expect(consumePairingLink({ hash: '#pair=' + code, pathname: '/', search: '' }, history)).toBe(code);
  expect(history.replaceState).toHaveBeenCalledWith(null, '', '/');
  expect(consumePairingLink({ hash: '#pair=bad&other=value', pathname: '/', search: '' }, history)).toBe('');
  expect(androidPairingLink('https://desktop.example.ts.net', code)).toBe(`intent://pair/https%3A%2F%2Fdesktop.example.ts.net/${code}#Intent;scheme=lawcompanion;package=com.localai.workstation.companion;end`);
  expect(androidPairingLink('https://user@desktop.example.ts.net', code)).toBe('');
  expect(androidPairingLink('http://desktop.example.ts.net', code)).toBe('');
});
