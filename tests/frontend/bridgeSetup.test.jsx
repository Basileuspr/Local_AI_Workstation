import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PCBridge from "../../src/components/PCBridge";
import { bridgeRequest } from "../../src/bridgeApi";

let observer, root, document;
vi.mock("../../src/bridgeApi", async importOriginal => ({ ...await importOriginal(), bridgeRequest: vi.fn() }));
vi.mock("../../src/polling", () => ({ createPollingObserver: () => ({ subscribe: handlers => { observer = handlers; return () => {}; } }) }));
const status = { running: false, name: "Desktop", listen: { address: "", port: 8765 }, peers: [], network: { addresses: [{ name: "Wi-Fi", address: "192.168.1.20" }] } };
beforeEach(async () => {
  const dom = parseHTML('<html><body><main id="root"></main></body></html>');
  document = dom.document;
  vi.stubGlobal("window", dom.window); vi.stubGlobal("document", document); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  bridgeRequest.mockReset();
  bridgeRequest.mockImplementation(async path => path === "/jobs" ? { jobs: [] } : status);
  root = createRoot(document.getElementById("root"));
  await act(async () => root.render(<PCBridge />));
  await act(async () => observer.data({ next: status, history: { jobs: [] } }));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
const button = text => [...document.querySelectorAll("button")].find(item => item.textContent === text);

it("lets users start with a detected address without typing network details", async () => {
  expect(button("Start bridge").disabled).toBe(true);
  await act(async () => button("Wi-Fi · 192.168.1.20").click());
  expect(button("Start bridge").disabled).toBe(false);
  expect(button("Wi-Fi · 192.168.1.20").getAttribute("aria-pressed")).toBe("true");
  await act(async () => button("Start bridge").click());
  expect(bridgeRequest).toHaveBeenCalledWith("/start", "POST", { address: "192.168.1.20", port: 8765, name: "Desktop" });
});
it("explains the next step and blocks remote checks while the listener is off", async () => {
  expect(document.body.textContent).toContain("Start the bridge on both PCs to send tasks");
  expect(button("Check models and availability").disabled).toBe(true);
  expect(button("Send task to selected PC").disabled).toBe(true);
  await act(async () => observer.data({ next: { ...status, running: true }, history: { jobs: [] } }));
  expect(document.body.textContent).toContain("Pair another PC using an invitation below.");
  expect(button("Wi-Fi · 192.168.1.20").disabled).toBe(true);
  await act(async () => observer.error(new Error("Offline")));
  expect(document.body.textContent).toContain("Wait for bridge status to recover");
});
