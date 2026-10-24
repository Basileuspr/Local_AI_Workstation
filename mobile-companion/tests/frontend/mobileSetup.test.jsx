import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, expect, it, vi } from "vitest";
import MobileCompanion from "../../desktop/MobileCompanion";

let root;
vi.mock('qrcode', () => ({ toDataURL: vi.fn(async () => 'data:image/png;base64,fixture') }));
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; vi.useRealTimers(); vi.unstubAllGlobals(); });
it("restores private setup without starting a listener until explicitly clicked", async () => {
  const dom = parseHTML('<html><body><main id="root"></main></body></html>');
  vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.document); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const listen = { origin: "https://desktop.example.ts.net", address: "127.0.0.1", port: 8766, certificate: "", private_key: "" };
  const fetch = vi.fn(async (_url, options) => new Response(JSON.stringify({ running: options.method === "POST", build_ready: true, devices: [], listen })));
  vi.stubGlobal("fetch", fetch);
  root = createRoot(dom.document.getElementById("root"));
  await act(async () => root.render(<MobileCompanion />));
  expect(fetch).not.toHaveBeenCalled();
  const button = text => [...dom.document.querySelectorAll("button")].find(button => button.textContent === text);
  await act(async () => button("Show mobile controls").click());
  expect(fetch.mock.calls.every(([, options]) => options.method === "GET")).toBe(true);
  expect(dom.document.querySelector("input").value).toBe(listen.origin);
  expect(button("Create phone invitation").disabled).toBe(true);
  await act(async () => button("Start mobile connection").click());
  const [url, options] = fetch.mock.calls.find(([, options]) => options.method === "POST");
  expect(url).toContain("/mobile/start");
  expect(JSON.parse(options.body)).toEqual(listen);
});

it('builds a phone update only on click and displays device version feedback', async () => {
  const dom = parseHTML('<html><body><main id="root"></main></body></html>');
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const version = 'b'.repeat(24);
  const snapshot = {running: true, build_ready: true, origin: 'https://desktop.example.ts.net',
    client_update: {phase: 'idle', can_build: true, version},
    devices: [{id: 'fixture-phone', name: 'Phone', enabled: true, client_version: 'a'.repeat(24), last_seen: Date.now()/1000}]};
  const fetch = vi.fn(async (_url, options) => new Response(JSON.stringify(options.method === 'POST' ?
    {...snapshot, client_update: {...snapshot.client_update, phase: 'building', message: 'Building the phone update.'}} : snapshot)));
  vi.stubGlobal('fetch', fetch);
  root = createRoot(dom.document.getElementById('root'));
  await act(async () => root.render(<MobileCompanion />));
  const button = text => [...dom.document.querySelectorAll('button')].find(item => item.textContent === text);
  await act(async () => button('Show mobile controls').click());
  expect(fetch.mock.calls.every(([,options]) => options.method === 'GET')).toBe(true);
  expect(dom.document.body.textContent).toContain('Update available on phone');
  await act(async () => button('Update phone app').click());
  expect(fetch.mock.calls.find(([,options]) => options.method === 'POST')[0]).toContain('/mobile/client-update');
  expect(button('Building phone update…').disabled).toBe(true);
});

it('keeps a new QR invitation when an older poll arrives, then clears it when consumed', async () => {
  vi.useFakeTimers();
  const dom = parseHTML('<html><body><main id="root"></main></body></html>');
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const snapshot = { running: true, build_ready: true, origin: 'https://desktop.example.ts.net', invitation: null };
  const invitation = { code: 'a'.repeat(32), id: 'invitation', expires_at: Date.now() / 1000 + 300 };
  let old;
  const mobileFetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(snapshot)))
    .mockImplementationOnce(() => new Promise(resolve => { old = resolve; }))
    .mockResolvedValueOnce(new Response(JSON.stringify(invitation)))
    .mockImplementation(async () => new Response(JSON.stringify(snapshot)));
  const fetch = vi.fn((url, options) => String(url).includes('/tailscale-status')
    ? Promise.resolve(new Response(JSON.stringify({state: 'missing', message: 'Tailscale is not installed.'}))) : mobileFetch(url, options));
  vi.stubGlobal('fetch', fetch);
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(<MobileCompanion />));
  const click = async text => act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === text).click());
  await click('Show mobile controls');
  await act(async () => vi.advanceTimersByTimeAsync(4001));
  await click('Create phone invitation');
  expect(document.querySelector('[aria-label="Phone pairing link"]').value).toBe(snapshot.origin + '/#pair=' + invitation.code);
  expect(document.querySelector('img[alt="Single-use phone pairing QR code"]')).not.toBeNull();
  await act(async () => old(new Response(JSON.stringify(snapshot))));
  expect(document.querySelector('[aria-label="Phone invitation"]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(4001));
  expect(document.querySelector('[aria-label="Phone invitation"]')).toBeNull();
});

const detected = (name = 'desktop') => ({state: 'connected', connections: [], serve_ready: false,
  suggested_origin: `https://${name}.example.ts.net`, message: 'Tailscale connected; HTTPS Serve still needs setup.'});

async function setupTailscale(getDetection, snapshot = {}) {
  vi.useFakeTimers();
  const dom = parseHTML('<html><body><main id="root"></main></body></html>');
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const listen = {origin: 'https://saved.example.ts.net', address: '127.0.0.1', port: 8766};
  const fetch = vi.fn(async (url, options) => new Response(JSON.stringify(String(url).includes('/tailscale-status')
    ? await getDetection(options) : {running: false, build_ready: true, listen, ...snapshot})));
  vi.stubGlobal('fetch', fetch);
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(<MobileCompanion />));
  const button = text => [...document.querySelectorAll('button')].find(item => item.textContent === text);
  const click = text => act(async () => button(text).click());
  await click('Show mobile controls');
  return {fetch, button, click, field: () => document.querySelector('.bridge-fields input'),
    detections: () => fetch.mock.calls.filter(([url]) => String(url).includes('/tailscale-status'))};
}

it('observes connect, disconnect and renamed addresses without replacing the saved form until clicked', async () => {
  let state = {state: 'login_required', message: 'Sign in to Tailscale.'};
  const ui = await setupTailscale(() => state);
  expect(ui.button('Use Tailscale HTTPS address').disabled).toBe(true);
  expect(ui.field().value).toBe('https://saved.example.ts.net');
  state = detected();
  await act(async () => vi.advanceTimersByTimeAsync(5001));
  expect(ui.button('Use Tailscale HTTPS address').disabled).toBe(false);
  expect(ui.field().value).toBe('https://saved.example.ts.net');
  // The connection changes after polling; the button must fetch the new name.
  state = detected('renamed');
  await ui.click('Use Tailscale HTTPS address');
  expect(ui.field().value).toBe('https://renamed.example.ts.net');
  expect(document.body.textContent).toContain('Serve still needs setup');
  state = {state: 'disconnected', message: 'Tailscale is disconnected.'};
  await act(async () => vi.advanceTimersByTimeAsync(5001));
  expect(ui.button('Use Tailscale HTTPS address').disabled).toBe(true);
  expect(ui.field().value).toBe('https://renamed.example.ts.net');
  expect(ui.fetch.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
});

it('rechecks on click and keeps the form when the connection disappears before the next poll', async () => {
  let state = detected();
  const ui = await setupTailscale(() => state);
  state = {state: 'disconnected', message: 'Tailscale is disconnected.'};
  await ui.click('Use Tailscale HTTPS address');
  expect(ui.field().value).toBe('https://saved.example.ts.net');
  expect(ui.button('Use Tailscale HTTPS address').disabled).toBe(true);
});

it('pauses detection in hidden controls and cleans up a pending request on deactivation', async () => {
  let finish, signal;
  const ui = await setupTailscale(options => {signal = options.signal; return new Promise(resolve => {finish = resolve;});});
  expect(ui.detections()).toHaveLength(1);
  await act(async () => root.render(<MobileCompanion active={false} />));
  expect(signal.aborted).toBe(true);
  await act(async () => finish(detected('stale')));
  await act(async () => vi.advanceTimersByTimeAsync(20000));
  expect(ui.detections()).toHaveLength(1);
  expect(ui.field().value).not.toContain('stale');
  await act(async () => root.render(<MobileCompanion />));
  expect(ui.detections()).toHaveLength(2);
  await ui.click('Hide mobile controls');
  const count = ui.detections().length;
  await act(async () => vi.advanceTimersByTimeAsync(20000));
  expect(ui.detections()).toHaveLength(count);
});

it('refreshes on focus, skips hidden windows and does not overlap status requests', async () => {
  let finish, delayed = false;
  const ui = await setupTailscale(() => delayed ? new Promise(resolve => {finish = resolve;}) : detected());
  Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'hidden'});
  await act(async () => vi.advanceTimersByTimeAsync(10001));
  expect(ui.detections()).toHaveLength(1);
  Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'visible'});
  delayed = true;
  await act(async () => window.dispatchEvent(new window.Event('focus')));
  await act(async () => window.dispatchEvent(new window.Event('online')));
  expect(ui.detections()).toHaveLength(2);
  await act(async () => finish(detected('new')));
  expect(ui.field().value).toBe('https://saved.example.ts.net');
});

it('disables address changes while the mobile gateway is running', async () => {
  const ui = await setupTailscale(() => detected(), {running: true, origin: 'https://saved.example.ts.net'});
  expect(ui.button('Use Tailscale HTTPS address').disabled).toBe(true);
  expect(ui.field().disabled).toBe(true);
});

it('lets the user choose among current Serve ports and rechecks that choice', async () => {
  const first = {origin: 'https://desktop.example.ts.net:443', address: '127.0.0.1', port: 8766};
  const second = {...first, origin: 'https://desktop.example.ts.net:8443'};
  let state = {...detected(), suggested_origin: '', serve_ready: true, connections: [first, second]};
  const ui = await setupTailscale(() => state);
  await ui.click('Use Tailscale HTTPS address');
  expect(ui.field().value).toBe('https://saved.example.ts.net');
  await ui.click('Use ' + second.origin);
  expect(ui.field().value).toBe(second.origin);
  state = {...state, connections: [second]};
  await ui.click('Use ' + first.origin);
  expect(ui.field().value).toBe(second.origin);
});

it('ignores a slow status response from before an explicit address refresh', async () => {
  let finish, calls = 0;
  const ui = await setupTailscale(() => ++calls === 2 ? new Promise(resolve => {finish = resolve;}) : detected('current'));
  await act(async () => vi.advanceTimersByTimeAsync(5001));
  await ui.click('Use Tailscale HTTPS address');
  await act(async () => finish({state: 'disconnected', message: 'Old disconnected response'}));
  expect(ui.field().value).toBe('https://current.example.ts.net');
  expect(ui.button('Use Tailscale HTTPS address').disabled).toBe(false);
  expect(document.body.textContent).not.toContain('Old disconnected response');
});
