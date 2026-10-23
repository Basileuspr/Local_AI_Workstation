import React, { useEffect, useRef, useState } from "react";
import useFreshResource from './useFreshResource';
import { androidPairingLink, consumePairingLink } from './pairing';
import CodeMessage from '../../../src/components/CodeMessage';
import ResponseLengthControl from '../../../src/components/ResponseLengthControl';
import { normalizeResponseLength } from '../../../src/responseBudget';
import FullImage from "./ImageViewer";
import ClientUpdate from "./ClientUpdate";
import ImageGenerationForm, { mobileImageSubmission, mobileImageBatchSubmission } from "./ImageGenerationForm";
import ConversationPicker from './ConversationPicker';
import { defaultImageSettings } from "../../../src/imageGenerationDefaults";
import { finished, mediaUrl, observeJob, request, submission } from "./api";

const tabs = [["chat", "Chat", "◌"], ["generate", "Create", "✧"], ["gallery", "Gallery", "▧"], ["jobs", "Jobs", "≋"]];
export const defaultGalleryFilters = { search: "", sort: "newest", source: "all", session_id: "", days: "0" };

function ModelSelect({ models = [], value, onChange, label = "Model" }) {
  return <label>{label}<select value={value} onChange={event => onChange(event.target.value)}><option value="">Choose a desktop model</option>{models.map(model => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}</select></label>;
}

function ResponseUsage({ value }) {
  if (!value) return null;
  return <p className="muted response-usage">{value.effective_tokens != null && <>Applied output cap: {value.effective_tokens.toLocaleString()} tokens{value.requested_tokens > value.effective_tokens ? ` (requested ${value.requested_tokens.toLocaleString()}; reduced for context)` : ''}. </>}{value.generated_tokens != null && <>Generated: {value.generated_tokens.toLocaleString()} tokens, including thinking. </>}{value.limit_reached && <>Output limit reached; the answer may be incomplete.</>}</p>;
}

function Pair({ onPaired, initialCode = "" }) {
  const [code, setCode] = useState(initialCode); const [name, setName] = useState("My phone");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { setCode(initialCode); }, [initialCode]);
  useEffect(() => { if (!code) return; const timer = setTimeout(() => { setCode(""); setError("Invitation expired. Create a fresh invitation on the desktop."); }, 300000); return () => clearTimeout(timer); }, [code]);
  const nativeLink = typeof window !== 'undefined' && window.location?.origin ? androidPairingLink(window.location.origin, code.trim()) : '';
  async function pair(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { await request("/api/pair", { method: "POST", body: { code: code.trim(), name: name.trim() } }); setCode(""); onPaired(); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <section className="pair panel"><span className="eyebrow">PRIVATE BY DESIGN</span><h2>Your workstation.<br />A little closer.</h2><p>Chat, create and explore from your phone. Your desktop does the heavy lifting.</p><form onSubmit={pair}><label>Device name<input autoComplete="off" maxLength={60} value={name} onChange={event => setName(event.target.value)} /></label><label>Pairing code<input autoComplete="off" autoCapitalize="none" spellCheck="false" maxLength={100} value={code} onChange={event => setCode(event.target.value)} placeholder="Paste the invitation from your desktop" /></label><button className="primary" disabled={busy || !code.trim() || !name.trim()}>{busy ? "Pairing…" : "Connect to desktop"}</button></form>{nativeLink && !window.LawAndroid && <p><a className="button" href={nativeLink}>Open Android app to pair</a><br /><small>Requires Companion 0.2.0 or newer. Pair here for browser use; the Android app pairs separately.</small></p>}{error && <p role="alert" className="error">{error}</p>}<details><summary>How to connect</summary><p>Open Dashboard → Mobile companion on your desktop. Start the private HTTPS connection and create an invitation. Scan its QR code with your phone camera, then choose the Android app or connect in this browser. You can also open the saved HTTPS address and paste the invitation code. Both devices must be on the configured private network or VPN.</p><p>Add this page to your home screen using your browser's install or share menu. Keep the desktop awake for background jobs.</p></details></section>;
}

function JobCard({ job, online, onCancel, onCancelImage, onOpen, onDismiss }) {
  return <article className="job panel"><div className="row"><span className="eyebrow">{job.kind === "image" ? job.batch_count > 1 ? `IMAGE BATCH · ${job.batch_count}` : "IMAGE" : "CHAT"}</span><span className={`badge ${job.status}`}>{job.status}</span></div>
    <h3>{job.prompt || "Desktop job"}</h3><p className="muted">{job.model}</p>
    {!finished(job.status) && <progress aria-label="Job progress" max="100" {...(Number.isFinite(job.progress?.percent) ? { value: job.progress.percent } : {})} />}
    <p className="muted">{job.progress?.detail || job.progress?.stage || (!job.started && !finished(job.status) ? 'Waiting for earlier work in this conversation' : '')}</p>
    {job.error && <p role="alert" className="error">{job.error}</p>}
    {job.batch_count > 1 && <ol className="batch-members">{(job.members || []).map((member, index) => <li key={member.id}><div className="row"><span>Image {index + 1} · {member.status}</span>
      {!finished(job.status) && !finished(member.status) && <button disabled={!online || member.status === 'cancelling'} onClick={() => onCancelImage(job, member)}>Cancel image {index + 1}</button>}</div>
      {member.progress?.detail && <p className="muted">{member.progress.detail}</p>}{member.error && <p className="error">{member.error}</p>}</li>)}</ol>}
    <div className="row"><button disabled={!online} onClick={() => onOpen(job)}>View conversation</button>{finished(job.status) ? <button disabled={!online} onClick={() => onDismiss(job)}>Dismiss job</button> : <button disabled={!online || job.status === "cancelling"} onClick={() => onCancel(job)}>{job.status === "cancelling" ? "Cancelling…" : job.batch_count > 1 ? "Cancel batch" : "Cancel job"}</button>}</div></article>;
}

export function Gallery({ online, refreshKey, sessions = [], filters, onFiltersChange }) {
  const [page, setPage] = useState(0); const [reload, setReload] = useState(0);
  const [view, setView] = useState(null);
  const heading = useRef(null);
  const { search, sort, source, session_id, days } = filters;
  const filtered = !!search.trim() || source !== "all" || !!session_id || days !== "0";
  const params = new URLSearchParams({ offset: String(page * 24), limit: "24", search, sort, source, session_id, days });
  const result = useFreshResource(`/api/gallery?${params}`, { enabled: online, interval: 5000, delay: 200, refreshKey: `${refreshKey}:${reload}` });
  const items = result.value?.images || [], total = result.value?.total || 0;
  const error = result.error?.message || (!online ? 'Reconnect to load current images.' : '');
  const busy = result.loading;
  function change(values) { setPage(0); setView(null); onFiltersChange({ ...filters, ...values }); }
  function refresh() { setPage(0); setReload(value => value + 1); heading.current?.scrollIntoView({ block: "start" }); }
  function turnPage(value) { setView(null); setPage(value); heading.current?.scrollIntoView({ block: "start" }); }
  useEffect(() => { if (result.value && page > 0 && page * 24 >= total) setPage(0); }, [result.value, page, total]);
  useEffect(() => { setView(current => current ? items.find(item => item.id === current.id && item.url === current.url) || null : null); }, [result.value, online]);
  useEffect(() => { if (!view) return; const close = event => { if (event.key === "Escape") setView(null); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [view]);
  return <section className="gallery-section" aria-busy={busy}>
    <div className="section-heading" ref={heading}><div><span className="eyebrow">ON YOUR DESKTOP</span><h2>Gallery</h2></div><button disabled={busy || !online} onClick={refresh}>Refresh images</button></div>
    <div className="gallery-controls">
      <label className="search">Search images<input type="search" value={search} maxLength={200} placeholder="Name or conversation…" onChange={event => change({ search: event.target.value })} /></label>
      <label>Sort images<select aria-label="Sort images" value={sort} onChange={event => change({ sort: event.target.value })}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name_asc">Name A–Z</option><option value="name_desc">Name Z–A</option></select></label>
      <details className="gallery-filters"><summary>Filter images{filtered ? " · active" : ""}</summary><div className="gallery-filter-fields">
        <label>Image source<select aria-label="Image source" value={source} onChange={event => change({ source: event.target.value, ...(event.target.value === "library" ? { session_id: "" } : {}) })}><option value="all">All images</option><option value="session">Chat images</option><option value="library">Saved Images</option></select></label>
        <label>Conversation<select aria-label="Gallery conversation" value={session_id} disabled={source === "library"} onChange={event => change({ session_id: event.target.value, ...(event.target.value ? { source: "session" } : {}) })}><option value="">All conversations</option>{sessions.map(item => <option key={item.id} value={item.id}>{item.title || "Untitled chat"}</option>)}</select></label>
        <label>Updated<select aria-label="Image date range" value={days} onChange={event => change({ days: event.target.value })}><option value="0">Any time</option><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label>
        <p className="muted">Chat images use the conversation’s latest activity date, with newer images first within each chat. Saved Images use their save date. Filters apply across the whole gallery.</p>
      </div></details>
      <div className="row"><span className="muted" aria-live="polite">{busy ? "Loading images…" : `${total} ${filtered ? "matching " : ""}image${total === 1 ? "" : "s"}`}</span>{(filtered || sort !== "newest") && <button onClick={() => change(defaultGalleryFilters)}>Clear filters</button>}</div>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="gallery">{items.map(item => <button className="image-tile" key={item.id} onClick={() => setView(item)} aria-label={`View ${item.name}`}><img src={mediaUrl(item.url) + "?thumbnail=true"} loading="lazy" alt={item.name} /><span>{item.name}</span></button>)}</div>
    {!busy && !error && !items.length && <p className="empty">{filtered ? "No images match these filters. Try another source, conversation or date range." : "No visible images here yet. Images you create on the desktop or phone will appear here."}</p>}
    <div className="row pagination"><button disabled={page === 0 || busy} onClick={() => turnPage(page - 1)}>Previous</button><span>Page {page + 1} of {Math.max(1, Math.ceil(total / 24))}</span><button disabled={(page + 1) * 24 >= total || busy} onClick={() => turnPage(page + 1)}>Next</button></div>
    {view && <FullImage item={view} onClose={() => setView(null)} />}
  </section>;
}

export default function Companion({ pairingCode = "" }) {
  const [tab, setTab] = useState("chat"), [auth, setAuth] = useState(false), [error, setError] = useState("");
  const [pairCode, setPairCode] = useState(pairingCode);
  const [selectedId, setSelectedId] = useState(null); const selected = useRef(null);
  const [view, setView] = useState(null);
  const [chatModel, setChatModel] = useState("");
  const [outputTokens, setOutputTokens] = useState(() => {
    try { return normalizeResponseLength(globalThis.localStorage?.getItem('law-mobile-output-tokens')); } catch { return 1024; }
  });
  useEffect(() => { try { globalThis.localStorage?.setItem('law-mobile-output-tokens', String(outputTokens)); } catch { /* This session's setting still works. */ } }, [outputTokens]);
  const [prompt, setPrompt] = useState(""); const [imageSettings, setImageSettings] = useState(() => ({ ...defaultImageSettings }));
  const [galleryFilters, setGalleryFilters] = useState(() => ({ ...defaultGalleryFilters }));
  const [nameDraft, setNameDraft] = useState(false);
  const changeImageSettings = values => setImageSettings(current => ({ ...current, ...values }));
  const [pending, setPending] = useState(null); const pendingRef = useRef(null); const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(null); const [epoch, setEpoch] = useState(0); const [connection, setConnection] = useState(false);
  const lifetime = useRef(0);
  const stateResult = useFreshResource('/api/state', { refreshKey: epoch });
  const state = stateResult.value, online = !!state;
  const sessionResult = useFreshResource(`/api/sessions/${encodeURIComponent(selectedId || '')}`, { enabled: auth && online && !!selectedId, refreshKey: epoch });
  const session = sessionResult.value;
  const modelResult = useFreshResource('/api/models', { enabled: auth && online, interval: 30000, timeout: 25000 });
  const models = modelResult.value || {};
  const imageCatalog = { models: models.image_models || [], loras: models.image_loras || [], runtime: models.image_runtime, loraError: models.lora_error };
  const status = online ? 'Connected to desktop' : stateResult.error?.status === 401 ? 'Pair this device' : 'Desktop unavailable · reconnecting…';
  const messagesElement = useRef(null), followLatest = useRef(true);
  useEffect(() => { followLatest.current = true; const element = messagesElement.current; if (element) element.scrollTop = element.scrollHeight; }, [session?.id, tab]);
  useEffect(() => { const element = messagesElement.current; if (element && followLatest.current) element.scrollTop = element.scrollHeight; }, [session?.messages?.length, live?.text]);
  async function loadSession(id) { selected.current = id || null; setSelectedId(id || null); setView(null); }
  function forgetAccess() {
    lifetime.current++; setBusy(false); setAuth(false); selected.current = null; setSelectedId(null); setLive(null); setView(null);
    pendingRef.current = null; setPending(null); setPrompt(''); setImageSettings({ ...defaultImageSettings }); setChatModel(''); setNameDraft(false);
  }
  useEffect(() => {
    const lost = () => forgetAccess();
    const link = () => { const code = consumePairingLink(); if (code) setPairCode(code); };
    window.addEventListener('law-auth-lost', lost); window.addEventListener('hashchange', link);
    return () => { lifetime.current++; window.removeEventListener('law-auth-lost', lost); window.removeEventListener('hashchange', link); };
  }, []);
  useEffect(() => {
    if (state) {
      setAuth(true);
      if (selected.current && !state.sessions.some(item => item.id === selected.current)) loadSession(null);
    } else { setView(null); setLive(null); }
  }, [state]);
  useEffect(() => {
    if (sessionResult.error?.status === 404) loadSession(null);
    setView(current => current ? (session?.messages || []).flatMap(message => message.images || []).find(item => item.id === current.id && item.url === current.url) || null : null);
  }, [sessionResult.value, sessionResult.error]);
  useEffect(() => {
    if (!modelResult.value) return;
    setChatModel(current => models.chat_models?.some(item => item.id === current) ? current : models.chat_models?.[0]?.id || '');
    setImageSettings(current => ({ ...current, modelId: models.image_models?.some(item => item.id === current.modelId) ? current.modelId : models.image_models?.[0]?.id || '' }));
  }, [modelResult.value]);
  const sessionJobs = (state?.jobs || []).filter(job => job.session_id === session?.id && !finished(job.status));
  const active = sessionJobs.find(job => job.started || job.status === "running") || sessionJobs.at(-1);
  const activeChat = sessionJobs.some(job => job.kind === "chat");
  const pendingImages = sessionJobs.filter(job => job.kind === "image").reduce((count, job) => count + (job.members?.length ? job.members.filter(member => !finished(member.status)).length : job.batch_count || 1), 0);
  const pendingChats = sessionJobs.filter(job => job.kind === "chat").length;
  useEffect(() => {
    setLive(null); if (!active?.id || !auth || !online) return;
    return observeJob(active.id, job => { setLive(job); if (finished(job.status)) setEpoch(value => value + 1); }, () => setLive(null));
  }, [active?.id, auth, online]);

  async function saveName(mode, title) {
    const generation = lifetime.current;
    setBusy(true); setError("");
    try {
      const value = await request(mode === 'new' ? '/api/sessions' : `/api/sessions/${session.id}/metadata`, {
        method: mode === 'new' ? 'POST' : 'PATCH', body: { title, ...(mode === 'rename' ? { expected_revision: session.revision } : {}) } });
      if (generation !== lifetime.current) return false;
      await loadSession(value.id); setEpoch(value => value + 1); return true;
    } catch (failure) {
      if (generation === lifetime.current) { setError(failure.message); if (failure.status === 409) setEpoch(value => value + 1); }
      return false;
    } finally { if (generation === lifetime.current) setBusy(false); }
  }

  async function send(event, kind) {
    event.preventDefault(); if (pendingRef.current || busy || !session) return;
    let values;
    try { values = kind === "image" ? mobileImageSubmission(imageSettings, imageCatalog) : { model: chatModel, prompt, output_tokens: outputTokens }; }
    catch (failure) { setError(failure.message); return; }
    return submitValues(kind, values);
  }
  async function sendBatch(items) {
    try { return await submitValues('image', mobileImageBatchSubmission(items, imageCatalog)); }
    catch (failure) { setError(failure.message); return false; }
  }
  async function submitValues(kind, values) {
    if (pendingRef.current || busy || !session) return false;
    const receipt = submission({ kind, session_id: session.id, expected_revision: session.revision, ...values });
    pendingRef.current = receipt; setPending(receipt); return deliver(receipt);
  }
  async function deliver(receipt) {
    const generation = lifetime.current;
    setBusy(true); setError("");
    try {
      await receipt.send();
      if (generation !== lifetime.current) return;
      pendingRef.current = null; setPending(null);
      if (receipt.body.kind === "chat") setPrompt(current => current === receipt.body.prompt ? '' : current);
      setEpoch(value => value + 1);
      return true;
    }
    catch (failure) {
      if (generation !== lifetime.current) return;
      if (failure.status && failure.status < 500) { pendingRef.current = null; setPending(null); }
      setError(failure.message);
      if (failure.status === 409 && selected.current === receipt.body.session_id) setEpoch(value => value + 1);
      return false;
    } finally { if (generation === lifetime.current) setBusy(false); }
  }
  async function cancel(job) { try { await request(`/api/jobs/${job.id}/cancel`, { method: "POST" }); setEpoch(value => value + 1); } catch (failure) { setError(failure.message); } }
  async function cancelImage(job, member) { try { await request(`/api/jobs/${job.id}/images/${member.id}/cancel`, { method: 'POST' }); setEpoch(value => value + 1); } catch (failure) { setError(failure.message); } }
  const submitting = !online || !modelResult.value || busy || !!pending;
  const disabled = submitting;

  return <div className="companion"><header><div className="brand"><img src="/icon.svg" alt="" /><div><h1>Workstation<span>COMPANION</span></h1></div></div><button className="connection" onClick={() => setConnection(value => !value)} aria-label="Connection details" aria-expanded={connection} aria-controls="connection-details"><span className={online ? "dot online" : "dot"} />{online ? "Desktop" : "Offline"}</button></header><div className="connection-status" role="status">{status}</div><main>{connection && <section className="panel" id="connection-details"><h2>Connection</h2><p>{state?.device?.name || "Unpaired device"}</p><p>Desktop jobs continue when this page closes. The desktop must stay awake. On reconnect, the same jobs and conversation history are loaded.</p><p>Install from your browser's menu or Add to Home Screen. Only the app shell is cached. Private content is cleared while disconnected or in the background, then fetched again when you return. Chats and jobs refresh every two seconds, gallery images every five seconds, and available models every 30 seconds.</p><button onClick={() => setEpoch(value => value + 1)}>Reconnect now</button>{auth && <button onClick={async () => { try { await request("/api/logout", { method: "POST" }); forgetAccess(); window.dispatchEvent(new window.Event("law-auth-lost")); setEpoch(value => value + 1); } catch (failure) { setError(failure.message); } }}>Disconnect this phone</button>}</section>}{(error || sessionResult.error || modelResult.error) && <p role="alert" className="error banner">{error || sessionResult.error?.message || modelResult.error?.message}</p>}{pending && <div className="panel"><p>Delivery is unconfirmed. Retry uses the same job ID and cannot generate a second result.</p><button disabled={busy || !online} onClick={() => deliver(pending)}>Retry same submission</button></div>}{!auth ? <Pair initialCode={pairCode} onPaired={() => { setPairCode(""); setEpoch(value => value + 1); }} /> : <>
      <ClientUpdate version={state?.client_update?.version} blocked={busy || !!pending || !online} hasDraft={!!(nameDraft || prompt.trim() || imageSettings.prompt?.trim() || imageSettings.negativePrompt?.trim())} />
      <div hidden={tab !== "chat" && tab !== "generate"}><ConversationPicker sessions={state?.sessions || []} session={session} selectedId={selectedId} online={online} busy={busy || !!pending}
        onSelect={id => loadSession(id).catch(failure => setError(failure.message))} onSave={saveName} onDraftChange={setNameDraft} /></div>
      {tab === "chat" && <section><div className="section-heading"><div><span className="eyebrow">THINK TOGETHER</span><h2>{session?.title || "A new perspective"}</h2></div></div><ModelSelect label="Chat model" models={models.chat_models} value={chatModel} onChange={setChatModel} /><details className="mobile-response-options"><summary>Response size · {outputTokens > 0 ? `${outputTokens.toLocaleString()} tokens` : 'Automatic'}</summary><ResponseLengthControl value={outputTokens} onChange={setOutputTokens} contextWindow={models.chat_models?.find(model => model.id === chatModel)?.context_length} /><p className="muted">This phone remembers its own size setting. Changes apply to your next submission. Existing jobs keep their submitted limit.</p></details>{models.chat_error && <p className="error">{models.chat_error}</p>}<div className="messages" role="region" aria-label="Conversation messages" tabIndex={0} ref={messagesElement} onScroll={event => { const element = event.currentTarget; followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}>{!session?.messages?.length && <p className="empty">Choose or create a conversation.<br />Your desktop history stays in sync.</p>}{(session?.messages || []).map(message => <article key={message.id} className={`message ${message.role}`}><span className="eyebrow">{message.role === "user" ? "YOU" : "WORKSTATION"}</span><CodeMessage>{message.content}</CodeMessage><ResponseUsage value={message.response_usage} />{(message.images || []).map(item => <button className="image-preview" key={item.id} onClick={() => setView(item)} aria-label={`View ${item.name}`}><img src={mediaUrl(item.url) + "?thumbnail=true"} alt={item.name} /></button>)}</article>)}{live?.text && <article className="message assistant"><span className="eyebrow">WORKSTATION · {live.status}</span><CodeMessage>{live.text}</CodeMessage><ResponseUsage value={live.response_usage} /></article>}{active && !live?.text && <p role="status" className="muted">{live?.progress?.detail || "Your desktop is working…"}</p>}</div><form className="composer panel" onSubmit={event => send(event, "chat")}><label className="sr-only" htmlFor="chat-prompt">Message</label><textarea id="chat-prompt" value={prompt} maxLength={12000} onChange={event => setPrompt(event.target.value)} rows={3} placeholder="Ask your workstation…" /><div className="row"><span className="muted">Runs on your desktop</span>{active?.kind === "chat" && <button type="button" disabled={!online || active?.status === 'cancelling'} onClick={() => cancel(active)}>{active?.status === 'cancelling' ? 'Stopping…' : 'Stop reply'}</button>}<button className="primary" disabled={disabled || !session || !chatModel || !prompt.trim()}>{sessionJobs.length ? "Queue message ↗" : "Send ↗"}</button></div></form>{pendingChats > 0 && <div className="row"><p className="muted" role="status">{pendingChats} chat turn{pendingChats === 1 ? "" : "s"} pending. Each starts with the preceding completed history.</p><button onClick={() => setTab("jobs")}>View jobs</button></div>}{view && <FullImage item={view} onClose={() => setView(null)} />}</section>}
      {tab === "generate" && <ImageGenerationForm settings={imageSettings} onChange={changeImageSettings} catalog={imageCatalog} error={models.image_error} disabled={submitting || !session} pendingImages={pendingImages} activeChat={activeChat} onOpenJobs={() => setTab("jobs")} onSubmit={event => send(event, "image")} onBatchSubmit={sendBatch} />}
      {tab === "gallery" && <Gallery online={online} refreshKey={epoch} sessions={state?.sessions || []} filters={galleryFilters} onFiltersChange={setGalleryFilters} />}
      {tab === "jobs" && <section><div className="section-heading"><div><span className="eyebrow">WORK CONTINUES HERE</span><h2>Desktop jobs</h2></div><button onClick={() => setEpoch(value => value + 1)}>Refresh</button></div>{!(state?.jobs || []).length && <p className="empty">Your chat and image jobs will appear here.</p>}{(state?.jobs || []).map(job => <JobCard online={online} key={job.id} job={job} onCancel={cancel} onCancelImage={cancelImage} onDismiss={async job => { try { await request(`/api/jobs/${job.id}`, { method: "DELETE" }); setEpoch(value => value + 1); } catch (failure) { setError(failure.message); } }} onOpen={job => { setTab("chat"); loadSession(job.session_id).catch(failure => setError(failure.message)); }} />)}</section>}
    </>}</main>{auth && <nav aria-label="Companion navigation">{tabs.map(([id, label, icon]) => <button key={id} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}><span aria-hidden="true">{icon}</span>{label}{id === "jobs" && (state?.jobs || []).some(job => !finished(job.status)) && <i />}</button>)}</nav>}</div>;
}
