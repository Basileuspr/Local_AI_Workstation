import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, expect, it, vi } from "vitest";
import Companion from "../../web/src/Companion";

let root, jobs, submissions, fetchMock;
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null; vi.useRealTimers(); vi.unstubAllGlobals();
});
async function click(text) {
  await act(async () => [...document.querySelectorAll("button")].find(button => button.textContent === text).click());
}
async function submit() {
  await act(async () => document.querySelector(".generation").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
}
const generateButton = () => document.querySelector(".generation .primary");
function accept(url, options) {
  const payload = JSON.parse(options.body);
  const job = { id: url.split("/").at(-1), ...payload, status: "queued" };
  jobs.unshift(job);
  return response(job);
}
async function mount({ activeKind, send = accept } = {}) {
  vi.useFakeTimers();
  const dom = parseHTML('<html><body><main id="root"></main></body></html>');
  vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("EventSource", class { close() {} });
  jobs = activeKind ? [{ id: "existing", session_id: "chat", kind: activeKind, status: "running" }] : [];
  submissions = [];
  fetchMock = vi.fn(async (url, options) => {
    if (url === "/api/state") return response({ sessions: [{ id: "chat", title: "Existing conversation" }], jobs });
    if (url === "/api/models") return response({ chat_models: [{ id: "chat-model" }], image_models: [{ id: "image-model", recommended_settings: { prompt: "A scene" } }], image_runtime: { ready: true } });
    if (url === "/api/sessions/chat") return response({ id: "chat", revision: "current", messages: [] });
    if (url.startsWith("/api/jobs/") && options.method === "PUT") {
      submissions.push({ url, payload: JSON.parse(options.body) });
      return send(url, options);
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  root = createRoot(document.getElementById("root"));
  await act(async () => root.render(<Companion />));
  await act(async () => {
    const select = document.querySelector(".session-picker select");
    Object.defineProperty(select, "value", { value: "chat", configurable: true });
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  await click("✧Create");
  await click("Use model recommended settings");
}

it("queues multiple images in the selected conversation and stays on Create with the prompt retained", async () => {
  await mount({ activeKind: "image" });
  expect(generateButton().disabled).toBe(false);
  expect(generateButton().textContent).toBe("Queue another image ✧");
  await submit(); await submit();
  expect(submissions).toHaveLength(2);
  expect(submissions[0].url).not.toBe(submissions[1].url);
  expect(submissions.every(item => item.payload.session_id === "chat" && item.payload.prompt === "A scene")).toBe(true);
  expect(document.querySelector('[aria-label="Image prompt"]').value).toBe("A scene");
  expect(document.body.textContent).toContain("3 images pending in this conversation.");
  expect(generateButton().disabled).toBe(false);
  expect(fetchMock.mock.calls.some(([url, options]) => url === "/api/sessions" && options.method === "POST")).toBe(false);
  await click("View jobs");
  expect(document.querySelectorAll(".job")).toHaveLength(3);
});

it("blocks another submission until its delivery is acknowledged and retries with the same job ID", async () => {
  let finish;
  await mount({ send: () => new Promise(resolve => { finish = resolve; }) });
  await submit(); await submit();
  expect(submissions).toHaveLength(1);
  expect(generateButton().disabled).toBe(true);
  await act(async () => finish(response({ detail: "Connection uncertain" }, 503)));
  expect(generateButton().disabled).toBe(true);
  await act(async () => [...document.querySelectorAll("button")].find(button => button.textContent === "Retry same submission").click());
  expect(submissions).toHaveLength(2);
  expect(submissions[1]).toEqual(submissions[0]);
  await act(async () => finish(accept(submissions[0].url, { body: JSON.stringify(submissions[0].payload) })));
  expect(generateButton().disabled).toBe(false);
  expect(document.body.textContent).toContain("1 image pending in this conversation.");
});

it("keeps chat jobs exclusive and displays the server's queue-capacity error", async () => {
  await mount({ activeKind: "chat", send: () => response({ detail: "Bridge has eight outstanding jobs. Finish or cancel work first." }, 409) });
  expect(generateButton().disabled).toBe(true);
  expect(document.body.textContent).toContain("Wait for this conversation’s chat response");
  jobs = [];
  await act(async () => vi.advanceTimersByTimeAsync(2100));
  expect(generateButton().disabled).toBe(false);
  await submit();
  expect(document.querySelector('[role="alert"]').textContent).toContain("eight outstanding jobs");
  expect(submissions).toHaveLength(1);
});
