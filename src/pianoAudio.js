import { pianoMidiName } from './miniPiano';

export const PIANO_AUDIO_LIMIT = 32 * 1024 * 1024;
export const PIANO_CLIP_LIMIT = 30;

export function validatePianoAudioOptions({ start = 0, duration = 10, tempo = 90, grid = .25, threshold = .3 } = {}) {
  const values = { start: Number(start), duration: Number(duration), tempo: Number(tempo), grid: Number(grid), threshold: Number(threshold) };
  if (!Number.isFinite(values.start) || values.start < 0 || values.start >= 600) throw Error('Choose a clip start between 0 and 600 seconds.');
  if (!Number.isFinite(values.duration) || values.duration < 1 || values.duration > PIANO_CLIP_LIMIT) throw Error('Choose a clip length from 1 to 30 seconds.');
  if (!Number.isFinite(values.tempo) || values.tempo < 40 || values.tempo > 240) throw Error('Choose a tempo between 40 and 240 BPM.');
  if (![.25, .5, 1].includes(values.grid)) throw Error('Choose quarter, half, or whole beat timing.');
  if (!Number.isFinite(values.threshold) || values.threshold < .15 || values.threshold > .75) throw Error('Choose note sensitivity between 0.15 and 0.75.');
  return values;
}

// Snap starts and ends independently, preserving rests, chords and repeated attacks.
// Raw timed notes are retained for MIDI; templates use the piano's discrete beats.
export function pianoNotesToSequence(events, options = {}) {
  const { tempo, grid, duration } = validatePianoAudioOptions(options);
  const secondsPerCell = 60 / tempo * grid, totalCells = Math.ceil(duration / secondsPerCell);
  const cells = Array.from({ length: totalCells }, () => new Set()), attacks = new Set();
  let outside = 0, accepted = 0;
  for (const note of events) {
    if (!Number.isFinite(note.startTimeSeconds) || !Number.isFinite(note.durationSeconds) || note.durationSeconds <= 0 || !Number.isInteger(note.pitchMidi)) continue;
    if (note.pitchMidi < 21 || note.pitchMidi > 108) { outside++; continue; }
    const start = Math.max(0, Math.round(note.startTimeSeconds / secondsPerCell));
    const end = Math.min(totalCells, Math.max(start + 1, Math.round((note.startTimeSeconds + note.durationSeconds) / secondsPerCell)));
    if (start >= totalCells || end <= 0 || note.startTimeSeconds + note.durationSeconds <= 0) continue;
    attacks.add(start); accepted++;
    for (let i = start; i < end; i++) cells[i].add(note.pitchMidi);
  }
  while (cells.length && !cells.at(-1).size) cells.pop();
  if (!accepted || !cells.length) throw Error('No clear piano-range notes were found. Try a louder, cleaner clip, or lower the detection threshold.');
  const segments = [];
  let crowded = false;
  for (let index = 0; index < cells.length; index++) {
    const notes = [...cells[index]].sort((a, b) => a - b);
    if (notes.length > 8) crowded = true;
    const signature = notes.join(','), last = segments.at(-1);
    if (last && signature === last.signature && !attacks.has(index) && last.beats + grid <= 8) last.beats += grid;
    else segments.push({ signature, notes, beats: grid });
  }
  const sequence = segments.map(step => {
    const names = step.notes.map(midi => pianoMidiName(midi));
    const token = names.length > 1 ? `[${names.join(' ')}]` : names[0] || 'R';
    return token + (step.beats === 1 ? '' : `:${step.beats}`);
  }).join(' ');
  const templateError = crowded ? 'More than eight simultaneous notes were detected. Raise the threshold or simplify the clip before making a template.'
    : segments.length > 128 ? 'This clip produces more than 128 steps. Use a shorter clip or a coarser timing grid.' : '';
  return { sequence, steps: segments.length, accepted, outside, templateError };
}

export async function decodePianoAudioFile(file, options, env = globalThis) {
  const settings = validatePianoAudioOptions(options);
  if (!file || !file.size) throw Error('Choose a nonempty audio file.');
  if (file.size > PIANO_AUDIO_LIMIT) throw Error('Choose an audio file under 32 MB.');
  const Context = env.OfflineAudioContext;
  if (!Context) throw Error('Audio decoding is unavailable in this browser. Use the desktop app.');
  // Decoding opens no output device, microphone, or shared audio context.
  const decoder = new Context(1, 1, 22050);
  let audio;
  try { audio = await decoder.decodeAudioData(await file.arrayBuffer()); }
  catch { throw Error('This file could not be decoded. Try WAV, MP3, FLAC, OGG, or M4A supported by this browser.'); }
  if (audio.duration > 600) throw Error('Choose a file no longer than ten minutes, or trim it first.');
  if (audio.numberOfChannels > 8) throw Error('Choose a file with eight audio channels or fewer.');
  if (settings.start >= audio.duration) throw Error('The clip start is past the end of this file.');
  const duration = Math.min(settings.duration, audio.duration - settings.start);
  const offset = Math.floor(settings.start * audio.sampleRate), length = Math.floor(duration * audio.sampleRate);
  const samples = new Float32Array(length);
  for (let channel = 0; channel < audio.numberOfChannels; channel++) {
    const data = audio.getChannelData(channel);
    for (let index = 0; index < length; index++) samples[index] += data[offset + index] / audio.numberOfChannels;
  }
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  if (peak < .0001) throw Error('The selected clip is silent. Choose another part of the file.');
  // Normalize quiet input without changing the original recording.
  if (peak < .25) for (let index = 0; index < length; index++) samples[index] *= .5 / peak;
  return { samples, duration, fileDuration: audio.duration, sampleRate: audio.sampleRate };
}

export function runPianoNoteConversion(samples, threshold, onProgress, env = globalThis) {
  const worker = env === globalThis ? new Worker(new URL('./pianoAudio.worker.js', import.meta.url), { type: 'module' })
    : new env.Worker('piano-note-test-worker', { type: 'module' });
  let settled = false, rejectJob;
  const promise = new Promise((resolve, reject) => {
    rejectJob = reject;
    worker.onmessage = ({ data }) => {
      if (settled) return;
      if (data.type === 'progress') onProgress?.(data.value);
      else { settled = true; worker.terminate(); data.type === 'result' ? resolve(data.notes) : reject(Error(data.message || 'Note conversion failed.')); }
    };
    worker.onerror = () => { if (!settled) { settled = true; worker.terminate(); reject(Error('The local note converter could not start. Restart the app and try again.')); } };
    worker.postMessage({ samples, threshold }, [samples.buffer]);
  });
  return { promise, cancel() { if (settled) return; settled = true; worker.terminate(); rejectJob(new DOMException('Conversion cancelled.', 'AbortError')); } };
}

export async function pianoNotesMidi(events, name = 'Converted audio') {
  const { Midi } = await import('@tonejs/midi');
  const midi = new Midi(); midi.name = name;
  const track = midi.addTrack(); track.name = name; track.instrument.number = 0;
  for (const note of events) {
    if (note.pitchMidi < 21 || note.pitchMidi > 108 || note.durationSeconds <= 0) continue;
    const start = Math.max(0, note.startTimeSeconds), end = Math.max(start + .01, note.startTimeSeconds + note.durationSeconds);
    track.addNote({ midi: note.pitchMidi, time: start, duration: end - start, velocity: Math.max(.05, Math.min(1, note.amplitude || .65)) });
  }
  return new Blob([midi.toArray()], { type: 'audio/midi' });
}
