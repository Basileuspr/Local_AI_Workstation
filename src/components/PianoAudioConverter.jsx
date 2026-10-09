import { useEffect, useRef, useState } from 'react';
import { audioOutput } from '../audioOutput';
import { decodePianoAudioFile, pianoNotesMidi, pianoNotesToSequence, runPianoNoteConversion, validatePianoAudioOptions } from '../pianoAudio';
import { pianoMidiName } from '../miniPiano';
import { normalizePianoSpotifyLink } from '../pianoSpotifyBridge';

export default function PianoAudioConverter({ active = true, onTemplate, onStopPiano }) {
  const [file, setFile] = useState(null), [preview, setPreview] = useState('');
  const [options, setOptions] = useState({ start: 0, duration: 10, tempo: 90, grid: .25, threshold: .3 });
  const [spotify, setSpotify] = useState(''), [result, setResult] = useState(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0);
  const run = useRef(0), job = useRef(null), player = useRef(null);
  const change = patch => setOptions(value => ({ ...value, ...patch }));
  function cancel() { run.current++; job.current?.cancel(); job.current = null; setBusy(false); }
  useEffect(() => () => { run.current++; job.current?.cancel(); }, []);
  useEffect(() => { if (!active) { cancel(); player.current?.pause(); } }, [active]);
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (!preview || !player.current) return;
    const handle = audioOutput.track(player.current);
    return () => handle.release();
  }, [preview]);
  async function convert() {
    cancel(); const token = run.current;
    onStopPiano?.(); player.current?.pause(); setBusy(true); setProgress(0); setError('');
    try {
      const settings = validatePianoAudioOptions(options);
      const decoded = await decodePianoAudioFile(file, settings);
      if (run.current !== token) return;
      job.current = runPianoNoteConversion(decoded.samples, settings.threshold, value => { if (run.current === token) setProgress(Math.round(value * 100)); });
      const notes = await job.current.promise;
      if (run.current !== token) return;
      const clipOptions = { ...settings, duration: Math.max(1, decoded.duration) };
      const timing = pianoNotesToSequence(notes, clipOptions);
      setResult({ ...timing, notes, options: clipOptions, fileName: file.name, duration: decoded.duration });
      setProgress(100);
    } catch (failure) { if (run.current === token && failure.name !== 'AbortError') setError(failure.message); }
    finally { if (run.current === token) { job.current = null; setBusy(false); } }
  }
  const quantize = () => {
    try {
      const settings = validatePianoAudioOptions({ ...options, start: result.options.start, duration: result.options.duration, threshold: result.options.threshold });
      setResult({ ...result, ...pianoNotesToSequence(result.notes, settings), options: settings }); setError('');
    } catch (failure) { setError(failure.message); }
  };
  function useTemplate() {
    try {
      const spotifyLink = normalizePianoSpotifyLink(spotify);
      onTemplate({ title: result.fileName.replace(/\.[^.]+$/, '').slice(0, 80), tempo: result.options.tempo, sequence: result.sequence, spotifyLink,
        description: `Estimated notes from ${result.fileName.slice(0, 140)}, ${result.options.start.toFixed(2)}–${(result.options.start + result.duration).toFixed(2)} seconds. Review pitches and rhythm before saving. Timing snapped to ${result.options.grid} beat at ${result.options.tempo} BPM.` });
      player.current?.pause(); setError('');
    } catch (failure) { setError(failure.message); }
  }
  async function downloadMidi() {
    try {
      const blob = await pianoNotesMidi(result.notes, result.fileName), url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = result.fileName.replace(/\.[^.]+$/, '').slice(0, 80) + '.mid'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setError(failure.message || 'MIDI export failed.'); }
  }
  return <details className="piano-audio-converter"><summary>Audio → notes · convert a file</summary>
    <p>Convert a local recording into estimated notes and chords. Best with one clear instrument; full mixes, drums, and effects can confuse detection. Audio stays on this computer.</p>
    <label>Audio file <input aria-label="Piano audio file" type="file" accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a,.webm" disabled={!active || busy}
      onChange={event => { cancel(); player.current?.pause(); setFile(event.target.files[0] || null); setResult(null); setError(''); }} /></label>
    {preview && <audio ref={player} aria-label="Original audio preview" data-mixer-channel="audio" controls src={preview} preload="metadata" onPlay={() => onStopPiano?.()} />}
    <div className="piano-audio-fields">
      <label>Clip start (seconds)<input aria-label="Audio clip start" type="number" min="0" max="599" step=".1" value={options.start} disabled={!active || busy} onChange={event => change({ start: event.target.value })} /></label>
      <label>Clip length (seconds)<input aria-label="Audio clip length" type="number" min="1" max="30" value={options.duration} disabled={!active || busy} onChange={event => change({ duration: event.target.value })} /></label>
      <label>Tempo (BPM)<input aria-label="Audio note tempo" type="number" min="40" max="240" value={options.tempo} disabled={!active || busy} onChange={event => change({ tempo: event.target.value })} /></label>
      <label>Timing grid<select aria-label="Audio note timing" value={options.grid} disabled={!active || busy} onChange={event => change({ grid: Number(event.target.value) })}><option value={.25}>¼ beat</option><option value={.5}>½ beat</option><option value={1}>1 beat</option></select></label>
      <label>Detection threshold<select aria-label="Audio note threshold" value={options.threshold} disabled={!active || busy} onChange={event => change({ threshold: Number(event.target.value) })}><option value={.2}>Sensitive · more notes</option><option value={.3}>Balanced</option><option value={.5}>Strict · fewer notes</option></select></label>
    </div>
    <p>Up to 32 MB and ten minutes per file; analyze a 1–30 second excerpt at a time. Set the tempo for practice timing. MIDI keeps the detected note timing.</p>
    <div className="piano-lesson-actions"><button type="button" disabled={!active || busy || !file} onClick={convert}>{busy ? 'Converting…' : 'Convert audio to notes'}</button>
      {busy && <button type="button" onClick={cancel}>Cancel conversion</button>}</div>
    {busy && <p role="status">Local note conversion · {progress}% <progress max="100" value={progress} /></p>}
    {result && <div className="piano-audio-result" aria-label="Converted audio notes">
      <p>{result.fileName} · {result.options.start.toFixed(1)}–{(result.options.start + result.duration).toFixed(1)} seconds</p>
      <p role="status">{result.accepted} detected notes · {result.steps} practice steps · {result.duration.toFixed(1)} second clip{result.outside ? ` · ${result.outside} notes outside piano range skipped` : ''}</p>
      <p>Timing: {result.options.tempo} BPM · {result.options.grid} beat grid. Change Tempo or Timing grid above, then Update timing.</p>
      <div className="piano-lesson-actions"><button type="button" disabled={!active || busy} onClick={quantize}>Update timing</button><button type="button" disabled={!active || busy} onClick={downloadMidi}>Download MIDI</button></div>
      <pre className="piano-audio-sequence">{result.sequence}</pre>
      <details><summary>Detected pitches and times</summary><div className="piano-detected-notes"><table><thead><tr><th>Note</th><th>Start</th><th>Length</th><th>Strength</th></tr></thead><tbody>{result.notes.slice(0, 200).map((note, index) => <tr key={index}><td>{pianoMidiName(note.pitchMidi)}</td><td>{Math.max(0, note.startTimeSeconds).toFixed(2)}s</td><td>{note.durationSeconds.toFixed(2)}s</td><td>{Math.round(note.amplitude * 100)}%</td></tr>)}</tbody></table>{result.notes.length > 200 && <p>Showing the first 200 notes. MIDI includes all detected piano-range notes.</p>}</div></details>
      <label>Spotify track reference (optional)<input aria-label="Converted audio Spotify reference" value={spotify} disabled={!active || busy} placeholder="https://open.spotify.com/track/…" onChange={event => setSpotify(event.target.value)} /></label>
      {result.templateError && <p role="alert">{result.templateError}</p>}
      <button type="button" disabled={!active || busy || !!result.templateError} onClick={useTemplate}>Review as piano template</button>
    </div>}
    {error && <p role="alert">{error}</p>}
    <p className="piano-template-hint">Local conversion uses Basic Pitch, an open-source model from Spotify. Spotify track links are listening references; streamed Spotify audio is not imported or analyzed.</p>
  </details>;
}
