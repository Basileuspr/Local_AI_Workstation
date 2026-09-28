import {useEffect, useRef, useState} from 'react';
import {AUDIO_ACCEPT, audioRequest, createAudioCapture, transcribeAudio} from '../audio';
import {stopSpeech} from '../audioSpeech';
import {downloadBlob} from '../downloadBlob';
import {generateClonedVoice, validateVoiceReference, VOICE_DEMO_TEXT, VOICE_ENGINES, VOICE_LANGUAGES} from '../voiceCloning';

const RECORDING_SECONDS = 20;

function useAudioUrl(blob) {
  const [resource, setResource] = useState(null);
  useEffect(() => {
    if (!blob) {setResource(null); return;}
    const next = URL.createObjectURL(blob); setResource({blob,url:next});
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return resource && resource.blob === blob ? resource.url : '';
}

export default function VoiceCloningPanel({active}) {
  const [status, setStatus] = useState(null), [error, setError] = useState('');
  const [engine, setEngine] = useState('chatterbox-turbo'), [language, setLanguage] = useState('English');
  const [reference, setReference] = useState(null), [referenceText, setReferenceText] = useState('');
  const [text, setText] = useState(''), [acceleration, setAcceleration] = useState('auto');
  const [busy, setBusy] = useState(''), [elapsed, setElapsed] = useState(0), [result, setResult] = useState(null);
  const [progress, setProgress] = useState(null);
  const [capturing, setCapturing] = useState(''), [seconds, setSeconds] = useState(0);
  const [playbackNotice, setPlaybackNotice] = useState('');
  const mounted = useRef(true), operation = useRef(false), inputPlayer = useRef(null), outputPlayer = useRef(null);
  const capture = useRef(null), recordingStarted = useRef(0), context = useRef(0), autoPlay = useRef(null);
  const referenceUrl = useAudioUrl(reference), outputUrl = useAudioUrl(result?.blob);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false; capture.current?.cancel();};}, []);
  useEffect(() => {
    if (!active) {inputPlayer.current?.pause(); outputPlayer.current?.pause(); return;}
    let disposed = false;
    audioRequest('voices/status').then(value => {if (!disposed) setStatus(value);}).catch(e => {if (!disposed) setError(e.message);});
    return () => {
      disposed = true; context.current++; autoPlay.current = null;
      discardRecording(); inputPlayer.current?.pause(); outputPlayer.current?.pause();
    };
  }, [active]);
  useEffect(() => {
    if (capturing !== 'recording') return;
    const timer = setInterval(() => setSeconds(Math.min(RECORDING_SECONDS, Math.floor((Date.now()-recordingStarted.current)/1000))),250);
    return () => clearInterval(timer);
  }, [capturing]);
  useEffect(() => {
    if (!active || !outputUrl || autoPlay.current !== result || !result) return;
    autoPlay.current = null;
    const version = context.current;
    stopSpeech(); inputPlayer.current?.pause();
    outputPlayer.current?.play().catch(() => {
      if (mounted.current && context.current === version) setPlaybackNotice('Your demo is ready. Press Play below to listen.');
    });
  }, [active,outputUrl,result]);
  useEffect(() => {
    if (!busy) return;
    const start = Date.now(); setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now()-start)/1000)),1000);
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    if (busy !== 'generate') return;
    let disposed = false, pending = false;
    const timer = setInterval(async () => {
      if (pending) return;
      pending = true;
      try {const value = await audioRequest('voices/status'); if (!disposed) setProgress(value.progress);}
      catch { /* The synthesis request reports its own error. */ }
      finally {pending = false;}
    },2000);
    return () => {disposed = true; clearInterval(timer);};
  }, [busy]);
  function choose(file) {
    const problem = validateVoiceReference(file);
    if (problem) {setError(problem); return;}
    autoPlay.current = null; setPlaybackNotice('');
    inputPlayer.current?.pause(); outputPlayer.current?.pause();
    setReference(file); setReferenceText(''); setResult(null); setError('');
  }
  function discardRecording() {
    const session = capture.current; capture.current = null; session?.cancel();
    if (mounted.current) {setCapturing(''); setSeconds(0);}
  }
  function startRecording() {
    if (!active || capture.current || operation.current) return;
    autoPlay.current = null; setPlaybackNotice('');
    stopSpeech(); inputPlayer.current?.pause(); outputPlayer.current?.pause();
    setCapturing('opening'); setSeconds(0); setError('');
    const session = createAudioCapture({maxSeconds:RECORDING_SECONDS,
      onRecording:value => {
        if (!mounted.current || capture.current !== session) return;
        if (value) recordingStarted.current = Date.now();
        setCapturing(value ? 'recording' : 'stopping');
      },
      onFile:file => {
        if (!mounted.current || capture.current !== session) return;
        capture.current = null; setCapturing('');
        if (Date.now()-recordingStarted.current < 6000) {setError('That recording was too short. Speak for at least 6 seconds; aim for 10–20 seconds.'); return;}
        choose(new File([file],`Voice reference.${file.name.split('.').pop()}`,{type:file.type}));
      },
      onError:message => {
        if (!mounted.current || capture.current !== session) return;
        capture.current = null; setCapturing(''); setError(message);
      },
    });
    capture.current = session;
  }
  async function run(kind) {
    if (!active || operation.current || capture.current || !reference) return;
    const version = context.current;
    operation.current = true; autoPlay.current = null; setPlaybackNotice(''); setError(''); setProgress(null);
    stopSpeech(); inputPlayer.current?.pause(); outputPlayer.current?.pause();
    try {
      let words = referenceText;
      if (kind === 'transcribe' || (needsTranscript && !words.trim())) {
        setBusy('transcribe');
        const transcript = await transcribeAudio(reference, 'auto', {acceleration});
        words = transcript.text?.trim() || '';
        if (mounted.current) setReferenceText(words);
        if (!words) throw new Error('No speech was found in the reference. Try a clearer recording or enter its words.');
        // Leaving the workspace ends the demo chain before starting another job.
        if (kind === 'transcribe' || !mounted.current || context.current !== version) return;
      }
      setBusy('generate');
      const generatedText = text.trim() || VOICE_DEMO_TEXT[language];
      const generated = await generateClonedVoice({engine,text:generatedText,reference,referenceText:words,language,acceleration});
      if (mounted.current) {
        const next = {...generated,text:generatedText};
        if (kind === 'demo' && context.current === version) autoPlay.current = next;
        setResult(next);
      }
    } catch(e) {if (mounted.current) setError(e.message);}
    finally {operation.current = false; if (mounted.current) setBusy('');}
  }
  const selected = status?.engines?.[engine], needsTranscript = engine !== 'chatterbox-turbo';
  const locked = Boolean(busy || capturing);
  return <section className="audio-speech audio-cloning" aria-label="Voice cloning">
    <h2>Voice cloning</h2>
    <p>Generate new speech from a 6–30 second recording of one clear voice. Use your own voice or one you have permission to use.</p>
    <div className="audio-controls">
      <label>Voice model <select aria-label="Voice cloning model" disabled={locked} value={engine} onChange={e => {setEngine(e.target.value); if(e.target.value === 'chatterbox-turbo') setLanguage('English');}}>{Object.entries(VOICE_ENGINES).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Language <select aria-label="Cloned voice language" disabled={locked || engine === 'chatterbox-turbo'} value={language} onChange={e => setLanguage(e.target.value)}>{VOICE_LANGUAGES.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Processing <select aria-label="Voice cloning processing" disabled={locked} value={acceleration} onChange={e => setAcceleration(e.target.value)}><option value="auto">Auto · use available GPU</option><option value="cpu">CPU only</option></select></label>
    </div>
    <p className="audio-model-status" role="status">{status ? selected?.ready ? `${VOICE_ENGINES[engine]} · Installed locally` : `${VOICE_ENGINES[engine]} · Installation incomplete` : 'Checking voice models…'}</p>
    {status?.reference_ready === false ? <p>Install the audio decoder with <code>venv\Scripts\python.exe -m pip install -r requirements-audio.txt</code>, then restart the app.</p> : status && !selected?.ready && <p>Run <code>powershell -ExecutionPolicy Bypass -File scripts/install-voice-models.ps1</code> from the project folder, then reopen Audio.</p>}
    <div className="audio-voice-recorder" aria-label="Record a voice reference">
      <strong>Record your voice</strong>
      <p>Speak naturally for 10–20 seconds in a quiet room. At least 6 seconds are needed. Recording stops automatically at {RECORDING_SECONDS} seconds.</p>
      <div className="audio-controls">
        {!capturing && <button type="button" disabled={!active || Boolean(busy)} onClick={startRecording}>{reference ? 'Record a new reference' : 'Record voice reference'}</button>}
        {capturing === 'recording' && <button type="button" onClick={() => {setCapturing('stopping'); capture.current?.stop();}}>Stop and use recording</button>}
        {capturing && <button type="button" onClick={discardRecording}>{capturing === 'opening' ? 'Cancel microphone' : 'Discard recording'}</button>}
        {capturing && <span role="status" className="audio-recording">{capturing === 'opening' ? 'Waiting for microphone access…' : capturing === 'stopping' ? 'Preparing recording…' : `● Recording · ${seconds}s / ${RECORDING_SECONDS}s${seconds < 6 ? ' · Keep speaking' : ' · Ready to use'}`}</span>}
      </div>
      <label className="audio-file-picker">Or upload a reference <input aria-label="Reference voice recording" type="file" accept={AUDIO_ACCEPT} disabled={locked} onChange={e => {const file = e.target.files?.[0]; e.target.value = ''; if(file) choose(file);}}/></label>
    </div>
    {reference && <div className="audio-source"><span>{reference.name}</span><audio aria-label="Reference voice preview" ref={inputPlayer} controls src={referenceUrl || undefined} onPlay={() => {if (capture.current) {inputPlayer.current?.pause(); return;} stopSpeech(); outputPlayer.current?.pause();}}/><div className="audio-controls"><button type="button" onClick={() => downloadBlob(reference,reference.name)}>Save reference recording</button><button type="button" disabled={locked} onClick={() => {autoPlay.current = null; setReference(null); setReferenceText(''); setResult(null); setPlaybackNotice('');}}>Remove reference</button></div></div>}
    <label className="audio-text-label">Words in the reference {needsTranscript ? '(auto-transcribed if blank)' : '(optional)'}<textarea aria-label="Reference voice transcript" rows={3} maxLength={4000} value={referenceText} disabled={locked} onChange={e => setReferenceText(e.target.value)} placeholder="Enter the words spoken in your reference, or let the app transcribe it."/></label>
    <button type="button" disabled={!active || locked || !reference} onClick={() => run('transcribe')}>Transcribe reference</button>
    <small>OmniVoice and Qwen automatically transcribe a blank reference transcript before generating. You can review and correct the words for better results. Chatterbox Turbo uses the recording alone.</small>
    <label className="audio-text-label">Text to generate<textarea aria-label="Text for cloned voice" rows={3} maxLength={1500} value={text} disabled={locked} onChange={e => setText(e.target.value)} placeholder="Type what the generated voice should say, or leave blank to try the demo."/></label>
    {!text.trim() && <p className="audio-demo-text">Demo text: “{VOICE_DEMO_TEXT[language]}”</p>}
    <div className="audio-controls"><button type="button" className="audio-demo-button" disabled={!active || locked || !selected?.ready || !reference} onClick={() => run('demo')}>Demo this voice</button><button type="button" disabled={!active || locked || !selected?.ready || !reference || !text.trim()} onClick={() => run('generate')}>Generate cloned voice</button></div>
    <small>Demo this voice generates your text (or the sample above) and plays it automatically when ready. Local generation can take a little while.</small>
    {busy && <p role="status">{busy === 'transcribe' ? 'Transcribing reference' : progress?.stage || 'Generating speech locally'}{progress?.device && ` · ${progress.device === 'cuda' ? 'GPU' : 'CPU'}`} · {Math.floor(elapsed/60)}m {elapsed%60}s elapsed</p>}
    {busy && progress?.warnings?.map(value => <p key={value}>{value}</p>)}
    {error && <p role="alert" className="audio-error">{error}</p>}
    {playbackNotice && <p role="status">{playbackNotice}</p>}
    {result && <div className="audio-source"><p>Generated with {VOICE_ENGINES[result.engine]}{result.processing.device && ` · ${result.processing.device === 'cuda' ? 'GPU' : 'CPU'} · ${result.processing.seconds}s`}</p><p>{result.text}</p>{result.processing.warnings?.map(value => <p key={value}>{value}</p>)}<audio aria-label="Generated cloned voice" ref={outputPlayer} controls src={outputUrl || undefined} onPlay={() => {if (capture.current) {outputPlayer.current?.pause(); return;} stopSpeech(); inputPlayer.current?.pause();}}/><button type="button" onClick={() => downloadBlob(result.blob, `${result.engine}-generated-voice.wav`)}>Save generated WAV</button></div>}
    <details className="audio-help"><summary>Voice cloning help</summary><p>Choose a model, record your voice here or upload a short reference with one speaker, then click Demo this voice. Type your own text to hear that instead of the sample. Avoid music and overlapping voices. Review the reference transcript if the voice sounds inaccurate. Chatterbox Turbo is English-only; the other engines offer the languages listed above.</p><p>Recordings stay in this panel until you remove them or refresh/close the app. Save reference recording downloads the original microphone audio for reuse. Leaving this workspace discards an unfinished recording and stops playback. A submitted generation can still finish, but will not play automatically after you leave. Demo playback starts after generation; this is not streaming voice conversion.</p><p>All synthesis is local. Each model uses an isolated runtime and shares GPU access with the rest of the app. CPU generation can take several minutes. Save the WAV before closing or refreshing the app. Chatterbox retains its built-in audio watermark.</p></details>
  </section>;
}
