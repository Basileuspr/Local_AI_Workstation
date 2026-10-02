import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import ToolRegistry from "../../src/components/ToolRegistry";
import "../../src/styles.css";
import "../../src/components/Dashboard.css";

// Catalog snapshots come from the real backend contract via the fixture server.
// Only failure, visibility and clipboard states are simulated here. No user data.
let fail = false, copied = "", requests = 0, download = null;
const originalFetch = window.fetch.bind(window);
window.fetch = (input, options) => {
  const path = new URL(input, location.href).pathname;
  if (!path.startsWith("/tools/registry")) throw new Error("Unexpected fixture request");
  requests += 1;
  if (fail) return Promise.resolve(new Response("Unavailable", { status: 503 }));
  return originalFetch(`/__fixture${path.endsWith(".md") ? "/registry.md" : "/registry.json"}`, options);
};
Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => { copied = text; } } });
// Capture export blobs through the real download helper without saving files.
const exportBlobs = new Map(), createUrl = URL.createObjectURL.bind(URL), clickLink = HTMLAnchorElement.prototype.click;
URL.createObjectURL = blob => { const url = createUrl(blob); exportBlobs.set(url, blob); return url; };
HTMLAnchorElement.prototype.click = function () {
  const blob = exportBlobs.get(this.href);
  if (!this.download || !blob) return clickLink.call(this);
  const current = { name: this.download, type: blob.type, text: "" }; download = current;
  blob.text().then(text => { current.text = text; });
};
function Fixture() {
  const [active, setActive] = useState(true), [narrow, setNarrow] = useState(false), [status, setStatus] = useState("");
  const [copyText, setCopyText] = useState(""), [downloadText, setDownloadText] = useState("");
  return <main style={{ width: narrow ? 380 : "100%", maxWidth: "100%", height: "100vh", overflow: "auto" }}>
    <nav aria-label="Fixture controls" style={{display: "flex", flexWrap: "wrap", gap: 8, padding: 12}}>
      <button onClick={() => setActive(value => !value)}>Toggle active</button>
      <button onClick={() => { fail = !fail; setStatus(fail ? "Failure enabled" : "Failure disabled"); }}>Toggle failure</button>
      <button onClick={() => setNarrow(value => !value)}>Toggle narrow</button>
      <button onClick={() => { setCopyText(copied); setDownloadText(download?.text || ""); setStatus(`Requests: ${requests}; Copied chars: ${copied.length}; Copied tools: ${(copied.match(/^(## |ID: )/gm) || []).length}; Download: ${download?.name || "none"}; MIME: ${download?.type || "none"}`); }}>Inspect fixture</button>
      <output>{status}</output>
    </nav>
    <div className="dashboard"><ToolRegistry active={active} /></div>
    <label>Copied fixture text<textarea readOnly value={copyText} /></label><label>Downloaded fixture text<textarea readOnly value={downloadText} /></label>
  </main>;
}
createRoot(document.getElementById("root")).render(<Fixture />);
