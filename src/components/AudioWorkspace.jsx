import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {AUDIO_ACCEPT, AUDIO_LANGUAGES, audioRequest, createAudioCapture, transcribeAudio, validateAudio, formatAudioTranscript, renameAudioSpeakers} from '../audio';
import {localVoices, pauseSpeech, resumeSpeech, saveVoicePreferences, speakText, speechStore, stopSpeech, voicePreferences} from '../audioSpeech';
import {downloadBlob} from '../downloadBlob';
import './AudioWorkspace.css';
import VoiceCloningPanel from './VoiceCloningPanel';

const AUDIO_MODELS = {turbo:{label:'Whisper large-v3 Turbo · recommended', mb:1600}, small:{label:'Whisper small · lighter CPU option', mb:500}, base:{label:'Whisper base · lowest memory', mb:150}};
const elapsedLabel = seconds => `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;

export function VoiceSettings() {
  const [voices, setVoices] = useState(localVoices), [settings, setSettings] = useState(voicePreferences);
  useEffect(() => {
    const refresh = () => {setVoices(localVoices()); setSettings(voicePreferences());};
    globalThis.speechSynthesis?.addEventListener('voiceschanged', refresh);
    window.addEventListener('law-voice-settings', refresh); refresh();
    return () => {globalThis.speechSynthesis?.removeEventListener('voiceschanged', refresh); window.removeEventListener('law-voice-settings', refresh);};
  }, []);
  function update(value) { const next = {...settings, ...value}; setSettings(next); saveVoicePreferences(next); window.dispatchEvent(new Event('law-voice-settings')); }
  return <div className="audio-controls"><label>Local voice <select aria-label="Local voice" value={voices.some(v => v.voiceURI === settings.voice) ? settings.voice : ''} onChange={e => update({voice:e.target.value})}>
    <option value="">Default local voice</option>{voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
  </select></label><label>Speed <select aria-label="Voice speed" value={settings.rate} onChange={e => update({rate:Number(e.target.value)})}>{[0.5,0.75,1,1.25,1.5,2].map(rate => <option key={rate} value={rate}>{rate}×</option>)}</select></label>
    {!voices.length && <small>No local voices detected. Install a Windows speech voice, then restart.</small>}
  </div>;
}

export function ReadAloud({text, owner, active = true}) {
  const speech = useSyncExternalStore(speechStore.subscribe, speechStore.getSnapshot, speechStore.getSnapshot);
  const mine = speech.owner === owner, playing = mine && speech.status !== 'idle';
  useEffect(() => {if (!active) stopSpeech(owner); return () => stopSpeech(owner);}, [active, owner]);
  return <span className="audio-read-aloud"><button type="button" disabled={!active || !text?.trim()} onClick={() => playing ? stopSpeech(owner) : speakText(text, owner)}>{playing ? 'Stop voice' : 'Read aloud'}</button>
    {playing && <button type="button" onClick={speech.status === 'paused' ? resumeSpeech : pauseSpeech}>{speech.status === 'paused' ? 'Resume voice' : 'Pause voice'}</button>}
    {mine && speech.error && <span role="alert">{speech.error}</span>}
  </span>;
}

export function TranscriptionPanel({active, onInsert, compact = false}) {
  const [status, setStatus] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const [file, setFile] = useState(null), [url, setUrl] = useState(''), [text, setText] = useState('');
  const [language, setLanguage] = useState('auto'), [result, setResult] = useState(null);
  const [modelSize, setModelSize] = useState('turbo');
  const [acceleration, setAcceleration] = useState('auto'), [cpuAssistance, setCpuAssistance] = useState('auto');
  const [execution, setExecution] = useState(null), [elapsed, setElapsed] = useState(0);
  const [recording, setRecording] = useState(false), [opening, setOpening] = useState(false), [seconds, setSeconds] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [diarize, setDiarize] = useState(false), [numSpeakers, setNumSpeakers] = useState(0);
  const [speakerProgress, setSpeakerProgress] = useState(null), [speakerNames, setSpeakerNames] = useState({}), [appliedNames, setAppliedNames] = useState({});
  const capture = useRef(null), mounted = useRef(true), operation = useRef(false), preview = useRef(null);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false; capture.current?.cancel();};}, []);
  useEffect(() => {
    if (!active) {capture.current?.stop(); setOpening(false); preview.current?.pause(); return;}
    let disposed = false;
    audioRequest('status').then(value => {if (!disposed) {setStatus(value); setError('');}}).catch(e => {if (!disposed) setError(e.message);});
    return () => {disposed = true; if (capture.current) {capture.current.cancel(); capture.current = null;} setRecording(false); setOpening(false);};
  }, [active]);
  useEffect(() => {if (!file) {setUrl(''); return;} const value = URL.createObjectURL(file); setUrl(value); return () => URL.revokeObjectURL(value);}, [file]);
  useEffect(() => {if (!recording) return; setSeconds(0); const timer = setInterval(() => setSeconds(value => value + 1), 1000); return () => clearInterval(timer);}, [recording]);
  useEffect(() => {
    if (busy !== 'transcribe') return;
    const started = Date.now(); setElapsed(0);
    let disposed = false, pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {const value = await audioRequest('status'); if (!disposed && value.progress) {setExecution(value.progress); setProcessed(value.progress.processed_seconds || 0); setSpeakerProgress(value.progress.stage === 'diarizing' ? value.progress.percent || 0 : null);}}
      catch { /* The transcription request reports its own failures. */ }
      finally {pending = false;}
    };
    const timer = setInterval(poll, 1500), clock = setInterval(() => setElapsed((Date.now() - started) / 1000), 1000);
    return () => {disposed = true; clearInterval(timer); clearInterval(clock);};
  }, [busy]);
  function choose(value) {
    const problem = validateAudio(value); if (problem) {setError(problem); return;}
    setFile(value); setText(''); setResult(null); setError('');
  }
  async function start() {
    if (capture.current || operation.current) return;
    stopSpeech(); preview.current?.pause(); setOpening(true); setError('');
    const session = createAudioCapture({
      onRecording:value => {if (mounted.current && capture.current === session) {setRecording(value); setOpening(false);}},
      onFile:value => {if (capture.current !== session) return; capture.current = null; if (mounted.current) choose(value);},
      onError:value => {if (capture.current !== session) return; capture.current = null; if (mounted.current) {setError(value); setOpening(false); setRecording(false);}},
    });
    capture.current = session; await session.ready;
    if (capture.current === session && !mounted.current) session.cancel();
  }
  async function run(kind) {
    if (operation.current) return;
    operation.current = true; setBusy(kind); setError(''); setProcessed(0); setSpeakerProgress(null); setExecution(null); preview.current?.pause();
    try {
      const setupBody = new FormData(); setupBody.append('model_size', modelSize);
      const value = kind === 'setup' ? await audioRequest('setup', {method:'POST', body:setupBody}) : kind === 'speakers-setup' ? await audioRequest('speakers/setup', {method:'POST'}) : await transcribeAudio(file, language, {diarize, numSpeakers, modelSize, acceleration, cpuAssistance});
      if (!mounted.current) return;
      if (kind.endsWith('setup')) setStatus(value); else {
        setResult({...value, modelSize}); setText(formatAudioTranscript(value));
        const names = Object.fromEntries((value.speakers || []).map(label => [label, label]));
        setSpeakerNames(names); setAppliedNames(names);
        if (value.speaker_error) setError(`Speech transcribed, but speaker separation failed: ${value.speaker_error}`);
      }
    } catch(e) {if (mounted.current) setError(e.message);}
    finally {operation.current = false; if (mounted.current) setBusy('');}
  }
  function applyNames() {
    const names = Object.fromEntries(Object.entries(speakerNames).map(([key, value]) => [key, value.trim() || key]));
    if (new Set(Object.values(names)).size !== Object.keys(names).length) {setError('Choose different speaker names. To correct a single turn, edit its label directly in the transcript.'); return;}
    const replacements = Object.fromEntries(Object.entries(names).map(([key, value]) => [appliedNames[key], value]));
    setText(value => renameAudioSpeakers(value, replacements)); setAppliedNames(names); setSpeakerNames(names); setError('');
  }
  const locked = Boolean(busy || recording || opening);
  const selectedModel = status?.models?.[modelSize] || {model:AUDIO_MODELS[modelSize].label, ready:false, download_mb:AUDIO_MODELS[modelSize].mb};
  const warnings = busy === 'transcribe' ? execution?.warnings : result?.processing?.warnings;
  return <section className={`audio-transcription${compact ? ' compact' : ''}`} aria-label="Speech to text">
    <h2>Speech to text</h2>
    <p>Upload a complete audio file up to 2 hours and 250 MB. Longer files are processed automatically into one transcript. Microphone recordings can run up to 10 minutes.</p>
    <div className="audio-controls"><label>Transcription model <select aria-label="Transcription model" disabled={locked} value={modelSize} onChange={e => setModelSize(e.target.value)}>{Object.entries(AUDIO_MODELS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
      <label>Processing <select aria-label="Audio processing" disabled={locked} value={acceleration} onChange={e => setAcceleration(e.target.value)}><option value="auto">Auto · use available GPU</option><option value="cpu">CPU only</option></select></label>
      <label>CPU assistance <select aria-label="Audio CPU assistance" disabled={locked} value={cpuAssistance} onChange={e => setCpuAssistance(e.target.value)}><option value="auto">Auto</option><option value="light">Light · fewer cores</option><option value="balanced">Balanced · more cores</option></select></label>
    </div>
    <small>Auto uses an available NVIDIA GPU for transcription. CPU assistance speeds up speaker analysis and processes independent sections together.</small>
    <div className="audio-model-status" role="status">{status ? `${selectedModel.model} · ${selectedModel.ready ? 'Ready for local transcription' : status.installed ? 'Model setup needed' : 'Audio runtime not installed'}` : 'Checking transcription setup…'}</div>
    {status && !status.installed && <p>Install the optional audio runtime using <code>venv\Scripts\python.exe -m pip install -r requirements-audio.txt</code>, then restart the app.</p>}
    {status?.installed && <button type="button" disabled={locked} onClick={() => run('setup')}>{selectedModel.model_ready ? 'Repair / refresh model' : `Download transcription model (~${selectedModel.download_mb || 500} MB)`}</button>}
    <div className="audio-controls">
      <button type="button" disabled={!active || Boolean(busy) || opening} onClick={() => recording ? capture.current?.stop() : start()}>{opening ? 'Opening microphone…' : recording ? 'Stop recording' : 'Record microphone'}</button>
      {(recording || opening) && <button type="button" onClick={() => {capture.current?.cancel(); capture.current = null; setRecording(false); setOpening(false);}}>Discard recording</button>}
      <label className="audio-file-picker">Upload audio<input type="file" accept={AUDIO_ACCEPT} disabled={locked} onChange={e => {const value = e.target.files?.[0]; e.target.value = ''; if (value) choose(value);}}/></label>
      <label>Language<select aria-label="Transcription language" disabled={locked} value={language} onChange={e => setLanguage(e.target.value)}>{Object.entries(AUDIO_LANGUAGES).map(([id,label]) => <option value={id} key={id}>{label}</option>)}</select></label>
    </div>
    <fieldset className="audio-speaker-settings" disabled={locked}><legend>Speaker separation</legend>
      <label><input type="checkbox" checked={diarize} onChange={e => setDiarize(e.target.checked)}/> Separate speakers</label>
      {diarize && <><label>Number of speakers <select aria-label="Number of speakers" value={numSpeakers} onChange={e => setNumSpeakers(Number(e.target.value))}><option value={0}>Auto detect</option>{Array.from({length:20}, (_, i) => i + 1).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <small>Voices are compared across the whole recording. If you know the count, select it. Similar voices, brief replies, and people talking at once may still need correction.</small>
        {status?.speakers?.ready ? <small>Local speaker models ready · {status.speakers.model || 'TitaNet Large'}.</small> : <><p>Download the updated speaker models to improve voice separation.</p>{status?.speakers?.installed ? <button type="button" onClick={() => run('speakers-setup')}>Download speaker models (~110 MB)</button> : <small>Update the audio runtime using <code>venv\Scripts\python.exe -m pip install -r requirements-audio.txt</code>, then restart.</small>}</>}
      </>}
    </fieldset>
    {recording && <p className="audio-recording" role="status">● Recording · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2,'0')} · Stops at 10 minutes</p>}
    {file && <div className="audio-source"><span>{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</span>{url && <audio ref={preview} src={url} controls preload="metadata"/>}<div className="audio-controls"><button type="button" onClick={() => downloadBlob(file,file.name)}>Save audio recording</button><button type="button" disabled={locked} onClick={() => {preview.current?.pause(); setFile(null);}}>Remove audio</button></div></div>}
    <button type="button" className="audio-primary" disabled={locked || !file || !selectedModel?.ready || (diarize && !status?.speakers?.ready)} onClick={() => run('transcribe')}>Transcribe audio</button>
    {busy && <p role="status">{busy.endsWith('setup') ? 'Downloading and checking local models. This may take a few minutes…' : `${speakerProgress !== null ? `Separating speakers locally · ${speakerProgress}%` : execution?.stage === 'decoding' ? 'Preparing audio locally' : execution?.stage === 'loading' ? 'Loading transcription model' : `Transcribing locally${processed ? ` · ${Math.floor(processed / 60)}:${String(Math.floor(processed % 60)).padStart(2, '0')} of audio processed` : ''}`}${execution?.device ? ` · ${execution.device === 'cuda' ? 'GPU' : 'CPU'} · ${execution.workers} worker${execution.workers === 1 ? '' : 's'}` : ''} · ${elapsedLabel(elapsed)} elapsed`}</p>}
    {warnings?.map(warning => <p key={warning} role="status">{warning}</p>)}
    {error && <p role="alert" className="audio-error">{error}</p>}
    {result && <p role="status">{result.text ? `Transcript ready · ${AUDIO_LANGUAGES[result.language] || result.language} · ${result.duration}s · Whisper ${result.modelSize}` : 'No speech detected. Try a clearer recording or choose its language.'}</p>}
    {result?.processing && <p>Completed in {elapsedLabel(result.processing.total_seconds)} · {result.processing.device === 'cuda' ? 'GPU' : 'CPU'} transcription{result.processing.timings && <> · Speech {elapsedLabel(result.processing.timings.transcribe_seconds)}{result.processing.timings.speaker_seconds > 0 && <> · Speaker analysis {elapsedLabel(result.processing.timings.speaker_seconds)}</>}</>}</p>}
    {result?.diarized && result.speakers?.length > 0 && <details className="audio-speaker-names"><summary>{result.speakers.length} speaker labels · rename or correct</summary><p>These labels distinguish voices within this recording. Edit any mistaken label or words directly in the transcript. Unknown or overlapping speech is marked separately.</p><div className="audio-controls">{result.speakers.map(label => <label key={label}>{label}<input aria-label={`Name for ${label}`} maxLength={40} value={speakerNames[label] || ''} onChange={e => setSpeakerNames(value => ({...value, [label]:e.target.value}))}/></label>)}</div><button type="button" disabled={locked} onClick={applyNames}>Apply speaker names</button></details>}
    <label className="audio-text-label">Transcript<textarea aria-label="Audio transcript" rows={compact ? 4 : 8} value={text} disabled={Boolean(busy)} onChange={e => setText(e.target.value)} placeholder="Your editable transcript appears here."/></label>
    <div className="audio-controls"><button type="button" disabled={!text.trim()} onClick={async () => {try {await navigator.clipboard.writeText(text);} catch {setError('Could not copy. Select the transcript and press Ctrl+C.');}}}>Copy transcript</button><button type="button" disabled={!text.trim()} onClick={() => downloadBlob(new Blob([text], {type:'text/plain;charset=utf-8'}), 'Transcript.txt')}>Save transcript</button>{onInsert && <button type="button" disabled={!text.trim()} onClick={() => onInsert(text)}>Insert into message</button>}</div>
    <small>Transcription runs on this computer. Temporary server audio is removed after each attempt. Closing or refreshing the app clears unsaved audio and transcripts. Navigating away discards an unfinished recording.</small>
  </section>;
}

export default function AudioWorkspace({active}) {
  const [text, setText] = useState('');
  return <div className="audio-workspace"><header><h1>Audio</h1><p>Capture speech, transcribe audio, and listen to text.</p></header>
    <details className="audio-help"><summary>Help, settings & examples</summary><p>Record microphone → Stop recording → Transcribe audio. For a file, choose Upload audio, then Transcribe. Select a language if automatic detection struggles with a short clip. Whisper can mishear speech; review names, numbers, and quiet sections.</p><p>Enable Separate speakers for conversations. For example, choose 3 speakers for a three-person meeting. The transcript groups each voice into timestamped turns. You can rename labels, correct individual turns, and copy, save, or insert the labeled text into chat. Overlapping speech can remain uncertain; these labels do not identify people by name.</p><p>For voice output, enter text below, choose a local voice and speed, then Read aloud. Example: paste a paragraph you want to proofread by listening. The same voice settings apply to chat Read aloud buttons. Playback is local and starts only when requested.</p><p>Whisper large-v3 Turbo (roughly 1.6 GB) is recommended for accuracy and GPU speed. Whisper small (500 MB) and base (150 MB) use less memory. Auto processing uses an available NVIDIA GPU; if it is busy or unavailable, the same selected model runs on CPU, which can take longer. CPU assistance adjusts parallel workers to available cores and memory; Light uses fewer cores. Updated speaker models use roughly 110 MB. Speaker mode compares voices across the whole recording, then transcribes short speech sections to reduce missed quiet speech and timing drift. After setup, all processing works offline. WAV, MP3, M4A, AAC, OGG, FLAC, WebM, and audio tracks in MP4 are supported. Transcription starts after recording stops.</p></details>
    <div className="audio-columns"><TranscriptionPanel active={active}/><section className="audio-speech" aria-label="Text to speech"><h2>Text to speech</h2><VoiceSettings/><label className="audio-text-label">Text to read<textarea aria-label="Text to read aloud" rows={12} maxLength={20000} value={text} onChange={e => setText(e.target.value)} placeholder="Type or paste text to hear it spoken."/></label><ReadAloud text={text} owner="audio-workspace" active={active}/><small>Up to 20,000 characters. Uses installed local system voices.</small></section></div>
    <VoiceCloningPanel active={active}/>
  </div>;
}

export function ChatAudio({active, sessionId, onInsert, open: controlledOpen, onToggle}) {
  const [localOpen, setLocalOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const open = controlledOpen ?? localOpen;
  useEffect(() => { if (open) setVisited(true); }, [open]);
  const toggle = () => onToggle ? onToggle() : setLocalOpen(value => !value);
  return <div className="chat-audio"><button type="button" className="chat-tool-button" aria-label="Microphone / audio" title="Record microphone or transcribe audio" aria-expanded={open} aria-controls="chat-audio-panel" onClick={toggle}>Audio</button>{(open || visited) && <div id="chat-audio-panel" className="chat-audio-panel chat-tool-panel" hidden={!open} role="region" aria-label="Microphone and audio"><header><strong>Microphone / audio</strong><button type="button" className="chat-tool-button" onClick={toggle}>Close</button></header><TranscriptionPanel key={sessionId || 'new'} active={active && open} onInsert={onInsert} compact/><VoiceSettings/></div>}</div>;
}
