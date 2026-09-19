import { useEffect, useState } from "react";
import DashboardReset from "./DashboardReset";
import { apiUrl } from "../api";
import "./Dashboard.css";

export function formatNumber(value, unit = "", digits = 0) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : "Unavailable";
}

export function formatBytes(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unavailable";
  const unit = value >= 1024 ** 4 ? "TiB" : "GiB";
  return `${(value / 1024 ** (unit === "TiB" ? 4 : 3)).toFixed(1)} ${unit}`;
}

function Meter({ label, value }) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return <progress aria-label={label} max="100" value={Math.max(0, Math.min(100, value))} />;
}

function Reading({ label, children }) {
  return <div className="dashboard-reading"><dt>{label}</dt><dd>{children}</dd></div>;
}

function OpenDriveButton({ root }) {
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  async function openDrive() {
    setError("");
    if (!window.workstationDesktop?.openDriveRoot) {
      setError("Open this Dashboard in the desktop app to use File Explorer.");
      return;
    }
    setOpening(true);
    try {
      const result = await window.workstationDesktop.openDriveRoot(root);
      if (result?.error) setError(result.error);
    } catch {
      setError("Could not open this drive in File Explorer.");
    } finally {
      setOpening(false);
    }
  }
  return <div className="dashboard-drive-actions">
    {error && <p className="dashboard-note" role="alert">{error}</p>}
    <button type="button" onClick={openDrive} disabled={opening} aria-label={`Open ${root} in File Explorer`} title={`Open the top-level folder of ${root}`}>{opening ? "Opening…" : "Open drive"}</button>
  </div>;
}

export function DashboardReadings({ stats }) {
  const { cpu = {}, ram = {}, gpus = [], drives = [], warnings = [] } = stats;
  const temperatures = (cpu.temperatures || []).filter((sensor) => typeof sensor.temperature_c === "number" && Number.isFinite(sensor.temperature_c));
  const hottest = temperatures.length ? Math.max(...temperatures.map((sensor) => sensor.temperature_c)) : null;
  return <>
    {warnings.length > 0 && <div className="dashboard-notice" role="status">{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
    <div className="dashboard-grid">
      <section className="dashboard-card">
        <h2>CPU</h2><p className="dashboard-device">{cpu.name || "Processor"}</p>
        <div className="dashboard-primary">{formatNumber(cpu.usage_percent, "%")}<span>utilization</span></div>
        <Meter label="CPU utilization" value={cpu.usage_percent} />
        <dl className="dashboard-readings">
          <Reading label={`CPU speed (${cpu.clock_kind || "reported"})`}>{formatNumber(cpu.clock_mhz == null ? null : cpu.clock_mhz / 1000, " GHz", 2)}</Reading>
          <Reading label="Hottest CPU sensor">{formatNumber(hottest, " °C", 1)}</Reading>
          <Reading label="Physical cores">{formatNumber(cpu.physical_cores)}</Reading>
          <Reading label="Logical processors">{formatNumber(cpu.logical_cores)}</Reading>
        </dl>
        {temperatures.length ? <details><summary>CPU temperature sensors</summary><dl className="dashboard-readings">{temperatures.map((sensor, index) => <Reading key={`${sensor.name}-${index}`} label={sensor.name}>{formatNumber(sensor.temperature_c, " °C", 1)}</Reading>)}</dl></details> : <p className="dashboard-note">CPU temperature is not exposed. On Windows, readings can appear when Libre Hardware Monitor or Open Hardware Monitor is running with its WMI sensors available.</p>}
        {cpu.clock_kind === "reported nominal" && <p className="dashboard-note">Windows reports the nominal CPU frequency here, rather than a live boost clock.</p>}
      </section>
      <section className="dashboard-card">
        <h2>RAM</h2><p className="dashboard-device">System memory</p>
        <div className="dashboard-primary">{formatNumber(ram.usage_percent, "%", 1)}<span>in use</span></div>
        <Meter label="RAM utilization" value={ram.usage_percent} />
        <dl className="dashboard-readings">
          <Reading label="Used">{formatBytes(ram.used_bytes)}</Reading>
          <Reading label="Available">{formatBytes(ram.available_bytes)}</Reading>
          <Reading label="Total usable">{formatBytes(ram.total_bytes)}</Reading>
          <Reading label="Configured memory speed">{(ram.modules || []).length ? [...new Set(ram.modules.map((module) => formatNumber(module.speed_mts, " MT/s")))].join(" / ") : "Unavailable"}</Reading>
        </dl>
        <p className="dashboard-note">Available includes memory Windows can reclaim. Used is total minus available. Memory speed is a configured transfer rate.</p>
      </section>
      {gpus.map((gpu) => <section className="dashboard-card dashboard-wide" key={gpu.id}>
        <h2>GPU {gpu.id}</h2><p className="dashboard-device">{gpu.name}</p>
        <div className="dashboard-primary">{formatNumber(gpu.usage_percent, "%")}<span>utilization</span></div>
        <Meter label={`${gpu.name} utilization`} value={gpu.usage_percent} />
        <dl className="dashboard-readings dashboard-gpu-readings">
          <Reading label="Temperature">{formatNumber(gpu.temperature_c, " °C")}</Reading>
          <Reading label="Graphics clock">{formatNumber(gpu.clock_mhz, " MHz")}</Reading>
          <Reading label="Memory clock">{formatNumber(gpu.memory_clock_mhz, " MHz")}</Reading>
          <Reading label="Power draw">{formatNumber(gpu.power_w, " W", 1)}</Reading>
          <Reading label="VRAM used">{formatBytes(gpu.vram_used_bytes)}</Reading>
          <Reading label="VRAM total">{formatBytes(gpu.vram_total_bytes)}</Reading>
          <Reading label="VRAM free">{formatBytes(gpu.vram_total_bytes != null && gpu.vram_used_bytes != null ? Math.max(0, gpu.vram_total_bytes - gpu.vram_used_bytes) : null)}</Reading>
        </dl>
        <Meter label={`${gpu.name} VRAM utilization`} value={gpu.vram_total_bytes > 0 && gpu.vram_used_bytes != null ? gpu.vram_used_bytes / gpu.vram_total_bytes * 100 : null} />
      </section>)}
      {!gpus.length && <section className="dashboard-card dashboard-wide"><h2>GPU / VRAM</h2><p className="dashboard-note">Live GPU usage, temperature, clock speeds and VRAM are unavailable. NVIDIA monitoring is supported in this version.</p></section>}
    </div>
    <section className="dashboard-storage">
      <h2>Drive space</h2><p className="dashboard-note">Each mounted volume is listed separately. Multiple volumes may share one physical disk. Capacities use GiB / TiB.</p>
      <div className="dashboard-grid">
        {drives.map((drive) => <section className="dashboard-card dashboard-drive-card" key={drive.mountpoint}>
          <h3>{drive.mountpoint}</h3><p className="dashboard-device">{drive.filesystem || "Filesystem unavailable"}</p>
          {drive.error ? <p className="dashboard-note">{drive.error}</p> : <>
            <div className="dashboard-primary">{formatBytes(drive.free_bytes)}<span>free</span></div>
            <Meter label={`${drive.mountpoint} space used`} value={drive.usage_percent} />
            <dl className="dashboard-readings"><Reading label="Used">{formatBytes(drive.used_bytes)}</Reading><Reading label="Total">{formatBytes(drive.total_bytes)}</Reading><Reading label="Space used">{formatNumber(drive.usage_percent, "%", 1)}</Reading></dl>
          </>}
          <OpenDriveButton root={drive.mountpoint} />
        </section>)}
      </div>
      {!drives.length && <p className="dashboard-note">No mounted drive readings are available.</p>}
    </section>
    <p className="dashboard-note">CPU temperature sensors and memory configuration refresh about every 15 seconds. Other statistics refresh about every 5 seconds, including while you prompt in other tabs. All readings stay on this PC.</p>
  </>;
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    // This pane stays mounted when another tab is selected. Keep one light,
    // non-overlapping polling loop running so prompting usage remains current.
    let stopped = false;
    let timer;
    let controller;
    async function refresh() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(apiUrl("/system/stats"), { signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 404 ? "Restart the desktop app to load Dashboard's new hardware endpoint." : `Hardware readings failed (${response.status}).`);
        const next = await response.json();
        if (!stopped) { setStats(next); setError(""); }
      } catch (failure) {
        if (!stopped) setError(failure.name === "AbortError" ? "Hardware readings timed out. Retrying…" : failure.message || "Backend unavailable. Retrying…");
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(refresh, 5000);
      }
    }
    refresh();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, []);

  return <section className="dashboard">
    <header className="dashboard-header"><div><p className="dashboard-eyebrow">Your workstation</p><h1>Dashboard</h1><p>PC statistics</p></div><div className="dashboard-status" role="status">{error ? "Readings interrupted" : stats ? "Live · refresh about every 5 seconds" : "Reading hardware…"}{stats && <span>Last reading: {new Date(stats.sampled_at).toLocaleTimeString()}</span>}</div></header>
    {error && <p className="dashboard-notice" role="alert">{error}{stats ? " Showing the last successful sample; these readings are stale." : ""}</p>}
    <DashboardReset />
    {stats ? <DashboardReadings stats={stats} /> : <p className="dashboard-note">{error ? "Waiting for the local backend." : "Collecting CPU, GPU, memory and drive readings…"}</p>}
  </section>;
}
