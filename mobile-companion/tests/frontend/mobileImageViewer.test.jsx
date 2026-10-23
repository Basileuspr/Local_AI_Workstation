import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, expect, it, vi } from "vitest";
import FullImage, { ZoomableImage } from "../../web/src/ImageViewer";
import Companion from "../../web/src/Companion";

let root, resize;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null; vi.useRealTimers(); vi.unstubAllGlobals();
});
async function mount(element = <ZoomableImage src="/api/media/library/example" alt="Example" />) {
  const dom = parseHTML('<html><body><main id="root"></main></body></html>');
  vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { constructor(callback) { resize = callback; } observe() {} disconnect() {} });
  dom.window.HTMLElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  dom.window.HTMLElement.prototype.setPointerCapture = vi.fn();
  root = createRoot(document.getElementById("root"));
  await act(async () => root.render(element));
  const viewport = document.querySelector(".image-zoom-viewport");
  if (!viewport) return;
  viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 400 });
  Object.defineProperties(viewport.querySelector("img"), { naturalWidth: { value: 1200 }, naturalHeight: { value: 800 } });
  return viewport;
}
async function pointer(type, id, x, y = 200) {
  const event = new window.Event(type, { bubbles: true });
  Object.assign(event, { pointerId: id, clientX: x, clientY: y, button: 0, pointerType: "touch" });
  await act(async () => document.querySelector(".image-zoom-viewport").dispatchEvent(event));
}
async function click(label) {
  await act(async () => [...document.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === label || button.textContent === label).click());
}
const transform = () => document.querySelector(".image-zoom-viewport img").style.transform;
const zoom = () => document.querySelector('[aria-label="Image zoom"]').textContent;

it("pinches around the fingers, then pans with the remaining finger within the visible image bounds", async () => {
  await mount();
  await pointer("pointerdown", 1, 100); await pointer("pointerdown", 2, 200);
  await pointer("pointermove", 1, 50); await pointer("pointermove", 2, 250);
  expect(zoom()).toBe("200%");
  expect(transform()).toBe("translate(0px, 0px) scale(2)");
  await pointer("pointerup", 2, 250); await pointer("pointermove", 1, 90, 300);
  expect(transform()).toBe("translate(40px, 0px) scale(2)");
  await pointer("pointermove", 1, 1000, 500);
  expect(transform()).toBe("translate(150px, 0px) scale(2)");
  await pointer("pointercancel", 1, 1000); await pointer("pointermove", 1, 0);
  expect(transform()).toBe("translate(150px, 0px) scale(2)");
});

it("keeps an off-center pinch focal point stable and safely handles lost capture", async () => {
  await mount();
  await pointer("pointerdown", 1, 150); await pointer("pointerdown", 2, 250);
  await pointer("pointermove", 1, 100); await pointer("pointermove", 2, 300);
  expect(transform()).toBe("translate(-50px, 0px) scale(2)");
  await pointer("lostpointercapture", 1, 100); await pointer("lostpointercapture", 2, 300);
  await pointer("pointermove", 2, 500);
  expect(zoom()).toBe("200%");
  await pointer("pointerdown", 3, 100); await pointer("pointermove", 3, 120);
  expect(transform()).toBe("translate(-30px, 0px) scale(2)");
});

it("limits zoom, resets to fit, and clears gestures after viewport or image changes", async () => {
  await mount();
  await click("Zoom in"); await click("Zoom in"); await click("Zoom in");
  expect(zoom()).toBe("800%");
  expect(document.querySelector('[aria-label="Zoom in"]').disabled).toBe(true);
  await pointer("pointerdown", 1, 140); await pointer("pointerdown", 2, 160);
  await pointer("pointermove", 1, 0);
  expect(zoom()).toBe("800%");
  await click("Fit");
  await pointer("pointermove", 1, 100);
  expect(transform()).toBe("translate(0px, 0px) scale(1)");
  expect(document.querySelector('[aria-label="Zoom out"]').disabled).toBe(true);
  await click("Zoom in");
  await act(async () => resize());
  expect(zoom()).toBe("100%");
  await click("Zoom in");
  await act(async () => root.render(<ZoomableImage src="/api/media/library/another" alt="Another" />));
  expect(zoom()).toBe("100%");
});

it("pinches back to fit without allowing the image to be dragged off screen", async () => {
  await mount();
  await click("Zoom in");
  await pointer("pointerdown", 1, 50); await pointer("pointerdown", 2, 250);
  await pointer("pointermove", 1, 140); await pointer("pointermove", 2, 160);
  expect(transform()).toBe("translate(0px, 0px) scale(1)");
  await pointer("pointerup", 2, 160); await pointer("pointermove", 1, 500);
  expect(transform()).toBe("translate(0px, 0px) scale(1)");
});

it("opens original bytes and preserves the APK download/share hooks and close control", async () => {
  const close = vi.fn();
  await mount(<FullImage item={{ name: "Example.png", url: "/api/media/library/example" }} onClose={close} />);
  expect(document.querySelector("dialog.viewer[open]")).toBeTruthy();
  expect(document.querySelector(".image-zoom-viewport img").getAttribute("src")).toBe("/api/media/library/example");
  expect(document.querySelector("a[download]").getAttribute("href")).toBe("/api/media/library/example?download=true");
  expect(document.body.textContent).toContain("Prepare to share");
  await click("Close image");
  expect(close).toHaveBeenCalledOnce();
});

it("opens the same zoomable original from chat and gallery instead of downloading on a thumbnail tap", async () => {
  vi.useFakeTimers();
  const item = { id: "image", name: "Example.png", url: "/api/media/library/example" };
  vi.stubGlobal("fetch", vi.fn(async url => {
    let value;
    if (url === "/api/state") value = { sessions: [{ id: "chat", title: "Example chat" }], jobs: [] };
    else if (url === "/api/models") value = { chat_models: [] };
    else if (url === "/api/sessions/chat") value = { id: "chat", messages: [{ id: "message", role: "assistant", images: [item] }] };
    else if (url.startsWith("/api/gallery?")) value = { images: [item], total: 1 };
    else throw new Error(`Unexpected request: ${url}`);
    return new Response(JSON.stringify(value));
  }));
  await mount(<Companion />);
  await act(async () => {
    const select = document.querySelector(".session-picker select");
    Object.defineProperty(select, "value", { value: "chat", configurable: true });
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  expect(document.querySelector(".message a[download]")).toBeNull();
  await click("View Example.png");
  expect(document.querySelector("dialog.viewer[open] .image-zoom-viewport img").getAttribute("src")).toBe(item.url);
  await click("Close image");
  expect(document.querySelector("dialog")).toBeNull();
  await click("▧Gallery");
  await act(async () => vi.advanceTimersByTimeAsync(210));
  await click("View Example.png");
  expect(document.querySelector("dialog.viewer[open] .image-zoom-viewport img").getAttribute("src")).toBe(item.url);
  expect(zoom()).toBe("100%");
});
