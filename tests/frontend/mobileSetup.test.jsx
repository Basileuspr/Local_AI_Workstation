import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, expect, it, vi } from "vitest";
import MobileCompanion from "../../src/components/MobileCompanion";

let root;
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; vi.unstubAllGlobals(); });
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
