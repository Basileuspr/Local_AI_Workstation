import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, expect, it, vi } from "vitest";
import MobileCompanion from "../../src/components/MobileCompanion";

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
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(snapshot)))
    .mockImplementationOnce(() => new Promise(resolve => { old = resolve; }))
    .mockResolvedValueOnce(new Response(JSON.stringify(invitation)))
    .mockImplementation(async () => new Response(JSON.stringify(snapshot)));
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
