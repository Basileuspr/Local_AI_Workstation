import { useEffect, useRef, useState } from "react";
import { apiUrl } from "../api";

export async function mobileControl(path = "", body) {
  const response = await fetch(apiUrl("/mobile" + path), { method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value.detail === "string" ? value.detail : "Mobile companion request failed. Check the connection settings.");
  return value;
}

export default function MobileCompanion({ active = true }) {
  const [expanded, setExpanded] = useState(false), [status, setStatus] = useState(null), [error, setError] = useState("");
  const [origin, setOrigin] = useState(""), [address, setAddress] = useState("127.0.0.1"), [port, setPort] = useState(8766);
  const [certificate, setCertificate] = useState(""), [key, setKey] = useState("");
  const [invitation, setInvitation] = useState(null), [busy, setBusy] = useState(false);
  const initialized = useRef(false);
  useEffect(() => {
    if (!active || !expanded) return;
    let disposed = false, timer;
    async function sync() { try { const value = await mobileControl(); if (!disposed) {
      setStatus(value);
      if (!initialized.current) {
        initialized.current = true;
        if (value.listen) { setOrigin(value.listen.origin); setAddress(value.listen.address); setPort(value.listen.port); setCertificate(value.listen.certificate || ""); setKey(value.listen.private_key || ""); }
      }
    } } catch (failure) { if (!disposed) setError(failure.message); } finally { if (!disposed) timer = setTimeout(sync, 4000); } }
    sync(); return () => { disposed = true; clearTimeout(timer); };
  }, [active, expanded]);
  useEffect(() => { if (!invitation) return; const timer = setTimeout(() => setInvitation(null), invitation.expires_in * 1000); return () => clearTimeout(timer); }, [invitation]);
  async function action(path, body = {}) {
    setBusy(true); setError("");
    try { const value = await mobileControl(path, body); if (path === "/invitation") setInvitation(value); else { setStatus(value); setInvitation(null); } }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <section className="dashboard-card mobile-control"><h2>Mobile companion</h2><p className="dashboard-note">Chat, generate images and browse your gallery from a paired phone.</p><button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Hide mobile controls" : "Show mobile controls"}</button>{expanded && <>
    <p role="status">{status?.running ? `Listening for paired phones at ${status.origin}` : "Mobile access is off. It stays off after each desktop restart."}</p>
    {error && <p role="alert">{error}</p>}{status && !status.build_ready && <p>Build the mobile app with <code>npm run build:mobile</code> before starting.</p>}
    <details><summary>Connection and privacy information</summary><p>Use a trusted HTTPS connection on your private network or VPN. Paired phones can read all conversations and unlocked gallery images, submit chat and image jobs, and download original images. Vault unlock, file administration and desktop tools are unavailable. Pairing expires after five minutes; phone access expires after 30 days and can be revoked below.</p><p>For private remote access, configure Tailscale Serve separately to forward your HTTPS device address to this loopback port. This panel does not install a VPN, configure certificates or change your firewall. Direct LAN HTTPS requires trusted certificate and key files matching the chosen private IP.</p><p>Keep the desktop awake for jobs. Browser closure does not cancel them; a desktop restart marks unfinished jobs interrupted. Revoke blocks further phone access but does not cancel accepted jobs or erase files already downloaded. Backups of desktop app data include mobile job content and credential hashes.</p></details>
    <div className="bridge-fields"><label>HTTPS address<input value={origin} placeholder="https://desktop.your-tailnet.ts.net" onChange={event => setOrigin(event.target.value)} disabled={status?.running} /></label><label>Listen address<input value={address} onChange={event => setAddress(event.target.value)} disabled={status?.running} /></label><label>Listen port<input type="number" min="1024" max="65535" value={port} onChange={event => setPort(Number(event.target.value))} disabled={status?.running} /></label></div>
    <details><summary>Direct LAN certificate files</summary><div className="bridge-fields"><label>Certificate path<input value={certificate} onChange={event => setCertificate(event.target.value)} disabled={status?.running} /></label><label>Private-key path<input value={key} onChange={event => setKey(event.target.value)} disabled={status?.running} /></label></div></details>
    <div className="bridge-actions"><button disabled={busy || !status || status.running || !status.build_ready || !origin.trim()} onClick={() => action("/start", { origin: origin.trim(), address: address.trim(), port, certificate: certificate.trim(), private_key: key.trim() })}>Start mobile connection</button><button disabled={busy || !status?.running || !!status?.active_jobs} onClick={() => action("/stop")}>Stop mobile connection</button><button disabled={busy || !status?.running} onClick={() => action("/invitation")}>Create phone invitation</button></div>
    {!!status?.active_jobs && <p>{status.active_jobs} active mobile job(s). Finish or cancel them on the phone before stopping.</p>}
    {invitation && <label>Single-use invitation · expires in five minutes<input readOnly value={invitation.code} aria-label="Phone invitation" onFocus={event => event.target.select()} /><span>Open the HTTPS address on your phone and paste this code. Keep it private.</span></label>}
    <ul>{(status?.devices || []).map(device => <li key={device.id}>{device.name} · {device.enabled ? "Paired" : "Revoked"} <button disabled={busy || !device.enabled} onClick={() => action(`/devices/${device.id}/revoke`)}>Revoke phone access</button></li>)}</ul>
  </>}</section>;
}
