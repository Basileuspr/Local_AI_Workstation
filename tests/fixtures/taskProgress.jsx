import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import ImageGenerationProgress from "../../src/components/ImageGenerationProgress";
import LoraAnalysisProgress from "../../src/components/LoraAnalysisProgress";
import { taskProgressCache } from "../../src/taskProgress";

// Synthetic worker reports only. No application backend or user data is used.
window.runTaskProgressQA = async () => {
  const routes = new Map();
  const requests = [];
  const actualNow = performance.now.bind(performance);
  let advance = 0;
  Object.defineProperty(performance, "now", { configurable: true, value: () => actualNow() + advance });
  window.fetch = (url, { signal }) => new Promise((resolve, reject) => {
    const route = routes.get(new URL(url).pathname);
    if (!route) throw new Error(`Unexpected test request: ${url}`);
    const request = { signal, resolve: progress => resolve({ ok: true, json: async () => ({ progress }) }) };
    requests.push(request);
    signal.addEventListener("abort", () => {
      if (!route.ignoreAbort) reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
    if (route.error) reject(new Error("Synthetic connection failure"));
    else if (route.hold) route.pending = request;
    else request.resolve(route.progress);
  });

  const host = document.getElementById("root");
  const root = createRoot(host);
  const render = node => flushSync(() => root.render(node));
  const settle = () => new Promise(resolve => setTimeout(resolve, 30));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const bar = () => host.querySelector("progress");
  const seconds = () => Number.parseFloat(host.querySelector("span")?.textContent);
  const checks = [];
  try {
    const imagePath = "/image-generation/progress/qa-image";
    const image = { elapsed_seconds: 38, phase: "Generating image", step: 19, total_steps: 24 };
    routes.set(imagePath, { progress: image });
    render(<ImageGenerationProgress requestId="qa-image" />);
    await settle();
    assert(seconds() >= 38 && seconds() < 39, "Initial timing did not come from the worker");
    assert(bar().value === 19 && bar().max === 24, "Initial image steps are incorrect");
    checks.push("First mount uses the worker's 38-second reading");

    const firstRequest = requests.at(-1);
    render(<div>Another tab</div>);
    assert(firstRequest.signal.aborted, "Unmount did not release its progress request");
    advance += 7000;
    routes.set(imagePath, { hold: true });
    render(<ImageGenerationProgress requestId="qa-image" />);
    assert(seconds() >= 45 && seconds() < 46, "Returning to the tab reset the clock");
    assert(bar().value === 19 && host.textContent.includes("Generating image"), "Returning to the tab reset its phase or bar");
    checks.push("After unmount and seven seconds away, remount immediately shows 45 seconds and the saved steps");
    routes.get(imagePath).pending.resolve({ ...image, elapsed_seconds: 45.4, step: 22 });
    await settle();
    assert(bar().value === 22 && seconds() >= 45.4, "Fresh worker progress did not replace the cached report");
    checks.push("The next worker report advances the restored bar");

    render(<div>Another tab</div>);
    routes.set(imagePath, { error: true });
    render(<ImageGenerationProgress requestId="qa-image" />);
    await settle();
    assert(bar().value === 22 && host.textContent.includes("45.4s at last update"), "Connection failure discarded or exaggerated confirmed progress");
    checks.push("Connection failure retains the last confirmed bar and labels the timestamp");

    render(<div>Another tab</div>);
    routes.set(imagePath, { progress: { ...image, elapsed_seconds: 46, step: 23 } });
    render(<ImageGenerationProgress requestId="qa-image" />);
    await settle();
    assert(bar().value === 23 && host.textContent.includes("elapsed"), "Connection recovery did not resume accurate progress");

    routes.set("/image-generation/progress/qa-slow", { hold: true, ignoreAbort: true });
    render(<ImageGenerationProgress requestId="qa-slow" />);
    assert(host.textContent.includes("Waiting for task timing") && !bar().hasAttribute("value"), "New task inherited the previous task's progress");
    const delayed = routes.get("/image-generation/progress/qa-slow").pending;
    routes.set("/image-generation/progress/qa-new", { progress: { ...image, elapsed_seconds: 2, step: 1 } });
    render(<ImageGenerationProgress requestId="qa-new" />);
    await settle();
    delayed.resolve({ ...image, elapsed_seconds: 99, step: 24 });
    await settle();
    assert(seconds() >= 2 && seconds() < 3 && bar().value === 1, "A stale response overwrote the new task");
    assert(taskProgressCache.read("image:qa-slow") === null, "Disposed view cached its late report");
    checks.push("Changing requests resets only the new task; late responses from the old view are ignored");

    const analysisPath = "/lora/projects/qa-project/analysis-progress";
    routes.set(analysisPath, { progress: { elapsed_seconds: 65, completed: 4, total: 12, batch_size: 4 } });
    render(<LoraAnalysisProgress projectId="qa-project" requestId="qa-analysis-one" total={12} />);
    await settle();
    assert(host.textContent.includes("1m 5s elapsed") && bar().value === 4, "Analysis ignored backend time");
    render(<div>Another tab</div>);
    advance += 7000;
    routes.set(analysisPath, { hold: true });
    render(<LoraAnalysisProgress projectId="qa-project" requestId="qa-analysis-one" total={12} />);
    assert(host.textContent.includes("1m 12s elapsed") && bar().value === 4, "Analysis lost time or steps when remounted");
    checks.push("Dataset analysis also preserves elapsed time and image count across a tab change");

    routes.set(analysisPath, { progress: null });
    render(<LoraAnalysisProgress projectId="qa-project" requestId="qa-analysis-two" total={12} />);
    await settle();
    assert(host.textContent.includes("Waiting for task timing") && !bar().hasAttribute("value"), "Repeated project analysis inherited an earlier run");
    checks.push("A repeated analysis of the same project starts with its own progress");

    render(<div>Another tab</div>);
    routes.set(imagePath, { progress: null });
    render(<ImageGenerationProgress requestId="qa-image" />);
    await settle();
    assert(host.textContent.includes("Waiting for task timing") && !bar().hasAttribute("value"), "Finished worker retained stale progress");
    checks.push("A worker reporting no active task clears stale status");
    return { ok: true, checks };
  } finally {
    flushSync(() => root.unmount());
  }
};
