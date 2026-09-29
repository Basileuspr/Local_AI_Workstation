import {useEffect,useRef,useState} from 'react';
import {audioRequest,audioTimestamp} from '../audio';
import {extractAudio,EXTRACTION_FORMATS,MEDIA_AUDIO_ACCEPT,validateExtractionInput} from '../audioExtraction';
import {stopSpeech} from '../audioSpeech';
import {downloadBlob} from '../downloadBlob';

export default function AudioExtractor({active,onUseForTranscription,transcriptionBusy}) {
  const [file,setFile] = useState(null), [format,setFormat] = useState('mp3'), [track,setTrack] = useState(1);
  const [status,setStatus] = useState(null), [error,setError] = useState(''), [notice,setNotice] = useState('');
  const [busy,setBusy] = useState(false), [progress,setProgress] = useState(null), [elapsed,setElapsed] = useState(0);
  const [result,setResult] = useState(null), [url,setUrl] = useState('');
  const mounted = useRef(true), operation = useRef(null), preview = useRef(null);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false; operation.current?.controller.abort();};},[]);
  useEffect(() => {
    if (!active) {preview.current?.pause(); return;}
    let disposed = false;
    audioRequest('extraction/status').then(value => {if (!disposed) setStatus(value);}).catch(e => {if (!disposed) setError(e.message);});
    return () => {disposed = true;};
  },[active]);
  useEffect(() => {
    if (!result) {setUrl(''); return;}
    const next = URL.createObjectURL(result.file); setUrl(next);
    return () => URL.revokeObjectURL(next);
  },[result]);
  useEffect(() => {
    if (!busy) return;
    const started = Date.now(); let disposed = false, pending = false;
    const clock = setInterval(() => setElapsed(Math.floor((Date.now()-started)/1000)),1000);
    const poll = setInterval(async () => {
      if (pending) return;
      pending = true;
      try {
        const value = await audioRequest('extraction/status');
        if (!disposed && value.progress?.request_id === operation.current?.id) setProgress(value.progress);
      } catch { /* The extraction request reports failures. */ }
      finally {pending = false;}
    },1000);
    return () => {disposed = true; clearInterval(clock); clearInterval(poll);};
  },[busy]);
  function choose(value) {
    if (operation.current) return;
    const problem = validateExtractionInput(value);
    if (problem) {setError(problem); return;}
    preview.current?.pause(); setFile(value); setTrack(1); setResult(null); setError(''); setNotice('');
  }
  async function run() {
    if (!active || !file || operation.current) return;
    const session = {id:crypto.randomUUID(),controller:new AbortController()};
    operation.current = session; setBusy(true); setElapsed(0); setError(''); setNotice(''); setProgress(null);
    preview.current?.pause();
    try {
      const extracted = await extractAudio(file,{format,track,requestId:session.id,signal:session.controller.signal,
        onReceiving:() => {if (mounted.current) setProgress({stage:'Receiving extracted audio'});}});
      if (mounted.current) setResult(extracted);
    } catch (e) {
      if (mounted.current) {
        if (e.name === 'AbortError') setNotice('Extraction cancelled.'); else setError(e.message);
      }
    } finally {
      operation.current = null;
      if (mounted.current) {setBusy(false); setProgress(null);}
    }
  }
  const percent = progress?.duration_seconds ? Math.min(99,Math.floor(progress.processed_seconds/progress.duration_seconds*100)) : null;
  return <section className="audio-speech audio-extractor" aria-label="Extract audio from video"
    onDragOver={event => event.preventDefault()} onDrop={event => {event.preventDefault(); if (event.dataTransfer.files?.[0]) choose(event.dataTransfer.files[0]);}}>
    <h2>Extract audio from video</h2>
    <p>Turn a video into an audio file. Choose a file or drop it here, extract the sound, then listen, save, or use it for transcription.</p>
    <div className="audio-controls">
      <label className="audio-file-picker">Video or audio file <input aria-label="Video or audio to extract" type="file" accept={MEDIA_AUDIO_ACCEPT} disabled={busy} onChange={e => {const value = e.target.files?.[0]; e.target.value = ''; if (value) choose(value);}}/></label>
      <label>Save as <select aria-label="Extracted audio format" disabled={busy} value={format} onChange={e => setFormat(e.target.value)}>{Object.entries(EXTRACTION_FORMATS).map(([id,label]) => <option key={id} value={id} disabled={status && !status.formats?.includes(id)}>{label}</option>)}</select></label>
      <label>Audio track <input className="audio-track-number" aria-label="Audio track to extract" type="number" min={1} max={32} step={1} disabled={busy} value={track} onChange={e => setTrack(e.target.value === '' ? '' : Number(e.target.value))}/></label>
    </div>
    <small>MP4, MOV, MKV, WebM, AVI and other common video/audio formats. Up to 2 GB and 2 hours per input. Track 1 is the first audio track; choose another number for an alternate language or commentary.</small>
    {file && <div className="audio-source"><span>{file.name} · {(file.size/1024**2).toFixed(2)} MB</span><button type="button" disabled={busy} onClick={() => {preview.current?.pause(); setFile(null); setResult(null); setError(''); setNotice('');}}>Remove extraction source</button></div>}
    <div className="audio-controls"><button type="button" className="audio-demo-button" disabled={!active || busy || !file || !status?.formats?.includes(format) || !Number.isInteger(track) || track < 1 || track > 32} onClick={run}>Extract audio</button>{busy && <button type="button" onClick={() => operation.current?.controller.abort()}>Cancel extraction</button>}</div>
    {!status && !error && <p role="status">Checking audio extractor…</p>}
    {status && !status.formats?.length && <p>Install the audio runtime with <code>venv\Scripts\python.exe -m pip install -r requirements-audio.txt</code>, then restart the app.</p>}
    {busy && <p role="status">{progress?.stage || 'Sending file to the local extractor'}{percent !== null && ` · ${percent}%`}{progress?.processed_seconds > 0 && ` · ${audioTimestamp(progress.processed_seconds)} processed`} · {audioTimestamp(elapsed)} elapsed</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="audio-error">{error}</p>}
    {result && <div className="audio-source" aria-label="Extracted audio result">
      <strong>{result.file.name}</strong>
      <span>{result.info.duration !== undefined && `${audioTimestamp(result.info.duration)} · `}{(result.file.size/1024**2).toFixed(2)} MB{result.info.sample_rate && ` · ${result.info.sample_rate/1000} kHz · ${result.info.channels === 1 ? 'Mono' : 'Stereo'}`}{result.info.audio_tracks && ` · Track ${result.info.track} of ${result.info.audio_tracks}`}</span>
      {url && <audio aria-label="Extracted audio preview" ref={preview} src={url} controls onPlay={() => stopSpeech()}/>}
      <div className="audio-controls"><button type="button" onClick={() => downloadBlob(result.file,result.file.name)}>Save extracted audio</button><button type="button" disabled={!active || busy || transcriptionBusy} onClick={() => {preview.current?.pause(); onUseForTranscription(result.file); setNotice('Audio loaded in Speech to text. Choose your settings, then Transcribe audio.');}}>Use for transcription</button></div>
      {transcriptionBusy && <small>Finish the current recording or transcription before loading this audio.</small>}
    </div>}
    <details className="audio-help"><summary>Audio extraction help</summary><p>MP3 and M4A make compact files. WAV uses uncompressed 16-bit audio; FLAC compresses that audio without further loss. Audio is converted to the chosen format, with mono or stereo output and sample rates up to 48 kHz. Surround sound is mixed to stereo. Output files are limited to 250 MB; use MP3 or M4A for longer videos.</p><p>All extraction happens on this computer using the audio runtime. The original file stays unchanged. Video, subtitles, cover art, and source metadata are omitted. Files without an audio track cannot be extracted. Leaving Audio stops playback while extraction continues; closing or refreshing cancels an unfinished request and clears unsaved results.</p></details>
  </section>;
}
