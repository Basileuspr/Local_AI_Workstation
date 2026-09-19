import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import FaceStudio from "../../src/components/FaceStudio";
import "../../src/styles.css";

// Exercise the actual Save and Rename controls with a synthetic face dataset.
// Any attempted use of the unsupported Electron prompt fails the check.
window.runCharacterSaveQA = async () => {
  window.prompt = () => { throw new Error("prompt() is not supported."); };
  const sampleFaces = ["qa-face-one", "qa-face-two"].map((id, index) => ({
    id, face_index: index, source_name: "qa-source.png", state: "accepted", flags: [], cluster: null,
    created_at: index, metrics: { face_width: 128, face_height: 128, confidence: 0.99, sharpness: 100 },
  }));
  const dataset = {
    id: "qa-dataset", name: "QA dataset", face_count: 2, faces: sampleFaces, run: null,
    settings: { crop_mode: "tight", padding: 0.2, size: 512, detect_threshold: 0.5, similar_threshold: 0.45 },
  };
  let character = null;
  let failCreate = true;
  let failRename = true;
  let pendingCreate;
  const creates = [], renames = [];
  const exports = [], uploads = [], releases = [];
  let inputIndex = 0, scanRun = null, stopScan = false;
  window.workstationDesktop = {
    async saveFaceFolder(selection) {
      exports.push(selection);
      return { saved: selection.faceIds.length, total: selection.faceIds.length, folder: "QA export folder", errors: [] };
    },
    async chooseFaceInputs() { inputIndex = 0; return { ticket: "qa-inputs", total: 235 }; },
    async readFaceInputs() {
      const count = Math.min(100, 235 - inputIndex);
      const files = Array.from({ length: count }, (_, i) => ({ name: `${inputIndex + i}.png`, type: "image/png", lastModified: 1, bytes: new Uint8Array([1, 2, 3]) }));
      inputIndex += count;
      return { files, errors: [], consumed: count, done: inputIndex === 235 };
    },
    async releaseFaceInputs(ticket) { releases.push(ticket); },
  };
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  window.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const method = options.method || "GET";
    if (path === "/faces/providers") return reply({ providers: [{ key: "qa", name: "QA detector", ready: true, device: "cpu" }] });
    if (path === "/faces/datasets") return reply({ datasets: [dataset] });
    if (path === "/faces/datasets/qa-dataset") return reply(dataset);
    if (path === "/faces/datasets/qa-dataset/upload") {
      const count = options.body.getAll("files").length;
      uploads.push(count);
      scanRun = { id: `qa-run-${uploads.length}`, status: "running", total: count, processed: 0, faces: 0, errors: [], message: "Scanning" };
      dataset.run = scanRun;
      return reply(scanRun, 202);
    }
    if (path === "/faces/datasets/qa-dataset/run") {
      if (!stopScan) scanRun = { ...scanRun, status: "complete", processed: scanRun.total };
      dataset.run = scanRun;
      return reply({ run: scanRun });
    }
    if (path === "/faces/datasets/qa-dataset/run/stop") {
      scanRun = { ...scanRun, status: "cancelled", processed: 3 };
      dataset.run = scanRun;
      return reply({ run: scanRun });
    }
    if (path === "/faces/characters" && method === "GET") return reply({ characters: character ? [character] : [] });
    if (path === "/faces/characters" && method === "POST") {
      const body = JSON.parse(options.body);
      creates.push(body);
      if (failCreate) { failCreate = false; return reply({ detail: "Synthetic save failure; retry is available." }, 500); }
      return new Promise(resolve => {
        pendingCreate = () => {
          character = { id: "qa-character", name: body.name, notes: "", tags: [], reference_count: 2,
            members: sampleFaces.map(face => ({ face_id: face.id, dataset_id: dataset.id, similarity: 0.9, state: "accepted" })) };
          resolve(reply(character, 201));
        };
      });
    }
    if (path === "/faces/characters/qa-character" && method === "GET") return reply(character);
    if (path === "/faces/characters/qa-character" && method === "PUT") {
      const body = JSON.parse(options.body);
      renames.push(body);
      if (failRename) { failRename = false; return reply({ detail: "Synthetic rename failure; retry is available." }, 500); }
      character = { ...character, ...body };
      return reply(character);
    }
    throw new Error(`Unexpected test request: ${method} ${path}`);
  };

  const host = document.getElementById("root");
  const root = createRoot(host);
  const checks = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const waitFor = async (condition, label) => {
    const deadline = Date.now() + 5000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  const text = node => node.textContent.replace(/\s+/g, " ").trim();
  const button = (label, parent = host) => [...parent.querySelectorAll("button")].find(item => text(item) === label);
  const click = target => { assert(target && !target.disabled, "Expected an enabled control"); flushSync(() => target.click()); };
  const dialog = () => host.querySelector("dialog[open]");
  const nameInput = () => dialog().querySelector("input");
  const fill = (input, value) => {
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, value);
    flushSync(() => input.dispatchEvent(new Event("input", { bubbles: true })));
  };
  const submit = () => flushSync(() => dialog().querySelector("form").requestSubmit());
  const escape = () => flushSync(() => dialog().dispatchEvent(new Event("cancel", { bubbles: false, cancelable: true })));

  try {
    flushSync(() => root.render(<FaceStudio active />));
    await waitFor(() => host.querySelectorAll(".face-card").length === 2, "synthetic dataset");
    click(button("Select shown"));
    click(button("Save 2 selected faces to folder…"));
    await waitFor(() => exports.length === 1 && button("Save 2 selected faces to folder…")?.disabled === false, "selected crop export");
    assert(exports[0].datasetId === dataset.id && exports[0].faceIds.length === 2, "Folder export lost the selected faces");
    assert(host.querySelectorAll(".face-card.selected").length === 2, "Folder export changed the selection");
    click(button("Save 2 as character"));
    assert(dialog()?.getAttribute("aria-label") === "Save character", "Save did not open an in-app dialog");
    assert(document.activeElement === nameInput() && nameInput().maxLength === 120, "Character name must receive focus and respect the API length limit");
    checks.push("Save selected faces opens the in-app dialog without calling prompt()");

    fill(nameInput(), "   ");
    assert(button("Save character", dialog()).disabled, "Whitespace name was allowed");
    submit();
    assert(creates.length === 0, "A blank name was sent to the backend");
    click(button("Cancel", dialog()));
    assert(!dialog() && creates.length === 0 && !button("Save 2 as character").disabled, "Cancel changed selection or saved a character");
    click(button("Save 2 as character"));
    escape();
    assert(!dialog() && creates.length === 0, "Escape saved or retained the dialog");
    checks.push("Blank names are blocked; Cancel and Escape preserve selected faces without saving");

    click(button("Save 2 as character"));
    fill(nameInput(), "  Mira  ");
    submit();
    await waitFor(() => dialog()?.querySelector('[role="alert"]'), "failed save feedback");
    assert(nameInput().value === "  Mira  " && dialog().textContent.includes("Synthetic save failure"), "Failed save lost the draft or error");
    assert(host.querySelectorAll(".face-card.selected").length === 2, "Failed save lost the reference selection");
    checks.push("Save failure keeps the name and selected references for retry");

    submit();
    submit();
    assert(creates.length === 2 && pendingCreate, "Repeated submission started duplicate saves");
    assert(nameInput().disabled && button("Cancel", dialog()).disabled, "Pending save controls remain active");
    escape();
    assert(dialog(), "Escape dismissed a pending save");
    pendingCreate();
    await waitFor(() => !dialog(), "successful character save");
    assert(character.name === "Mira" && creates[1].name === "Mira" && creates[1].dataset_id === dataset.id &&
      JSON.stringify([...creates[1].face_ids].sort()) === JSON.stringify(sampleFaces.map(face => face.id).sort()), "Save lost or changed selected reference IDs");
    assert(host.querySelectorAll(".face-card.selected").length === 0 && host.textContent.includes('Character "Mira" saved'), "Successful save did not update the UI");
    checks.push("Retry saves the trimmed name and exact selected references once, then closes and confirms success");

    click(button("Save all 2 faces to folder…"));
    await waitFor(() => exports.length === 2 && button("Save all 2 faces to folder…")?.disabled === false, "all crop export");
    assert(exports[1].faceIds.length === 2 && host.textContent.includes("Saved 2 of 2 face crops to QA export folder"), "Export all did not confirm its output");
    checks.push("The extractor exports selected faces or all faces through one folder action");

    click(button("Choose a folder"));
    await waitFor(() => uploads.length === 1, "first folder batch");
    assert(host.querySelector('progress[aria-label="Images scanned"]').max === 235, "Scan progress shows only one batch");
    flushSync(() => root.render(<FaceStudio active={false} />));
    await waitFor(() => releases.length === 1 && !button("Stop scanning"), "235-image scan across inactive tab");
    flushSync(() => root.render(<FaceStudio active />));
    assert(JSON.stringify(uploads) === JSON.stringify([100, 100, 35]), "Large folder was not scanned in order in bounded batches");
    assert(host.textContent.includes("235 images"), "Completed folder count was lost across tabs");
    checks.push("A 235-image folder scans in 100/100/35 batches and keeps its total when the tab is inactive");

    stopScan = true;
    click(button("Choose a folder"));
    await waitFor(() => uploads.length === 4, "cancellable folder scan");
    click(button("Stop scanning"));
    await waitFor(() => releases.length === 2 && !button("Stop scanning"), "stopped folder scan");
    assert(uploads.length === 4 && host.textContent.includes("Stopped after 3 of 235 images"), "Stop launched another batch or lost partial scan progress");
    checks.push("Stop cancels the current batch, releases folder access and prevents later batches");

    click(button("Character Bank"));
    await waitFor(() => button("Rename"), "new character in the bank");
    const notes = host.querySelector(".bank-field textarea");
    fill(notes, "Unsaved character notes");
    click(button("Rename"));
    assert(nameInput().value === "Mira" && dialog().getAttribute("aria-label") === "Rename character", "Rename did not prefill the saved name");
    fill(nameInput(), "  Mira Rowan  ");
    submit();
    await waitFor(() => dialog()?.querySelector('[role="alert"]'), "failed rename feedback");
    assert(nameInput().value === "  Mira Rowan  ", "Rename failure lost the entered name");
    submit();
    await waitFor(() => !dialog(), "successful rename");
    assert(text(host.querySelector(".bank-head h2")) === "Mira Rowan" && text(host.querySelector(".bank-list strong")) === "Mira Rowan", "Rename did not update both character views");
    assert(host.querySelector(".bank-field textarea").value === "Unsaved character notes", "Rename discarded unsaved notes");
    assert(renames.length === 2 && renames[1].name === "Mira Rowan", "Rename payload is incorrect");
    checks.push("Rename uses the same dialog, supports retry, updates both views, and preserves unsaved notes");

    click(button("Rename"));
    submit();
    await waitFor(() => !dialog(), "unchanged name");
    assert(renames.length === 2, "Unchanged name caused an unnecessary update");
    click(button("Rename"));
    fill(nameInput(), "Cancelled name");
    click(button("Cancel", dialog()));
    assert(renames.length === 2 && character.name === "Mira Rowan", "Cancelling rename changed the character");
    checks.push("Unchanged and cancelled renames do not write changes");
    return { ok: true, checks };
  } finally {
    flushSync(() => root.unmount());
  }
};
