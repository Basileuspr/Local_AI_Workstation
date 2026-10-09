import { cleanPianoEffects, createPianoEffectsRack } from './pianoEffects';
export const pianoMapping = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k', 'o', 'l', 'p', ';', "'", ']'];
const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const flatNames = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
export function pianoKeysForRange(baseMidi = 60, keyCount = 24) {
  const keys = Array.from({ length: keyCount }, (_, index) => ({ index, midi: baseMidi + index,
    black: [1, 3, 6, 8, 10].includes((baseMidi + index) % 12), shortcut: pianoMapping[index] || '' }));
  const whiteCount = keys.filter(key => !key.black).length;
  let whites = 0;
  return keys.map(key => {
    const width = key.black ? 64.4 / whiteCount : 100 / whiteCount;
    const left = whites / whiteCount * 100 - (key.black ? width / 2 : 0);
    if (!key.black) whites++;
    return { ...key, left, width };
  });
}
export const pianoKeys = pianoKeysForRange();
export const pianoMidiName = (midi, spelling = 'sharp') => pianoNote(midi % 12, Math.floor(midi / 12) - 1, spelling);
export const pianoNote = (index, octave, spelling = 'sharp') => (spelling === 'flat' ? flatNames : names)[index % 12] + (octave + Math.floor(index / 12));
export const pianoFrequency = (index, octave) => 440 * 2 ** (((octave + 1) * 12 + index - 69) / 12);

// The supplied output owns the audio context; the piano owns only its voices.
export function createMiniPiano(openAudio, onChange = () => {}) {
  const notes = new Map(), sources = new Map();
  let keyCount = 24, rack = null, effects = { ...cleanPianoEffects };
  let octave = 4, volume = .65, status = 'Tap a key to start audio', error = '';
  const baseMidi = () => keyCount === 88 ? 21 : (octave + 1) * 12;
  const snapshot = () => ({ octave, keyCount, baseMidi: baseMidi(), effects: { ...effects }, volume, status, error,
    playing: [...notes].filter(([, note]) => note.voice).map(([index]) => index),
    manualPlaying: [...notes].filter(([, note]) => note.voice && [...note.sources].some(source => !String(source).startsWith('lesson:'))).map(([index]) => index),
  });
  const publish = () => onChange(snapshot());
  function release(source) {
    const index = sources.get(source);
    if (index === undefined) return;
    sources.delete(source);
    const note = notes.get(index);
    note.sources.delete(source);
    if (note.sources.size) { publish(); return; }
    notes.delete(index);
    if (note.voice) {
      const { context, osc, gain } = note.voice;
      gain.gain.cancelScheduledValues(context.currentTime);
      gain.gain.setTargetAtTime(0, context.currentTime, .025 + effects.sustain / 100 * .55);
      osc.stop(context.currentTime + .15 + effects.sustain / 100 * 3);
    }
    publish();
  }
  async function press(index, source) {
    if (!Number.isInteger(index) || index < 0 || index >= keyCount || sources.has(source)) return;
    sources.set(source, index);
    if (notes.has(index)) { notes.get(index).sources.add(source); publish(); return; }
    const note = { sources: new Set([source]), voice: null };
    notes.set(index, note);
    try {
      const { context, input } = await openAudio();
      // A release, octave change or hidden tab can happen while audio resumes.
      if (notes.get(index) !== note) return;
      const osc = context.createOscillator(), gain = context.createGain();
      note.voice = { context, osc, gain };
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
      osc.type = effects.waveform;
      osc.frequency.value = 440 * 2 ** ((baseMidi() + index - 69) / 12);
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.linearRampToValueAtTime(volume * .15, context.currentTime + .01);
      if (!rack && context.createBiquadFilter) rack = createPianoEffectsRack(context, input, effects);
      osc.connect(gain); gain.connect(rack?.input || input); osc.start();
      status = 'Audio on'; error = ''; publish();
    } catch {
      if (notes.get(index) !== note) return;
      // Clean up a partially connected voice if audio creation failed.
      if (note.voice) {
        try { note.voice.osc.stop(); } catch { /* It may not have started. */ }
        note.voice.osc.disconnect(); note.voice.gain.disconnect();
      }
      note.sources.forEach(held => sources.delete(held)); notes.delete(index);
      error = 'Audio unavailable. Try a key again or check Sound output.'; publish();
    }
  }
  function stopAll() {
    [...sources.keys()].forEach(release);
    rack?.dispose(); rack = null;
  }
  function setOctave(value) { stopAll(); octave = Math.max(1, Math.min(8 - Math.ceil((keyCount === 88 ? 24 : keyCount) / 12), Math.round(value))); publish(); }
  function setKeyCount(value) {
    if (![24, 36, 48, 88].includes(value)) return;
    stopAll(); keyCount = value; setOctave(octave);
  }
  function ensureNotes(stepNotes) {
    if (!stepNotes.length || keyCount === 88) return;
    const fits = value => stepNotes.every(note => note.midi >= (value + 1) * 12 && note.midi < (value + 1) * 12 + keyCount);
    if (fits(octave)) return;
    const choices = Array.from({ length: 8 - keyCount / 12 }, (_, index) => index + 1).filter(fits);
    if (!choices.length) setKeyCount(88);
    else setOctave(choices.sort((a, b) => Math.abs(a - octave) - Math.abs(b - octave))[0]);
  }
  function setEffects(value) {
    for (const key of ['tone', 'reverb', 'echo', 'tremolo', 'sustain']) if (Number.isFinite(value[key])) effects[key] = Math.max(0, Math.min(100, value[key]));
    if (['triangle', 'sine', 'square', 'sawtooth'].includes(value.waveform)) effects.waveform = value.waveform;
    rack?.update(effects);
    for (const note of notes.values()) if (note.voice) note.voice.osc.type = effects.waveform;
    publish();
  }
  function setVolume(value) {
    volume = Math.max(0, Math.min(1, value));
    for (const note of notes.values()) if (note.voice) {
      const { context, gain } = note.voice;
      gain.gain.cancelScheduledValues(context.currentTime);
      gain.gain.setTargetAtTime(volume * .15, context.currentTime, .01);
    }
    publish();
  }
  return { press, release, stopAll, setOctave, setKeyCount, ensureNotes, setEffects, setVolume, getSnapshot: snapshot };
}
