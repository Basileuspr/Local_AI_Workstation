import { useRef, useState } from "react";
import { apiUrl } from "../api";
import { downloadBlob } from "../downloadBlob";
import { SOFTWARE_GROUPS, formatSoftwareSpecs } from "../softwareSpecs";

export default function SoftwareSpecs() {
  const [snapshot, setSnapshot] = useState(null), [groups, setGroups] = useState(SOFTWARE_GROUPS.map(([id]) => id));
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const lock = useRef(false);
  async function act(task) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try { await task(); } catch (failure) { setError(failure.message); }
    finally { lock.current = false; setBusy(false); }
  }
  async function refresh() {
    const response = await fetch(apiUrl("/system/software-specs"), { cache: "no-store" });
    if (!response.ok) throw new Error("Could not read software specs. Restart the app if it was just updated.");
    const value = await response.json();
    const runtime = await window.workstationDesktop?.softwareRuntime?.();
    value.frontend.runtime = runtime || { status: "Desktop runtime unavailable in this window" };
    setSnapshot(value); return value;
  }
  return <section className="dashboard-card software-specs"><h2>App software specs</h2><p className="dashboard-note">Current source folders, installed versions, available app API calls, and model catalogs. Choose which sections to include.</p>
    <div className="software-spec-groups">{SOFTWARE_GROUPS.map(([id, label]) => <label key={id}><input type="checkbox" checked={groups.includes(id)} onChange={event => setGroups(value => event.target.checked ? [...value, id] : value.filter(item => item !== id))} />{label}</label>)}</div>
    <div className="software-spec-actions"><button disabled={busy} onClick={() => act(refresh)}>Refresh software specs</button>
      <button disabled={busy || !groups.length} onClick={() => act(async () => { const value = await refresh(); await navigator.clipboard.writeText(formatSoftwareSpecs(value, groups)); setNotice("Selected software specs copied."); })}>Copy app specs</button>
      <button disabled={busy || !groups.length} onClick={() => act(async () => { const value = await refresh(); downloadBlob(new Blob([formatSoftwareSpecs(value, groups)], { type: "text/plain" }), "workstation-software-specs.txt"); setNotice("Software specs download started."); })}>Export specs</button>
      <button disabled={busy} onClick={() => act(async () => { const response = await fetch(apiUrl("/system/logs/export")); if (!response.ok) throw new Error("Could not export app logs."); downloadBlob(await response.blob(), "workstation-app-logs.zip"); setNotice("App log ZIP download started."); })}>Export app logs (ZIP)</button></div>
    {busy && <p role="status">Reading app records…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {snapshot && <details><summary>Preview selected specs · {new Date(snapshot.sampled_at).toLocaleString()}</summary><pre className="software-spec-preview">{formatSoftwareSpecs(snapshot, groups)}</pre></details>}
    <p className="dashboard-note">API calls describe registered app endpoints, not tools granted to a model. Log export includes recorded paths and errors; session credentials are redacted.</p>
  </section>;
}
