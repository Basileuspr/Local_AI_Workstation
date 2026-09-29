import { useState } from "react";

export default function ImageOutputFolder({ value = "", onChange }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const picker = typeof window !== "undefined" && window.workstationDesktop?.chooseImageOutputFolder;
  async function choose() {
    setBusy(true); setError("");
    try {
      const result = await picker();
      if (result.error) throw new Error(result.error);
      if (!result.canceled && result.folder) onChange(result.folder);
    } catch (failure) {
      setError(failure.message?.includes("No handler registered")
        ? "Restart required: quit Local AI Workstation from its system tray menu, then reopen it to enable Point output."
        : failure.message);
    }
    finally { setBusy(false); }
  }
  return <div className="image-output-folder">
    <div className="image-output-folder-row">
      <button type="button" disabled={busy || !picker} onClick={choose} title={picker ? "Choose where new images are saved" : "Folder selection is available in the desktop app"}>{busy ? "Choosing…" : "Point output"}</button>
      <span title={value || "Using the default output folder"}>{value ? value.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || value : "Default folder"}</span>
      {value && <button type="button" disabled={busy} aria-label="Clear output folder" title="Use the default output folder" onClick={() => { onChange(""); setError(""); }}>Clear</button>}
    </div>
    {error && <small role="alert">{error}</small>}
  </div>;
}
