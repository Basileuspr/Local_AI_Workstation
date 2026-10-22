import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, expect, it, vi } from "vitest";
import { Gallery, defaultGalleryFilters } from "../../mobile/src/Companion";

let root;
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; vi.useRealTimers(); vi.unstubAllGlobals(); });

async function mount(fetch) {
  vi.useFakeTimers();
  const dom = parseHTML('<html><body><main id="root"></main></body></html>');
  vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("fetch", fetch);
  dom.window.HTMLElement.prototype.scrollIntoView = vi.fn();
  function Harness() {
    const [filters, setFilters] = useState(defaultGalleryFilters);
    const [visible, setVisible] = useState(true);
    return <><button onClick={() => setVisible(value => !value)}>Other tab</button>{visible && <Gallery online refreshKey={0} sessions={[{ id: "chat", title: "Nature" }]} filters={filters} onFiltersChange={setFilters} />}</>;
  }
  root = createRoot(dom.document.getElementById("root"));
  await act(async () => root.render(<Harness />));
  await settle();
}
async function settle() { await act(async () => { await vi.advanceTimersByTimeAsync(210); }); }
async function click(text) { await act(async () => [...document.querySelectorAll("button")].find(button => button.textContent === text).click()); }
async function choose(label, value) {
  await act(async () => {
    const field = document.querySelector(`[aria-label="${label}"]`);
    Object.defineProperty(field, "value", { value, configurable: true });
    field.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  await settle();
}
const response = (name = "Image.png", total = 49) => new Response(JSON.stringify({ images: [{ id: name, name, url: "/api/media/library/image" }], total }));

it("resets paging for filters, preserves choices across tabs, and clears incompatible conversation filters", async () => {
  const fetch = vi.fn(async () => response());
  await mount(fetch);
  const params = () => new URL(fetch.mock.calls.at(-1)[0], "https://fixture.test").searchParams;
  expect(params().get("sort")).toBe("newest");
  await click("Next"); await settle();
  expect(params().get("offset")).toBe("24");
  await choose("Sort images", "oldest");
  expect(params().get("offset")).toBe("0");
  await choose("Gallery conversation", "chat");
  expect(params().get("source")).toBe("session");
  expect(params().get("session_id")).toBe("chat");
  await choose("Image date range", "7");
  await click("Other tab"); await click("Other tab"); await settle();
  expect(params().get("days")).toBe("7");
  expect(params().get("sort")).toBe("oldest");
  await choose("Image source", "library");
  expect(params().get("session_id")).toBe("");
  expect(document.querySelector('[aria-label="Gallery conversation"]').disabled).toBe(true);
  await click("Clear filters"); await settle();
  expect(Object.fromEntries(params())).toEqual({ offset: "0", limit: "24", ...defaultGalleryFilters });
  await click("Next"); await settle();
  await click("Refresh images"); await settle();
  expect(params().get("offset")).toBe("0");
});

it("ignores late results from a superseded filter request", async () => {
  let finishOld;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; })).mockImplementation(async () => response("Filtered.png", 1));
  await mount(fetch);
  await choose("Image source", "library");
  expect(document.querySelector(".image-tile").textContent).toBe("Filtered.png");
  await act(async () => finishOld(response("Stale.png")));
  expect(document.querySelector(".image-tile").textContent).toBe("Filtered.png");
});
