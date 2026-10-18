import React, { useEffect, useRef, useState } from "react";
import ImageGenerationForm, { mobileImageSubmission } from "./ImageGenerationForm";
import { defaultImageSettings } from "../../src/imageGenerationDefaults";
import { finished, mediaUrl, observeJob, prepareImageShare, request, sharePreparedImage, submission } from "./api";

const tabs = [["chat", "Chat", "◌"], ["generate", "Create", "✧"], ["gallery", "Gallery", "▧"], ["jobs", "Jobs", "≋"]];

function ModelSelect({ models = [], value, onChange, label = "Model" }) {
  return <label>{label}<select value={value} onChange={event => onChange(event.target.value)}><option value="">Choose a desktop model</option>{models.map(model => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}</select></label>;
}

function Pair({ onPaired }) {
  const [code, setCode] = useState(""); const [name, setName] = useState("My phone");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function pair(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { await request("/api/pair", { method: "POST", body: { code: code.trim(), name: name.trim() } }); setCode(""); onPaired(); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <section className="pair panel"><span className="eyebrow">PRIVATE BY DESIGN</span><h2>Your workstation.<br />A little closer.</h2><p>Chat, create and explore from your phone. Your desktop does the heavy lifting.</p><form onSubmit={pair}><label>Device name<input autoComplete="off" maxLength={60} value={name} onChange={event => setName(event.target.value)} /></label><label>Pairing code<input autoComplete="off" autoCapitalize="none" spellCheck="false" maxLength={100} value={code} onChange={event => setCode(event.target.value)} placeholder="Paste the invitation from your desktop" /></label><button className="primary" disabled={busy || !code.trim() || !name.trim()}>{busy ? "Pairing…" : "Connect to desktop"}</button></form>{error && <p role="alert" className="error">{error}</p>}<details><summary>How to connect</summary><p>Open Dashboard → Mobile companion on your desktop. Start the approved private HTTPS connection and create a pairing code. Open that HTTPS address on your phone and paste the code here. Both devices must be on the configured private network or VPN.</p><p>Add this page to your home screen using your browser's install or share menu. Keep the desktop awake for background jobs.</p></details></section>;
}

function JobCard({ job, onCancel, onOpen, onDismiss }) {
  return <article className="job panel"><div className="row"><span className="eyebrow">{job.kind === "image" ? "IMAGE" : "CHAT"}</span><span className={`badge ${job.status}`}>{job.status}</span></div><h3>{job.prompt || "Desktop job"}</h3><p className="muted">{job.model}</p>{!finished(job.status) && <progress aria-label="Job progress" max="100" {...(Number.isFinite(job.progress?.percent) ? { value: job.progress.percent } : {})} />}<p className="muted">{job.progress?.detail || job.progress?.stage}</p>{job.error && <p role="alert" className="error">{job.error}</p>}<div className="row"><button onClick={() => onOpen(job)}>View conversation</button>{finished(job.status) ? <button onClick={() => onDismiss(job)}>Dismiss job</button> : <button disabled={job.status === "cancelling"} onClick={() => onCancel(job)}>{job.status === "cancelling" ? "Cancelling…" : "Cancel job"}</button>}</div></article>;
}

function FullImage({ item, onClose }) {
  const dialog = useRef(null); const [file, setFile] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { dialog.current.showModal(); }, []);
  async function share() {
    setBusy(true); setError("");
    try { if (file) await sharePreparedImage(file); else setFile(await prepareImageShare(item)); }
    catch (failure) { if (failure.name !== "AbortError") setError(failure.message); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="viewer" aria-label={item.name} onCancel={onClose}><div className="row"><h2>{item.name}</h2><button autoFocus onClick={onClose} aria-label="Close image">✕</button></div><img src={mediaUrl(item.url)} alt={item.name} /><div className="row"><a className="button primary" href={mediaUrl(item.url, true)} download={item.name}>Download original</a><button disabled={busy} onClick={share}>{busy ? "Preparing…" : file ? "Share image" : "Prepare to share"}</button></div>{file && <p className="muted">Original ready. Tap Share image to choose an app.</p>}{error && <p role="alert" className="error">{error}</p>}<p className="muted">Original desktop file · full resolution</p></dialog>;
}

function Gallery({ online, refreshKey }) {
  const [items, setItems] = useState([]); const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0); const [search, setSearch] = useState("");
  const [view, setView] = useState(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setBusy(true);
    const timer = setTimeout(() => request(`/api/gallery?offset=${page * 24}&limit=24&search=${encodeURIComponent(search)}`, { signal: controller.signal }).then(value => { setItems(value.images); setTotal(value.total); setError(""); }).catch(failure => { if (failure.name !== "AbortError") setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setBusy(false); }), 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [page, search, online, refreshKey]);
  useEffect(() => { if (!view) return; const close = event => { if (event.key === "Escape") setView(null); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [view]);
  return <section><div className="section-heading"><div><span className="eyebrow">ON YOUR DESKTOP</span><h2>Gallery</h2></div><span className="muted">{total} images</span></div><label className="search">Search images<input type="search" value={search} placeholder="Find a saved moment…" onChange={event => { setSearch(event.target.value); setPage(0); }} /></label>{error && <p className="error" role="alert">{error}</p>}{busy && <p role="status" className="muted">Loading images…</p>}<div className="gallery">{items.map(item => <button className="image-tile" key={item.id} onClick={() => setView(item)} aria-label={`View ${item.name}`}><img src={mediaUrl(item.url) + "?thumbnail=true"} loading="lazy" alt={item.name} /><span>{item.name}</span></button>)}</div>{!busy && !items.length && <p className="empty">No visible images here yet. Images you create on the desktop or phone will appear here.</p>}<div className="row pagination"><button disabled={page === 0 || busy} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page + 1}</span><button disabled={(page + 1) * 24 >= total || busy} onClick={() => setPage(value => value + 1)}>Next</button></div>{view && <FullImage item={view} onClose={() => setView(null)} />}</section>;
}

export default function Companion() {
  const [tab, setTab] = useState("chat"); const [state, setState] = useState(null);
  const [auth, setAuth] = useState(false); const [online, setOnline] = useState(false);
  const [status, setStatus] = useState("Connecting to desktop…"); const [error, setError] = useState("");
  const [session, setSession] = useState(null); const selected = useRef(null);
  const [models, setModels] = useState({}); const [chatModel, setChatModel] = useState("");
  const [prompt, setPrompt] = useState(""); const [imageSettings, setImageSettings] = useState(() => ({ ...defaultImageSettings }));
  const imageCatalog = { models: models.image_models || [], loras: models.image_loras || [], runtime: models.image_runtime, loraError: models.lora_error };
  const changeImageSettings = values => setImageSettings(current => ({ ...current, ...values }));
  const [pending, setPending] = useState(null); const pendingRef = useRef(null); const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(null); const [epoch, setEpoch] = useState(0); const [connection, setConnection] = useState(false);
  const sequence = useRef(0);
  const messagesElement = useRef(null), followLatest = useRef(true);
  useEffect(() => { followLatest.current = true; const element = messagesElement.current; if (element) element.scrollTop = element.scrollHeight; }, [session?.id, tab]);
  useEffect(() => { const element = messagesElement.current; if (element && followLatest.current) element.scrollTop = element.scrollHeight; }, [session?.messages?.length, live?.text]);

  async function loadSession(id) {
    const generation = ++sequence.current; selected.current = id;
    if (!id) { setSession(null); return; }
    const value = await request(`/api/sessions/${encodeURIComponent(id)}`);
    if (generation === sequence.current) setSession(value);
  }
  useEffect(() => {
    let alive = true, timer, failures = 0, syncing = false; const controller = new AbortController();
    async function sync() {
      if (syncing) return;
      syncing = true; clearTimeout(timer);
      try {
        const value = await request("/api/state", { signal: controller.signal });
        if (!alive) return;
        setState(value); setAuth(true); setOnline(true); setStatus("Connected to desktop"); failures = 0;
        if (selected.current && value.sessions.some(item => item.id === selected.current)) await loadSession(selected.current);
        else if (selected.current) { selected.current = null; setSession(null); }
      } catch (failure) {
        if (!alive) return;
        setOnline(false); failures++;
        if (failure.status === 401) { setAuth(false); setState(null); setSession(null); selected.current = null; setLive(null); setStatus("Pair this device"); }
        else setStatus("Desktop unavailable · reconnecting…");
      } finally { syncing = false; if (alive) timer = setTimeout(sync, Math.min(30000, 2000 * 2 ** Math.min(failures, 4))); }
    }
    const resume = () => { if (document.visibilityState !== "hidden") sync(); };
    sync(); window.addEventListener("online", resume); document.addEventListener("visibilitychange", resume);
    return () => { alive = false; controller.abort(); clearTimeout(timer); window.removeEventListener("online", resume); document.removeEventListener("visibilitychange", resume); };
  }, [epoch]);
  useEffect(() => {
    if (!auth || !online) return;
    const controller = new AbortController();
    request("/api/models", { signal: controller.signal }).then(value => { setModels(value); setChatModel(current => current || value.chat_models?.[0]?.id || ""); setImageSettings(current => ({ ...current, modelId: current.modelId || value.image_models?.[0]?.id || "" })); }).catch(failure => { if (failure.name !== "AbortError") setError(failure.message); });
    return () => controller.abort();
  }, [auth, online]);
  const active = (state?.jobs || []).find(job => job.session_id === session?.id && !finished(job.status));
  useEffect(() => {
    setLive(null); if (!active?.id || !auth) return;
    return observeJob(active.id, job => { setLive(job); if (finished(job.status)) { setEpoch(value => value + 1); loadSession(job.session_id).catch(failure => setError(failure.message)); } }, failure => setStatus(failure.message));
  }, [active?.id, auth]);

  async function createChat() {
    setBusy(true); setError("");
    try { const value = await request("/api/sessions", { method: "POST", body: { title: "Mobile chat" } }); sequence.current++; selected.current = value.id; setSession(value); setEpoch(value => value + 1); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  async function send(event, kind) {
    event.preventDefault(); if (pendingRef.current || busy || !session) return;
    let values;
    try { values = kind === "image" ? mobileImageSubmission(imageSettings, imageCatalog) : { model: chatModel, prompt }; }
    catch (failure) { setError(failure.message); return; }
    const receipt = submission({ kind, session_id: session.id, expected_revision: session.revision, ...values });
    pendingRef.current = receipt; setPending(receipt); await deliver(receipt);
  }
  async function deliver(receipt) {
    setBusy(true); setError("");
    try { await receipt.send(); pendingRef.current = null; setPending(null); if (receipt.body.kind === "chat") setPrompt(""); else setTab("jobs"); setEpoch(value => value + 1); }
    catch (failure) {
      if (failure.status && failure.status < 500) { pendingRef.current = null; setPending(null); }
      setError(failure.status === 409 ? "This conversation changed. Review the refreshed history, then send again." : failure.message);
      if (failure.status === 409) loadSession(receipt.body.session_id).catch(() => {});
    } finally { setBusy(false); }
  }
  async function cancel(job) { try { await request(`/api/jobs/${job.id}/cancel`, { method: "POST" }); setEpoch(value => value + 1); } catch (failure) { setError(failure.message); } }
  const disabled = !online || busy || !!pending || !!active;

  return <div className="companion"><header><div className="brand"><img src="/icon.svg" alt="" /><div><h1>Workstation<span>COMPANION</span></h1></div></div><button className="connection" onClick={() => setConnection(value => !value)} aria-label="Connection details"><span className={online ? "dot online" : "dot"} />{online ? "Desktop" : "Offline"}</button></header><div className="connection-status" role="status">{status}</div><main>{connection && <section className="panel"><h2>Connection</h2><p>{state?.device?.name || "Unpaired device"}</p><p>Desktop jobs continue when this page closes. The desktop must stay awake. On reconnect, the same jobs and conversation history are loaded.</p><p>Install from your browser's menu or Add to Home Screen. Only the app shell is cached for offline use.</p><button onClick={() => setEpoch(value => value + 1)}>Reconnect now</button>{auth && <button onClick={async () => { try { await request("/api/logout", { method: "POST" }); setAuth(false); setState(null); setSession(null); setLive(null); setPrompt(""); setImageSettings({ ...defaultImageSettings }); setEpoch(value => value + 1); } catch (failure) { setError(failure.message); } }}>Disconnect this phone</button>}</section>}{error && <p role="alert" className="error banner">{error}</p>}{pending && <div className="panel"><p>Delivery is unconfirmed. Retry uses the same job ID and cannot generate a second result.</p><button disabled={busy || !online} onClick={() => deliver(pending)}>Retry same submission</button></div>}{!auth ? <Pair onPaired={() => setEpoch(value => value + 1)} /> : <>
      {(tab === "chat" || tab === "generate") && <div className="session-picker"><label>Conversation<select value={session?.id || ""} onChange={event => { setSession(null); loadSession(event.target.value).catch(failure => setError(failure.message)); }}><option value="">Choose a conversation</option>{(state?.sessions || []).map(item => <option key={item.id} value={item.id}>{item.title || "Untitled chat"}</option>)}</select></label><button disabled={!online || busy} onClick={createChat} aria-label="New conversation">＋ New</button></div>}
      {tab === "chat" && <section><div className="section-heading"><div><span className="eyebrow">THINK TOGETHER</span><h2>{session?.title || "A new perspective"}</h2></div></div><ModelSelect models={models.chat_models} value={chatModel} onChange={setChatModel} />{models.chat_error && <p className="error">{models.chat_error}</p>}<div className="messages" ref={messagesElement} onScroll={event => { const element = event.currentTarget; followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}>{!session?.messages?.length && <p className="empty">Choose or create a conversation.<br />Your desktop history stays in sync.</p>}{(session?.messages || []).map(message => <article key={message.id} className={`message ${message.role}`}><span className="eyebrow">{message.role === "user" ? "YOU" : "WORKSTATION"}</span><div>{message.content}</div>{(message.images || []).map(item => <a href={mediaUrl(item.url, true)} key={item.id} download={item.name}><img src={mediaUrl(item.url) + "?thumbnail=true"} alt={item.name} /></a>)}</article>)}{live?.text && <article className="message assistant"><span className="eyebrow">WORKSTATION · {live.status}</span><div>{live.text}</div></article>}{active && !live?.text && <p role="status" className="muted">{live?.progress?.detail || "Your desktop is working…"}</p>}</div><form className="composer panel" onSubmit={event => send(event, "chat")}><label className="sr-only" htmlFor="chat-prompt">Message</label><textarea id="chat-prompt" value={prompt} maxLength={12000} onChange={event => setPrompt(event.target.value)} rows={3} placeholder="Ask your workstation…" /><div className="row"><span className="muted">Runs on your desktop</span><button className="primary" disabled={disabled || !session || !chatModel || !prompt.trim()}>Send ↗</button></div></form></section>}
      {tab === "generate" && <ImageGenerationForm settings={imageSettings} onChange={changeImageSettings} catalog={imageCatalog} error={models.image_error} disabled={disabled || !session} onSubmit={event => send(event, "image")} />}
      {tab === "gallery" && <Gallery online={online} refreshKey={epoch} />}
      {tab === "jobs" && <section><div className="section-heading"><div><span className="eyebrow">WORK CONTINUES HERE</span><h2>Desktop jobs</h2></div><button onClick={() => setEpoch(value => value + 1)}>Refresh</button></div>{!(state?.jobs || []).length && <p className="empty">Your chat and image jobs will appear here.</p>}{(state?.jobs || []).map(job => <JobCard key={job.id} job={job} onCancel={cancel} onDismiss={async job => { try { await request(`/api/jobs/${job.id}`, { method: "DELETE" }); setEpoch(value => value + 1); } catch (failure) { setError(failure.message); } }} onOpen={job => { setTab("chat"); loadSession(job.session_id).catch(failure => setError(failure.message)); }} />)}</section>}
    </>}</main>{auth && <nav aria-label="Companion navigation">{tabs.map(([id, label, icon]) => <button key={id} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}><span aria-hidden="true">{icon}</span>{label}{id === "jobs" && (state?.jobs || []).some(job => !finished(job.status)) && <i />}</button>)}</nav>}</div>;
}
