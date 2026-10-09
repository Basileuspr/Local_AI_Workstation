import {useContext, useEffect, useRef, useState} from 'react';
import {apiUrl} from '../api';
import {createPlaybackCapture, playbackAvailability} from '../playbackRecording';
import SoundOutputSettings from './SoundOutputSettings';
import {audioOutput} from '../audioOutput';
import './Tools.css';
import './LinkedApps.css';
import { takePianoSpotifyReference } from '../pianoSpotifyBridge';
import { NavigationOpenContext } from './AppLayout';
import { FloatingToolBoundsContext, avoidFloatingTool } from '../floatingToolBounds';
import { visibleSurfaceBounds } from '../browserPlacement';
import { useDispatch } from '../useStore';

async function request(path, options) {
  const response = await fetch(apiUrl('/integrations' + path), options);
  const value = await response.json();
  if (!response.ok) throw Error(typeof value.detail === 'string' ? value.detail : 'Integration request failed.');
  return value;
}
export default function AppIntegrations({active = true}) {
  const drawerOpen = useContext(NavigationOpenContext);
  const floatingTool = useContext(FloatingToolBoundsContext);
  const dispatch = useDispatch();
  const [pianoReference,setPianoReference] = useState(false);
  const [tab,setTab] = useState('discord'), [status,setStatus] = useState(null), [error,setError] = useState(''), [notice,setNotice] = useState('');
  const [server,setServer] = useState(''), [spotify,setSpotify] = useState(''), [embed,setEmbed] = useState(null), [busy,setBusy] = useState(false);
  const [message,setMessage] = useState({method:'webhook',webhook:'',bot_token:'',channel_id:'',content:'',title:'',description:''});
  const [files,setFiles] = useState([]), [recording,setRecording] = useState(false), [seconds,setSeconds] = useState(0), [audio,setAudio] = useState(null);
  const [transcript,setTranscript] = useState(''), [transcribing,setTranscribing] = useState(false);
  const [captureSource,setCaptureSource] = useState('system'), [opening,setOpening] = useState(false), [cancelling,setCancelling] = useState(false);
  const [captureSupport,setCaptureSupport] = useState(null), [signal,setSignal] = useState(null);
  const surface = useRef(null), fileInput = useRef(null), capture = useRef(null), captureBusy = useRef(false), urls = useRef(new Set()), mounted = useRef(true), audioPreview = useRef(null);
  const change = patch => setMessage(current => ({...current,...patch}));
  const desktop = window.workstationDesktop;
  async function refresh() { try {setStatus(await request('/status'));} catch(failure){setError(failure.message);} }
  async function checkCapture() {
    const unavailable = playbackAvailability(window);
    if (unavailable) {setCaptureSupport({supported:false,error:unavailable});return;}
    try {
      const value = await desktop.playbackCaptureStatus();
      if (mounted.current) setCaptureSupport({...value,error:value.supported ? '' : value.error || 'Playback recording requires the Windows desktop app.'});
    } catch { if (mounted.current) setCaptureSupport({supported:false,error:'Could not check desktop playback support. Fully restart the desktop app.'}); }
  }
  useEffect(() => {
    if (!active) return;
    const reference = takePianoSpotifyReference();
    if (reference) { setTab('spotify'); setSpotify(reference.url); setPianoReference(true); setNotice('Track reference from Mini Piano. Press Open Spotify player to load it, then Play to listen.'); }
  }, [active]);
  useEffect(() => {if(active)refresh();}, [active]);
  useEffect(() => {if(recording || opening)return audioOutput.holdCapture();},[recording,opening]);
  useEffect(() => {if(active && tab==='spotify')void checkCapture();}, [active,tab]);
  useEffect(() => {
    let alive = true;
    const place = () => {
      const bounds = visibleSurfaceBounds(surface.current);
      const visible = active && embed?.service === tab && !!bounds && !drawerOpen && !document.querySelector('dialog[open]');
      desktop?.placeLinkedContent?.({visible,bounds:avoidFloatingTool(bounds,floatingTool)}).catch(() => {});
    };
    place();
    if(!active || embed?.service !== tab) return;
    const timer = setInterval(() => {if(alive)place();}, 200);
    window.addEventListener('resize',place);
    return () => {alive=false; clearInterval(timer); window.removeEventListener('resize',place); desktop?.placeLinkedContent?.({visible:false}).catch(() => {});};
  },[active,tab,embed,drawerOpen,floatingTool]);
  useEffect(() => { mounted.current=true; return () => {
    mounted.current=false;capture.current?.cancel();capture.current=null;
    for(const url of urls.current)URL.revokeObjectURL(url);
    desktop?.closeLinkedContent?.().catch(() => {}); desktop?.cancelPlaybackCapture?.().catch(() => {});
  };},[]);
  useEffect(() => {
    if(!recording)return;
    const started=Date.now();
    const timer=setInterval(() => setSeconds(Math.floor((Date.now()-started)/1000)),500);
    return()=>clearInterval(timer);
  },[recording]);
  async function openEmbed() {
    setBusy(true);setError('');
    try {
      if(!desktop?.openLinkedContent)throw Error('Embedded applications require the desktop app.');
      const value=await request('/embed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({service:tab,value:tab==='spotify'?spotify:server})});
      const result=await desktop.openLinkedContent({service:tab,url:value.url});
      if(result?.error)throw Error(result.error);
      setEmbed({service:tab,url:value.url});
      if(tab==='spotify')void checkCapture();
    } catch(failure){setError(failure.message);}finally{setBusy(false);}
  }
  async function send() {
    setBusy(true);setError('');setNotice('');
    try {
      const body=new FormData();body.append('payload',JSON.stringify(message));
      for(const file of files)body.append('files',file);
      const result=await request('/discord/send',{method:'POST',body});
      setNotice(`Sent to Discord${result.message_id ? ` · Message ${result.message_id}` : ''}.`);
    } catch(failure){setError(failure.message);}finally{setBusy(false);}
  }
  async function startCapture() {
    if(captureBusy.current || capture.current)return;
    captureBusy.current=true;setOpening(true);setCancelling(false);setError('');setNotice('');setSignal(null);setSeconds(0);audioPreview.current?.pause();
    const session=createPlaybackCapture({source:captureSource,
      onRecording:value=>{if(mounted.current && capture.current===session){setRecording(value);if(value){setOpening(false);setTranscript('');}}},
      onSignal:value=>{if(mounted.current && capture.current===session)setSignal(value);},
      onFile:(blob,details)=>{
        if(!mounted.current || capture.current!==session)return;
        capture.current=null;
        const url=URL.createObjectURL(blob);urls.current.add(url);
        setAudio(previous=>{if(previous?.url){URL.revokeObjectURL(previous.url);urls.current.delete(previous.url);}return {blob,url,name:details.source==='spotify'?'spotify-player.webm':'windows-playback.webm',...details};});
        setNotice(details.signalMonitored && !details.signalDetected ? 'Recording finished, but no audio signal was detected. Listen before saving; check the source and output below.' : `Playback recording ready${details.reason==='time-limit'?' · five-minute limit reached':details.reason==='size-limit'?' · 64 MB limit reached':details.reason==='source-ended'?' · audio source ended':''}. Listen, download, or transcribe it.`);
      },
      onError:value=>{if(mounted.current && capture.current===session){capture.current=null;setError(value);setRecording(false);}},
    },window);
    capture.current=session;
    await session.ready;captureBusy.current=false;
    if(mounted.current){setOpening(false);setCancelling(false);}
  }
  function stopCapture(){capture.current?.stop();}
  function cancelCapture(){capture.current?.cancel();capture.current=null;setRecording(false);if(opening)setCancelling(true);else setNotice('Playback recording discarded. Your previous recording is still available.');}
  async function transcribe() {
    if(!audio || transcribing)return;
    setTranscribing(true);setError('');
    try {
      const body=new FormData();body.append('file',audio.blob,audio.name);body.append('acceleration','cpu');
      const response=await fetch(apiUrl('/audio/transcribe'),{method:'POST',body});const value=await response.json();
      if(!response.ok)throw Error(typeof value.detail==='string'?value.detail:'Transcription failed.');setTranscript(value.text || '');
    } catch(failure){setError(failure.message);}finally{setTranscribing(false);}
  }
  async function saveAudio() {
    if(!audio || busy)return;
    setBusy(true);setError('');
    try {
      const body=new FormData();body.append('file',audio.blob,audio.name);
      const saved=await request('/spotify/recordings',{method:'POST',body});
      setAudio(current=>current?.url===audio.url?{...current,saved}:current);
      setNotice('Recording saved in local application storage.');
    } catch(failure){setError(failure.message);}finally{setBusy(false);}
  }
  return <section className="tools-workspace linked-apps" aria-label="Linked applications">
    <header className="tools-heading"><h1>Linked applications</h1><button onClick={refresh}>Read active processes</button></header>
    <div className="linked-tabs" role="tablist" aria-label="Linked application">{['discord','spotify','phone'].map(id=><button key={id} role="tab" aria-selected={tab===id} onClick={()=>{setTab(id);setError('');setNotice('');}}>{id==='phone'?'Phone / scrcpy':id[0].toUpperCase()+id.slice(1)}</button>)}</div>
    {status && <p>{(status.processes[tab] || []).length} matching processes running{recording && <strong className="linked-recording"> · Recording playback · {seconds}s</strong>}</p>}
    {tab==='discord' && <>
      <fieldset className="linked-fields"><legend>Embedded Discord server</legend><label>Server ID<input value={server} maxLength={20} onChange={event=>setServer(event.target.value)} inputMode="numeric"/></label><p>Enable Server Widget in your server settings to show its members and invite link.</p><button disabled={busy} onClick={openEmbed}>Open Discord widget</button></fieldset>
      <fieldset disabled={busy} className="linked-fields"><legend>Send content and attachments</legend>
        <label>Connection<select value={message.method} onChange={event=>change({method:event.target.value})}><option value="webhook">Webhook</option><option value="bot">Bot</option></select></label>
        {message.method==='webhook'?<label>Webhook URL<input type="password" autoComplete="off" value={message.webhook} onChange={event=>change({webhook:event.target.value})}/></label>:<><label>Bot token<input type="password" autoComplete="off" value={message.bot_token} onChange={event=>change({bot_token:event.target.value})}/></label><label>Channel ID<input value={message.channel_id} maxLength={20} onChange={event=>change({channel_id:event.target.value})}/></label></>}
        <label>Message<textarea value={message.content} maxLength={2000} onChange={event=>change({content:event.target.value})}/></label>
        <label>Embed title<input value={message.title} maxLength={256} onChange={event=>change({title:event.target.value})}/></label>
        <label>Embed description<textarea value={message.description} maxLength={4096} onChange={event=>change({description:event.target.value})}/></label>
        <button onClick={()=>fileInput.current.click()}>Choose attachments</button><input ref={fileInput} hidden type="file" multiple onChange={event=>{setFiles(Array.from(event.target.files));event.target.value='';}}/>
        <ul>{files.map((file,index)=><li key={index}>{file.name} <button onClick={()=>setFiles(current=>current.filter((_,i)=>i!==index))}>Remove</button></li>)}</ul>
        <div className="linked-preview" aria-label="Discord message preview"><p>{message.content}</p><strong>{message.title}</strong><p>{message.description}</p>{files.length>0 && <p>{files.length} file attachments · first image appears in the embed</p>}</div>
        <button disabled={(!message.content && !message.title && !message.description && !files.length) || (message.method==='webhook'?!message.webhook:!message.bot_token || !message.channel_id)} onClick={send}>Send to Discord</button>
        <p>Credentials stay in this open workspace. Sending uploads the selected content to Discord. Automatic mentions are disabled.</p>
      </fieldset>
    </>}
    {tab==='spotify' && <>
      {pianoReference && <div className="tools-toolbar"><span>Mini Piano track reference</span><button disabled={!dispatch} onClick={() => dispatch({ type: 'SET_SIDEBAR_TAB', payload: 'break-room' })}>Return to piano</button></div>}
      <fieldset className="linked-fields"><legend>Embedded Spotify player</legend><label>Spotify link<input type="url" value={spotify} onChange={event=>setSpotify(event.target.value)} placeholder="https://open.spotify.com/track/…"/></label><button disabled={busy} onClick={openEmbed}>Open Spotify player</button></fieldset>
      <SoundOutputSettings recording={recording || opening}/>
      <fieldset className="linked-fields linked-capture"><legend>Playback recording</legend>
        <label>Recording source<select aria-label="Playback recording source" value={captureSource} disabled={recording || opening} onChange={event=>{setCaptureSource(event.target.value);setError('');setNotice('');}}><option value="system">Windows playback · all system audio</option><option value="spotify">Embedded Spotify player · player audio only</option></select></label>
        <div className="linked-capture-status" role="status">{captureSupport===null?'Checking desktop recording support…':captureSupport.error || 'Desktop capture supported. Start recording to check the selected audio source; the live meter confirms whether audio is arriving.'}</div>
        <ol className="linked-capture-steps">
          <li>Use the Windows desktop app and keep the desktop unlocked when starting.</li>
          <li>{captureSource==='system'?'Play Spotify through the same default Windows output as this app. Check Sound settings → Volume mixer; keep both apps unmuted.':'Open the embedded Spotify player above, then press Play inside that player. The separate Spotify desktop app is excluded from this source.'}</li>
          <li>Click Start playback recording, check the level meter, then Stop recording to create a playable preview.</li>
        </ol>
        {captureSource==='spotify' && !captureSupport?.spotify_ready && <p>Open the embedded Spotify player before starting this source. Loading its link alone does not start playback.</p>}
        <div className="tools-toolbar"><button disabled={recording || opening || transcribing || busy || !active || !captureSupport?.supported || !!captureSupport.error || (captureSource==='spotify' && !captureSupport.spotify_ready)} onClick={startCapture}>{opening?cancelling?'Cancelling…':'Opening playback audio…':'Start playback recording'}</button><button disabled={!recording} onClick={stopCapture}>Stop recording</button>{(recording || opening) && <button disabled={cancelling} onClick={cancelCapture}>{opening?'Cancel opening':'Discard current recording'}</button>}<button disabled={recording || opening} onClick={checkCapture}>Check recording requirements</button></div>
        {recording && <div className="linked-capture-meter"><strong className="linked-recording">Recording · {seconds}s / 300s</strong><meter aria-label="Playback audio level" min="0" max="1" value={signal?.level || 0}/><span role="status">{signal?.monitored===false?'Level meter unavailable. Listen to the preview after stopping.':signal?.audible?'Audio signal received':signal?.signalDetected?'Quiet now · audio received earlier':seconds>=5?'No audio detected. Check that the selected source is playing and unmuted.':'Waiting for audio · start playback now'}</span></div>}
        <p>{captureSource==='system'?'Windows playback includes other apps and notifications on the captured output. If Windows cannot open this audio device, try another output or Embedded Spotify player.':'Only sound from the embedded player is requested. Playback must remain available in that player.'} Recording continues when you change workspaces and stops at five minutes or 64 MB. Microphone access and transcription models are not required to record.</p>
      </fieldset>
      {audio && <div className="linked-preview"><audio data-mixer-channel="audio" ref={audioPreview} controls={!recording && !opening} src={audio.url} preload="metadata"/>{audio.signalMonitored && !audio.signalDetected && <p className="linked-capture-warning" role="status">No audio signal was detected in this recording. Check the source before saving or transcribing.</p>}<p><a href={audio.saved?apiUrl(`/integrations/spotify/recordings/${audio.saved.id}`):audio.url} download={audio.name}>Download playback recording</a></p><button disabled={busy || recording || opening || !!audio.saved} onClick={saveAudio}>{audio.saved?'Saved locally':'Save recording locally'}</button><button disabled={transcribing || recording || opening} onClick={transcribe}>{transcribing?'Transcribing…':'Transcribe recording'}</button></div>}
      {transcript && <label>Editable transcript<textarea className="linked-transcript" value={transcript} onChange={event=>setTranscript(event.target.value)}/></label>}
    </>}
    {tab==='phone' && status && <><p>{status.phone.description}</p><p>{status.phone.ready?`Windows release found: ${status.phone.release}`:'scrcpy Windows release was not found in Downloads.'}</p><p>{status.phone.source_available?'The separate source checkout is available for inspection.':'Source checkout not found.'}</p><p>The supplied release is v3.3.4. Device connections and mirroring are not started by opening this workspace.</p></>}
    {embed?.service===tab && <div ref={surface} className="linked-surface" aria-label={`${tab} embedded content`}>Embedded {tab} content</div>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}
