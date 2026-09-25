import { Component, createContext, useContext, useEffect, useState } from "react";
import { useStore } from "../useStore";

const DesktopCapabilitiesContext = createContext(null);
export const useDesktopCapabilities = () => useContext(DesktopCapabilitiesContext);

export function DesktopCapabilitiesProvider({ children }) {
  const [capabilities, setCapabilities] = useState(null);
  useEffect(() => {
    const desktop = window.workstationDesktop;
    if (!desktop?.capabilities) {
      if (!desktop) setCapabilities({ features: Object.fromEntries(
        ["media_manager", "program_updates", "graphics_reset", "tab_capture"].map(key =>
          [key, { available: false, detail: "Open the desktop app to use this feature." }])) });
      return;
    }
    let stopped = false, pending = false;
    async function check() {
      if (pending) return;
      pending = true;
      try { const result = await desktop.capabilities(); if (!stopped) setCapabilities(result); }
      catch { /* Keep the last known result during a temporary IPC failure. */ }
      finally { pending = false; }
    }
    void check();
    const timer = setInterval(check, 10000);
    return () => { stopped = true; clearInterval(timer); };
  }, []);
  return <DesktopCapabilitiesContext.Provider value={capabilities}>{children}</DesktopCapabilitiesContext.Provider>;
}

const featureLabels = { local_data: "Saved material and editing", chat: "Chat", knowledge: "Knowledge search",
  image_generation: "Image generation", training: "LoRA training", face_detection: "Face detection",
  media_manager: "Media Manager", program_updates: "Program updates", graphics_reset: "Graphics reset", tab_capture: "Tab capture" };

export function CapabilityList({ features = {} }) {
  return <ul>{Object.entries(features).map(([key, feature]) => <li key={key}>
    <strong>{featureLabels[key] || key}: {feature.available ? "Available" : "Unavailable"}</strong>
    {feature.device && ` (${feature.device})`} — {feature.detail}
  </li>)}</ul>;
}

export class WorkspaceBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="dashboard" role="alert">
      <h2>This workspace could not display</h2>
      <p>Other workspaces are still available. Saved files have not been reset. Retrying this view may discard its unsaved edits.</p>
      <button type="button" onClick={() => this.setState({ failed: false })}>Retry this workspace</button>
    </section>;
  }
}

export function StartupNotice() {
  const { connected } = useStore() || {};
  const [startup, setStartup] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (connected || !window.workstationDesktop?.startupStatus) return;
    let stopped = false;
    const check = () => window.workstationDesktop.startupStatus().then(value => {
      if (!stopped) setStartup(value);
    }).catch(() => {});
    check();
    const timer = setInterval(check, 3000);
    return () => { stopped = true; clearInterval(timer); };
  }, [connected]);
  if (connected || !startup || startup.state === "ready") return null;
  return <div className="compatibility-notice" role="status">
    <strong>{startup.state === "starting" ? "Starting local services" : "Local services need attention"}</strong>
    <p>{startup.detail}</p>
    <button type="button" onClick={async () => {
      try { const result = await window.workstationDesktop.openLogs(); setError(result?.error || ""); }
      catch { setError("Could not open the log folder."); }
    }}>Open logs</button>
    {error && <p>{error}</p>}
  </div>;
}

export function CapabilityReadings() {
  const { serviceStatus: status, models = [], modelsError } = useStore() || {};
  const desktop = useDesktopCapabilities();
  const capabilities = status?.capabilities;
  const host = capabilities?.host;
  const detected = { ...(status?.backend?.ok ? capabilities?.features : {}) };
  // /status estimates chat count from tags; the selector has inspected each
  // model's completion capability. Do not advertise embedding-only models.
  if (detected.chat && status?.ollama?.reachable) detected.chat = {
    ...detected.chat, available: models.length > 0 && !modelsError,
    detail: modelsError || (models.length ? detected.chat.detail : "No usable chat model has been detected yet. Install a chat model; the list refreshes automatically."),
  };
  return <section className="dashboard-card">
    <h2>Available on this PC</h2>
    <p>Detected automatically and checked again as services and models change. Unavailable features leave the rest of the app usable.</p>
    {host && <p>{host.os} · {host.architecture}{host.memory_total_bytes ? ` · ${(host.memory_total_bytes / 1024 ** 3).toFixed(1)} GiB RAM` : ""}
      {capabilities.chat_context_limit && ` · Chat context limit: ${capabilities.chat_context_limit.toLocaleString()} tokens`}</p>}
    {!status?.backend?.ok && <p>Local services are unavailable. Desktop tools that do not need the backend can still be used.</p>}
    {capabilities?.error && <p>{capabilities.error}</p>}
    <CapabilityList features={{ ...detected, ...desktop?.features }} />
    <p className="dashboard-note">Availability means requirements were detected, not that a particular model or workload is guaranteed to fit in memory.</p>
  </section>;
}
