import { useEffect, useRef, useState } from "react";
import { bridgeRequest, bridgePending, bridgeJobStatus } from "../bridgeApi";
import { listSessions } from "../api";
import { useDispatch } from "../useStore";
import "./PCBridge.css";

export function BridgeJobs({ jobs, peers, busy, action, showResult, saveResult }) {
  return <div className="bridge-jobs">{jobs.length ? jobs.map(job => <article key={`${job.direction}-${job.id}`}>
    <h4>{job.direction === "incoming" ? "Working for" : "Sent to"} {peers.find(peer => peer.id === job.peer_id)?.name || "Paired PC"} · {job.payload.kind}</h4>
    <p className="bridge-prompt">{job.payload.prompt}</p>
    <p role="status">{bridgeJobStatus(job)}</p>
    {job.error && <p>{job.error}</p>}
    {job.connection_error && <p>{job.connection_error}</p>}
    <div className="bridge-actions">
      {bridgePending(job) && <button disabled={busy} onClick={() => action(`/jobs/${job.direction}/${job.id}/cancel`)}>Cancel job</button>}
      {job.direction === "outgoing" && job.connection_error && !job.cancel_requested && <button disabled={busy} onClick={() => action(`/jobs/outgoing/${job.id}/retry`)}>Retry delivery with same ID</button>}
      {job.status === "completed" && <button disabled={busy} onClick={() => showResult(job)}>View result</button>}
      {job.status === "completed" && job.direction === "outgoing" && <button disabled={busy} onClick={() => saveResult(job)}>{job.save_complete ? "Saved to Chats" : "Save result to Chats"}</button>}
      {!bridgePending(job) && <button disabled={busy} onClick={() => action(`/jobs/${job.direction}/${job.id}`, "DELETE")}>{job.direction === "incoming" ? "Clear worker result" : "Remove bridge record"}</button>}
    </div>
  </article>) : <p>No bridge jobs yet. Local work continues to use the existing workspaces.</p>}</div>;
}

export default function PCBridge() {
  const dispatch = useDispatch();
  const [status, setStatus] = useState(null), [jobs, setJobs] = useState([]);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [pollError, setPollError] = useState("");
  const [address, setAddress] = useState(""), [port, setPort] = useState(8765), [name, setName] = useState("My PC");
  const [invitation, setInvitation] = useState(""), [code, setCode] = useState("");
  const [peerId, setPeerId] = useState(""), [capabilities, setCapabilities] = useState(null);
  const [kind, setKind] = useState("chat"), [model, setModel] = useState(""), [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState(""), [size, setSize] = useState(1024), [steps, setSteps] = useState(24);
  const [result, setResult] = useState(null);
  const initialized = useRef(false), attempt = useRef(null), peerRef = useRef(peerId);
  peerRef.current = peerId;

  async function refresh() {
    const [next, history] = await Promise.all([bridgeRequest(), bridgeRequest("/jobs")]);
    setStatus(next); setJobs(history.jobs || []); setPollError("");
    if (!initialized.current) {
      initialized.current = true;
      setAddress(next.listen.address); setPort(next.listen.port); setName(next.name);
    }
  }
  useEffect(() => {
    let stopped = false, timer;
    async function poll() {
      try {
        const [next, history] = await Promise.all([bridgeRequest(), bridgeRequest("/jobs")]);
        if (!stopped) {
          setStatus(next); setJobs(history.jobs || []); setPollError("");
          if (!initialized.current) {
            initialized.current = true; setAddress(next.listen.address); setPort(next.listen.port); setName(next.name);
          }
        }
      } catch (failure) { if (!stopped) setPollError(`Bridge status unavailable. ${failure.message} Checks will continue automatically.`); }
      if (!stopped) timer = setTimeout(poll, 5000);
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if (!invitation) return;
    const timer = setTimeout(() => setInvitation(""), 300000);
    return () => clearTimeout(timer);
  }, [invitation]);

  async function perform(work) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await work(); await refresh(); }
    catch (failure) { setError(failure.message || "Bridge operation failed. Check status before resubmitting."); }
    finally { setBusy(false); }
  }
  const action = (path, method = "POST", body) => perform(async () => { await bridgeRequest(path, method, body); });
  async function inspectPeer() {
    const selected = peerId;
    setCapabilities(null); setModel("");
    await perform(async () => {
      const next = await bridgeRequest(`/peers/${selected}/capabilities`);
      if (peerRef.current === selected) setCapabilities(next);
    });
  }
  async function submit() {
    const body = { peer_id: peerId, kind, model, prompt, negative_prompt: negative, width: Number(size), height: Number(size), steps: Number(steps) };
    const signature = JSON.stringify(body);
    if (!attempt.current || attempt.current.signature !== signature) attempt.current = { signature, id: crypto.randomUUID() };
    await perform(async () => {
      await bridgeRequest("/jobs", "POST", { ...body, job_id: attempt.current.id });
      attempt.current = null;
      setNotice("Request recorded. Its result will return here; both PCs can continue local work.");
    });
  }
  const peers = status?.peers || [];
  const models = capabilities?.[`${kind}_models`] || [];
  const showResult = job => perform(async () => {
    const next = await bridgeRequest(`/jobs/${job.direction}/${job.id}`);
    setResult({ ...next.result, label: job.payload.prompt });
  });
  const saveResult = job => perform(async () => {
    await bridgeRequest(`/jobs/outgoing/${job.id}/save-chat`, "POST");
    const sessions = await listSessions();
    dispatch?.({ type: "SET_SESSIONS", payload: sessions });
    setNotice("Saved as a separate chat. Open it from the Chats list; existing chats were not changed.");
  });

  return <section className="dashboard-card pc-bridge" aria-label="PC bridge">
    <h2>PC bridge</h2>
    <p>Pair two PCs to delegate chat and image generation. Each PC keeps its own queue and models. Start the bridge explicitly on both PCs each time you open the app.</p>
    {error && <p role="alert">{error}</p>}{pollError && <p role="alert">{pollError}</p>}{notice && <p role="status">{notice}</p>}
    <p><strong>{pollError ? "Bridge status unknown" : !status ? "Checking bridge status…" : status.running ? `Listening at ${status.url}` : "Network bridge off"}</strong></p>
    {status?.listener_error && <p role="alert">{status.listener_error}</p>}
    {status?.logging?.detail && <p role="alert">{status.logging.detail}</p>}
    {status?.network?.warnings?.map(warning => <p role="alert" key={warning}>{warning}</p>)}
    {status?.network?.local_api && <p className="dashboard-note">Local app API: {status.network.local_api} · {status.logging?.file_available ? "Backend file logging active" : "Backend file logging unavailable"}</p>}
    <div className="bridge-fields">
      <label>PC name<input maxLength={60} value={name} disabled={status?.running || busy} onChange={event => setName(event.target.value)} /></label>
      <label>This PC’s private IPv4 address<input list="bridge-local-addresses" placeholder="192.168.1.20" value={address} disabled={status?.running || busy} onChange={event => setAddress(event.target.value)} /></label>
      <datalist id="bridge-local-addresses">{status?.network?.addresses?.map(item => <option key={`${item.name}-${item.address}`} value={item.address}>{item.name}</option>)}</datalist>
      <label>Port<input type="number" min={1024} max={65535} value={port} disabled={status?.running || busy} onChange={event => setPort(Number(event.target.value))} /></label>
    </div>
    <p className="dashboard-note">Find the Wi-Fi or Ethernet IPv4 address with ipconfig. Use a private LAN or VPN address. If Windows asks, allow this Python environment on private networks. Changing the address requires pairing again.</p>
    <div className="bridge-actions">
      {!status?.running ? <button disabled={busy || !!pollError || !status || !address || !name} onClick={() => action("/start", "POST", { address, port, name })}>Start bridge</button> :
        <button disabled={busy} onClick={() => perform(async () => { await bridgeRequest("/stop", "POST"); setInvitation(""); })}>Stop bridge</button>}
      <button disabled={busy || !status?.running} onClick={() => perform(async () => { setInvitation((await bridgeRequest("/invitation", "POST")).code); })}>Create pairing invitation</button>
    </div>
    {invitation && <div><label>Private invitation · expires in 5 minutes<textarea readOnly value={invitation} rows={3} /></label><button onClick={() => perform(async () => { await navigator.clipboard.writeText(invitation); setNotice("Invitation copied. Paste it only into your other PC’s bridge."); })}>Copy invitation</button></div>}
    <details><summary>Pair with another PC</summary><p>Create an invitation on the other PC and paste it here. This approves delegation in both directions. Keep the invitation private.</p>
      <label>Invitation<textarea rows={3} value={code} maxLength={14000} onChange={event => setCode(event.target.value)} /></label>
      <button disabled={busy || !status?.running || !code.trim()} onClick={() => perform(async () => { await bridgeRequest("/pair", "POST", { code }); setCode(""); setNotice("PCs paired in both directions."); })}>Pair PCs</button>
    </details>
    <h3>Paired PCs</h3>
    {peers.length ? <ul>{peers.map(peer => <li key={peer.id}>{peer.name} · {peer.url} · {peer.enabled ? "Paired" : "Revoked"} {peer.enabled && <button disabled={busy} onClick={() => action(`/peers/${peer.id}/revoke`)}>Revoke access</button>}</li>)}</ul> : <p>No PCs paired yet.</p>}
    <h3>Delegate a task</h3>
    <div className="bridge-fields">
      <label>Run on<select value={peerId} onChange={event => { setPeerId(event.target.value); setCapabilities(null); setModel(""); }}><option value="">Choose paired PC</option>{peers.filter(peer => peer.enabled).map(peer => <option value={peer.id} key={peer.id}>{peer.name}</option>)}</select></label>
      <button disabled={busy || !peerId} onClick={inspectPeer}>Check models and availability</button>
      <label>Task<select value={kind} onChange={event => { setKind(event.target.value); setModel(""); }}><option value="chat">Chat prompt</option><option value="image">Generate image</option></select></label>
      <label>Exact model<select value={model} onChange={event => setModel(event.target.value)}><option value="">Choose worker model</option>{models.map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>
    </div>
    {capabilities && <p>{capabilities.pending} bridge jobs outstanding · {typeof capabilities.host?.memory_available_bytes === "number" ? `${(capabilities.host.memory_available_bytes / 1024 ** 3).toFixed(1)} GiB RAM available at check time` : "RAM reading unavailable"}. {models.length ? "Model detected; workload fit still depends on available memory." : "No compatible models detected for this task."}</p>}
    {capabilities?.[`${kind}_error`] && <p role="status">{capabilities[`${kind}_error`]}</p>}
    {capabilities?.gpus?.map((gpu, index) => <p key={index}>{gpu.name} · {typeof gpu.vram_total_bytes === "number" && typeof gpu.vram_used_bytes === "number" ? `${(Math.max(0, gpu.vram_total_bytes - gpu.vram_used_bytes) / 1024 ** 3).toFixed(1)} GiB VRAM free at check time` : "VRAM availability unknown"}</p>)}
    <label>Prompt<textarea rows={4} maxLength={12000} value={prompt} onChange={event => setPrompt(event.target.value)} /></label>
    {kind === "image" && <div className="bridge-fields">
      <label>Negative prompt<input value={negative} maxLength={12000} onChange={event => setNegative(event.target.value)} /></label>
      <label>Square image size<select value={size} onChange={event => setSize(Number(event.target.value))}><option value={512}>512</option><option value={768}>768</option><option value={1024}>1024</option></select></label>
      <label>Steps<input type="number" min={1} max={50} value={steps} onChange={event => setSteps(Number(event.target.value))} /></label>
    </div>}
    <p className="dashboard-note">Only this prompt and these settings are sent. This first version does not send chat history, attachments, memories, knowledge collections, LoRAs or training datasets. Results stay in Bridge until you save them to Chats.</p>
    <button disabled={busy || !!pollError || !status?.running || !peerId || !model || !prompt.trim() || !peers.some(peer => peer.id === peerId && peer.enabled)} onClick={submit}>Send task to selected PC</button>
    <h3>Bridge jobs</h3>
    <BridgeJobs jobs={jobs} peers={peers} busy={busy} action={action} showResult={showResult} saveResult={saveResult} />
    {result && <section className="bridge-result" aria-label="Bridge result"><button onClick={() => setResult(null)}>Close result</button><h3>{result.label}</h3>
      {result.text && <pre>{result.text}</pre>}
      {result.image && <><img src={result.image} alt="Result generated on the paired PC" /><a href={result.image} download="bridge-result.png">Download PNG</a></>}
    </section>}
    <p className="dashboard-note">Keep both apps open. A sleeping or disconnected worker does not trigger an automatic replacement job. After reconnecting, status and results resume. This shares tasks, not GPU memory.</p>
  </section>;
}
