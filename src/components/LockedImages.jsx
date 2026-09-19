import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl } from "../api";
import * as api from "../imageLibraryApi";
import ImageViewer from "./ImageViewer";
import BulkActions, { SelectionCheckbox } from "./BulkActions";
import { useSelection, useBatchAction } from "../useSelection";
import CollectionPager from "./CollectionPager";

function VaultImage({ image, token, onExpired }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let owned, alive = true;
    const controller = new AbortController();
    setUrl(""); setError("");
    fetch(apiUrl(`/image-library/vault/images/${image.id}/content`), { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (response.status === 401) { onExpired(); throw Error("Unlock again to view images"); }
        if (!response.ok) throw Error("Could not load this locked image");
        const blob = await response.blob();
        if (alive) { owned = URL.createObjectURL(blob); setUrl(owned); }
      }).catch(failure => { if (alive && failure.name !== "AbortError") setError(failure.message); });
    return () => { alive = false; controller.abort(); if (owned) URL.revokeObjectURL(owned); };
  }, [image.id, token, onExpired]);
  return url ? <img src={url} alt={image.name} /> : <span role="status">{error || "Loading…"}</span>;
}

export default function LockedImages({ active, pending = [], onImported }) {
  const [configured, setConfigured] = useState(null);
  const [token, setToken] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [changingPin, setChangingPin] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [images, setImages] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(null);
  const [page, setPage] = useState(0);
  const selection = useSelection(images);
  const batch = useBatchAction();
  const expires = useRef(null);
  const epoch = useRef(0), liveToken = useRef("");
  const clear = useCallback(() => { epoch.current += 1; liveToken.current = ""; clearTimeout(expires.current); setToken(""); setImages([]); setView(null); setPin(""); setConfirm(""); setNewPin(""); setChangingPin(false); }, []);
  const lock = useCallback(() => {
    clear(); localStorage.setItem("image-vault-locked", String(Date.now()));
    void api.request("/vault/lock", "POST").catch(() => {});
  }, [clear]);
  useEffect(() => {
    if (!active) { clear(); return; }
    api.request("/vault/status").then(value => setConfigured(value.configured)).catch(failure => setError(failure.message));
    const hide = () => { if (document.hidden) lock(); };
    const storage = event => { if (event.key === "image-vault-locked") clear(); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("storage", storage);
    return () => { document.removeEventListener("visibilitychange", hide); window.removeEventListener("storage", storage); lock(); };
  }, [active, clear, lock]);
  const refresh = async auth => {
    const value = await api.request("/vault/images", "GET", null, auth);
    if (auth === liveToken.current) setImages(value.images);
  };
  async function unlock(event) {
    event.preventDefault(); if (busy) return;
    setError("");
    if (!configured && pin !== confirm) { setError("PINs do not match"); return; }
    setBusy(true);
    const current = epoch.current;
    try {
      const auth = await api.request(configured ? "/vault/unlock" : "/vault/setup", "POST", { pin });
      if (current !== epoch.current) { lock(); return; }
      localStorage.setItem("image-vault-locked", String(Date.now()));
      liveToken.current = auth.token;
      setToken(auth.token); setConfigured(true); setPin(""); setConfirm("");
      clearTimeout(expires.current); expires.current = setTimeout(lock, auth.expires_in * 1000);
      await refresh(auth.token);
    } catch (failure) { setError(failure.message); setPin(""); setConfirm(""); }
    finally { setBusy(false); }
  }
  function addPending() {
    return batch.run({ items: pending, action: image => api.request("/vault/import", "POST", api.sourceFor(image), token), verb: "Locked:",
      after: async result => { api.changed(); onImported?.(result); await refresh(token); } });
  }
  async function changePin(event) {
    event.preventDefault(); if (busy) return;
    if (newPin !== confirm) { setError("PINs do not match"); return; }
    const current = epoch.current;
    setBusy(true); setError("");
    try {
      const auth = await api.request("/vault/pin", "POST", { old_pin: pin, new_pin: newPin }, token);
      if (current !== epoch.current) { lock(); return; }
      liveToken.current = auth.token; setToken(auth.token);
      localStorage.setItem("image-vault-locked", String(Date.now()));
      clearTimeout(expires.current); expires.current = setTimeout(lock, auth.expires_in * 1000);
      setChangingPin(false); setPin(""); setNewPin(""); setConfirm("");
    } catch (failure) { setError(failure.message); setPin(""); }
    finally { setBusy(false); }
  }
  const pages = Math.max(1, Math.ceil(images.length / 12)), current = Math.min(page, pages - 1);
  return <section className="locked-images" aria-label="Locked Images">
    <h3>🔒 Locked Images</h3>
    <p>Locked images and identical copies are hidden throughout the app until restored. Unlocking this folder does not expose them in other views.</p>
    {!token ? <form onSubmit={unlock}>
      <h4>{configured ? "Enter your PIN" : "Set up a PIN"}</h4>
      <label>PIN<input aria-label="Locked Images PIN" type="password" inputMode="numeric" autoComplete="off" minLength={4} maxLength={12} pattern="[0-9]{4,12}" value={pin} onChange={event => setPin(event.target.value)} required /></label>
      {configured === false && <><label>Confirm PIN<input aria-label="Confirm Locked Images PIN" type="password" inputMode="numeric" autoComplete="off" minLength={4} maxLength={12} value={confirm} onChange={event => setConfirm(event.target.value)} required /></label>
        <p>Use 4–12 digits and keep your PIN safe; there is no PIN bypass. Private copies are encrypted. Existing source files and backups on disk are not encrypted by this feature.</p></>}
      <button disabled={busy || configured === null}>{configured ? "Unlock images" : "Set PIN"}</button>
    </form> : <>
      <button type="button" onClick={lock}>Lock now</button><small>Locks when you leave this folder, hide the app, or after 15 minutes.</small>
      <button type="button" disabled={busy || batch.busy} onClick={() => { setChangingPin(value => !value); setPin(""); setNewPin(""); setConfirm(""); }}>Change PIN</button>
      {changingPin && <form onSubmit={changePin}>
        <label>Current PIN<input aria-label="Current PIN" type="password" inputMode="numeric" autoComplete="off" minLength={4} maxLength={12} pattern="[0-9]{4,12}" required value={pin} onChange={event => setPin(event.target.value)} /></label>
        <label>New PIN<input aria-label="New PIN" type="password" inputMode="numeric" autoComplete="off" minLength={4} maxLength={12} pattern="[0-9]{4,12}" required value={newPin} onChange={event => setNewPin(event.target.value)} /></label>
        <label>Confirm new PIN<input aria-label="Confirm new PIN" type="password" inputMode="numeric" autoComplete="off" minLength={4} maxLength={12} pattern="[0-9]{4,12}" required value={confirm} onChange={event => setConfirm(event.target.value)} /></label>
        <button disabled={busy}>Save PIN</button>
      </form>}
      {pending.length > 0 && <button type="button" disabled={batch.busy} onClick={addPending}>Lock {pending.length} selected image(s)</button>}
      <BulkActions selection={selection} items={images} label="locked images" batch={batch} actions={[{ label: "Restore selected images", onClick: items => batch.run({ items, selection, action: image => api.request(`/vault/images/${image.id}/restore`, "POST", null, token), verb: "Restored:", confirm: `Restore ${items.length} image(s) to their original collections and allow their originals to appear throughout the app again? Review uploads stay out of General Images.`, after: async () => { api.changed(); await refresh(token); } }) }]} />
      <CollectionPager label="locked images" page={current} pages={pages} onChange={setPage} />
      <div className="image-gallery image-gallery-compact">{images.slice(current * 12, (current + 1) * 12).map(image => <div className="gallery-item-row" key={image.id}><SelectionCheckbox selection={selection} item={image} label={`locked image ${image.name}`} disabled={batch.busy} />
        <button className={`gallery-item ${selection.has(image) ? "is-selected" : ""}`} disabled={batch.busy} aria-pressed={selection.enabled ? selection.has(image) : undefined} onClick={() => selection.enabled ? selection.toggle(image) : setView(image.id)}><span className="gallery-thumbnail"><VaultImage image={image} token={token} onExpired={clear} /></span><span className="gallery-name">{image.name}</span></button>
      </div>)}</div>
      {!images.length && <p>No locked images yet. Select images in another folder and choose Lock selected images.</p>}
      <ImageViewer images={images} selectedId={view} onSelect={setView} onClose={() => setView(null)} active={active && !!token && !selection.enabled} renderImage={image => <VaultImage image={image} token={token} onExpired={clear} />} />
    </>}
    {pending.length > 0 && !token && <p>{pending.length} selected image(s) waiting. Unlock to move them here.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
