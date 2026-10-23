import { useEffect, useRef, useState } from "react";
import { apiUrl } from "../../src/api";

export async function mobileControl(path = "", body, signal) {
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 15000);
  try {
    const response = await fetch(apiUrl("/mobile" + path), { method: body === undefined ? "GET" : "POST", cache: 'no-store', signal: controller.signal,
      headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json();
    if (!response.ok) throw new Error(typeof value.detail === "string" ? value.detail : "Mobile companion request failed. Check the connection settings.");
    return value;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export function PhoneInvitation({ invitation, origin, onExpired }) {
  const [qr, setQr] = useState(''), [remaining, setRemaining] = useState(0);
  const url = `${origin}/#pair=${invitation.code}`;
  useEffect(() => {
    let alive = true; setQr('');
    import('qrcode').then(QRCode => QRCode.toDataURL(url, { width: 320, margin: 4, errorCorrectionLevel: 'M' }))
      .then(value => { if (alive) setQr(value); }).catch(() => {});
    return () => { alive = false; };
  }, [url]);
  useEffect(() => {
    function tick() { const seconds = Math.max(0, Math.ceil(invitation.expires_at - Date.now() / 1000)); setRemaining(seconds); if (!seconds) onExpired(); }
    tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [invitation.expires_at, onExpired]);
  return <section aria-label="Pair your phone"><h3>Scan to pair</h3>
    {qr && <img src={qr} width="256" height="256" alt="Single-use phone pairing QR code" />}
    <p>Scan with your phone camera. Choose “Open Android app to pair” (Companion 0.2.0+) or connect in your browser. Both devices need the private network or VPN.</p>
    <p role="status">Single-use invitation · {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')} remaining</p>
    <label>Invitation code<input readOnly value={invitation.code} aria-label="Phone invitation" onFocus={event => event.target.select()} /></label>
    <label>Pairing link<input readOnly value={url} aria-label="Phone pairing link" onFocus={event => event.target.select()} /></label>
    <p>Keep the QR code and link private. They disappear here when used, replaced or expired. For an older Android app, paste the invitation code in its pairing screen.</p>
  </section>;
}

export default function MobileCompanion({ active = true }) {
  const [expanded, setExpanded] = useState(false), [status, setStatus] = useState(null), [error, setError] = useState("");
  const [origin, setOrigin] = useState(""), [address, setAddress] = useState("127.0.0.1"), [port, setPort] = useState(8766);
  const [certificate, setCertificate] = useState(""), [key, setKey] = useState("");
  const [invitation, setInvitation] = useState(null), [busy, setBusy] = useState(false);
  const initialized = useRef(false), revision = useRef(0), acting = useRef(false);
  const update = status?.client_update, updating = update?.phase === 'building';
  useEffect(() => {
    if (!active || !expanded) { setStatus(null); setInvitation(null); return; }
    let disposed = false, timer; const controller = new AbortController();
    async function sync() {
      const current = revision.current;
      try {
        if (acting.current) return;
        const value = await mobileControl('', undefined, controller.signal);
        if (disposed || current !== revision.current || acting.current) return;
        setStatus(value); setError(value.error || '');
        setInvitation(previous => value.running && previous?.id === value.invitation?.id ? previous : null);
        if (!initialized.current) {
          initialized.current = true;
          if (value.listen) { setOrigin(value.listen.origin); setAddress(value.listen.address); setPort(value.listen.port); setCertificate(value.listen.certificate || ""); setKey(value.listen.private_key || ""); }
        }
      } catch (failure) { if (!disposed && current === revision.current) { setStatus(null); setInvitation(null); setError('Desktop connection unavailable. Retrying…'); } }
      finally { if (!disposed) timer = setTimeout(sync, 4000); }
    }
    sync(); return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [active, expanded]);
  const expireInvitation = useRef(() => setInvitation(null)).current;
  async function action(path, body = {}) {
    revision.current++; acting.current = true; setBusy(true); setError("");
    try { const value = await mobileControl(path, body); if (path === "/invitation") setInvitation(value); else { setStatus(value); if (path !== '/client-update') setInvitation(null); } }
    catch (failure) { setStatus(null); setInvitation(null); setError(failure.message); }
    finally { acting.current = false; setBusy(false); }
  }
  return <section className="dashboard-card mobile-control"><h2>Mobile companion</h2><p className="dashboard-note">Use a paired phone for chat, image batches, Gallery and character profiles.</p><button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Hide mobile controls" : "Show mobile controls"}</button>{expanded && <>
    <p role="status">{!status ? "Checking desktop connection…" : status.running ? `Listening for paired phones at ${status.origin}` : "Mobile access is off. It stays off after each desktop restart."}</p>
    {error && <p role="alert">{error}</p>}{status && !status.build_ready && <p>Build the mobile app with <code>npm run build:mobile</code> before starting.</p>}
    <details><summary>Connection and privacy information</summary><p>Use a trusted HTTPS connection on your private network or VPN. Paired phones can read all conversations, visible unlocked gallery images and character profiles. They can name chats, queue chat/image jobs and batches, edit character profiles, link visible Saved Images and download originals. Vault unlock and filesystem administration stay on the desktop. Scan the locally generated QR code or paste the code to pair. Invitations are single-use and expire after five minutes; phone access expires after 30 days and can be revoked below.</p><p>For private remote access, configure Tailscale Serve separately to forward your HTTPS device address to this loopback port. This panel does not install a VPN, configure certificates or change your firewall. Direct LAN HTTPS requires trusted certificate and key files matching the chosen private IP.</p><p>Keep the desktop awake for jobs. Browser closure does not cancel them; a desktop restart marks unfinished jobs interrupted. Revoke blocks further phone access but does not cancel accepted jobs or erase files already downloaded. Backups of desktop app data include mobile job content and credential hashes.</p></details>
    <div className="bridge-fields"><label>HTTPS address<input value={origin} placeholder="https://desktop.your-tailnet.ts.net" onChange={event => setOrigin(event.target.value)} disabled={status?.running} /></label><label>Listen address<input value={address} onChange={event => setAddress(event.target.value)} disabled={status?.running} /></label><label>Listen port<input type="number" min="1024" max="65535" value={port} onChange={event => setPort(Number(event.target.value))} disabled={status?.running} /></label></div>
    <details><summary>Direct LAN certificate files</summary><div className="bridge-fields"><label>Certificate path<input value={certificate} onChange={event => setCertificate(event.target.value)} disabled={status?.running} /></label><label>Private-key path<input value={key} onChange={event => setKey(event.target.value)} disabled={status?.running} /></label></div></details>
    <div className="bridge-actions"><button disabled={busy || !status || status.running || !status.build_ready || !origin.trim()} onClick={() => action("/start", { origin: origin.trim(), address: address.trim(), port, certificate: certificate.trim(), private_key: key.trim() })}>Start mobile connection</button><button disabled={busy || !status?.running || !!status?.active_jobs} onClick={() => action("/stop")}>Stop mobile connection</button><button disabled={busy || !status?.running} onClick={() => action("/invitation")}>Create phone invitation</button></div>
    {!!status?.active_jobs && <p>{status.active_jobs} active mobile job(s). Finish or cancel them on the phone before stopping.</p>}
    {invitation && status?.running && <PhoneInvitation invitation={invitation} origin={status.origin} onExpired={expireInvitation} />}
    <section aria-label="Phone app updates"><h3>Phone app updates</h3><p>Build and send the latest phone interface from this desktop. Open phones show an update prompt; their drafts stay in place until they choose to reload.</p>
      <button disabled={busy || updating || !update?.can_build || update?.restart_required} onClick={() => action('/client-update')}>{updating ? 'Building phone update…' : 'Update phone app'}</button>
      {update?.message && <p role={update.phase === 'error' ? 'alert' : 'status'}>{update.message}</p>}
      {update?.restart_required && <p>Desktop backend changes need a restart first. Finish active jobs, restart the desktop, then update the phone.</p>}
      {update && !update.can_build && <p>Build dependencies are unavailable in this desktop installation.</p>}
      {update?.version && <p className="dashboard-note">Available phone version: {update.version.slice(0, 8)}{!status?.running && ' · Start mobile connection to deliver it.'}</p>}
      <details><summary>How phone updates work</summary><p>This button compiles the phone interface using installed local dependencies. It keeps previous files available while phones use them. It does not restart the desktop or interrupt accepted jobs. No chats, images or pairing credentials are copied into the update.</p><p>After this feature is installed, reopen an older phone app once to receive update support. Phones show their version after reconnecting. Changes to Android permissions or native APK features still need a newly installed APK; desktop backend changes need a desktop restart.</p></details>
    </section>
    <ul>{(status?.devices || []).map(device => <li key={device.id}>{device.name} · {device.enabled ? device.expired ? "Expired · pair again" : "Paired" : "Revoked"}{device.enabled && !device.expired && update?.version && <span> · {!status.running || !device.last_seen || Date.now() / 1000 - device.last_seen > 45 ? 'Reconnect phone to check version' : !device.client_version ? 'Reload phone once for update support' : device.client_version === update.version ? 'Up to date' : 'Update available on phone'}</span>} <button disabled={busy || !device.enabled} onClick={() => action(`/devices/${device.id}/revoke`)}>Revoke phone access</button></li>)}</ul>
  </>}</section>;
}
