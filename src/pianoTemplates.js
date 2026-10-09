import { pianoNote } from './miniPiano';
import { normalizePianoSpotifyLink } from './pianoSpotifyBridge';

export const PIANO_TEMPLATE_KEY = 'local-ai-workstation-piano-templates-v1';
export const MAX_PIANO_TEMPLATES = 40;
const naturals = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const accidentalOffsets = { '': 0, '#': 1, b: -1, '##': 2, bb: -2 };
const accidentalSymbols = { '': '', '#': '♯', b: '♭', '##': '𝄪', bb: '𝄫' };

export function parsePianoNote(text) {
  const normalized = text.trim().replaceAll('♯', '#').replaceAll('♭', 'b').replaceAll('𝄪', '##').replaceAll('𝄫', 'bb').replaceAll('x', '##').replaceAll('♮', '');
  const match = /^([a-gA-G])(##|bb|#|b)?(-?\d)$/.exec(normalized);
  if (!match) throw Error(`“${text}” is not a note. Use C4, Db4, F#4, F##4 or Gbb4.`);
  const letter = match[1].toUpperCase(), accidental = match[2] || '', octave = Number(match[3]);
  const midi = (octave + 1) * 12 + naturals[letter] + accidentalOffsets[accidental];
  if (midi < 21 || midi > 108) throw Error(`“${text}” is outside the piano’s A0–C8 range.`);
  return { midi, name: `${letter}${accidentalSymbols[accidental]}${octave}` };
}

export function enharmonicNames(midi, doubles = true) {
  const names = [];
  for (const [letter, pitch] of Object.entries(naturals)) for (const [accidental, offset] of Object.entries(accidentalOffsets)) {
    if (!doubles && Math.abs(offset) === 2) continue;
    const natural = midi - offset;
    if (((natural % 12) + 12) % 12 === pitch) names.push(`${letter}${accidentalSymbols[accidental]}${Math.floor(natural / 12) - 1}`);
  }
  const canonical = pianoNote(midi % 12, Math.floor(midi / 12) - 1);
  return [canonical, ...names.filter(name => name !== canonical)];
}

export function octaveForStep(notes, preferred = 4) {
  if (!notes.length) return preferred;
  const fits = octave => notes.every(note => note.midi >= (octave + 1) * 12 && note.midi < (octave + 3) * 12);
  if (fits(preferred)) return preferred;
  return [2, 3, 4, 5, 6].filter(fits).sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred))[0] ?? null;
}

// Whitespace separates steps; brackets play a chord; :N gives its beat count.
export function parsePianoSequence(sequence) {
  if (typeof sequence !== 'string' || sequence.length > 8000) throw Error('Keep a template under 8,000 characters.');
  const steps = [];
  let rest = sequence.trim();
  while (rest) {
    const match = /^(\[[^\[\]]+\]|[^\s:\[\]]+)(?::(\d+(?:\.\d+)?|\.\d+))?(?=\s|$)/.exec(rest);
    if (!match) throw Error(`Check the sequence near “${rest.slice(0, 40)}”. Separate steps with spaces and close chord brackets.`);
    const token = match[1], beats = match[2] === undefined ? 1 : Number(match[2]);
    if (beats < .25 || beats > 8) throw Error('Each step must last between 0.25 and 8 beats.');
    const notes = /^(R|rest)$/i.test(token) ? [] : (token.startsWith('[') ? token.slice(1, -1).trim().split(/\s+/) : [token]).map(parsePianoNote);
    if (notes.length > 8) throw Error('Use at most eight notes in a chord.');
    if (new Set(notes.map(note => note.midi)).size !== notes.length) throw Error('A chord contains the same piano key twice under different names. Put equivalent names in separate steps.');
    steps.push({ notes, beats });
    if (steps.length > 128) throw Error('Use at most 128 steps per template.');
    rest = rest.slice(match[0].length).trimStart();
  }
  if (!steps.length || steps.every(step => !step.notes.length)) throw Error('Add at least one note or chord to your template.');
  return steps;
}

const lesson = (id, title, description, sequence, tempo = 90) => ({ id, title, description, sequence, tempo, steps: parsePianoSequence(sequence), builtin: true });
export const pianoLessons = [
  lesson('c-major', 'C major scale', 'Play up and back down. Right hand: thumb, index, middle; pass your thumb under for F, then index, middle, ring, little finger. Reverse on the way down.', 'C4 D4 E4 F4 G4 A4 B4 C5:2 B4 A4 G4 F4 E4 D4 C4:2', 80),
  lesson('a-minor', 'A natural minor scale', 'Listen to a minor scale using only white keys. Start on A and notice how its mood differs from C major.', 'A4 B4 C5 D5 E5 F5 G5 A5:2 G5 F5 E5 D5 C5 B4 A4:2', 80),
  lesson('arpeggio', 'C major arpeggio', 'Play the notes of a C-major chord one at a time: C, E and G. Keep a relaxed, even pulse.', 'C4 E4 G4 C5:2 G4 E4 C4:2', 90),
  lesson('chords', 'Three major chords', 'Play all highlighted keys together. These are C major, F major, G major, then C major again.', '[C4 E4 G4]:2 [F4 A4 C5]:2 [G4 B4 D5]:2 [C4 E4 G4]:4', 72),
  lesson('twinkle', 'Twinkle, Twinkle — opening', 'Try this familiar opening. Repeated notes need separate presses; a :2 note lasts two beats.', 'C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2', 100),
  lesson('ode', 'Ode to Joy — opening', 'Begin on E. Listen for the repeated notes and the longer note at the end of the phrase.', 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4:1.5 D4:.5 D4:2', 100),
  lesson('black-keys', 'Black-key pentatonic', 'A five-note scale on the black keys. Practice their flat names: D♭, E♭, G♭, A♭ and B♭.', 'Db4 Eb4 Gb4 Ab4 Bb4 Db5:2 Bb4 Ab4 Gb4 Eb4 Db4:2', 85),
  lesson('enharmonics', 'Same key, different name', 'Play each pair and hear the same pitch. Includes white-key and double-accidental equivalents. B♯3 equals C4, while C♭5 equals B4.', 'C#4 Db4 D#4 Eb4 F#4 Gb4 G#4 Ab4 A#4 Bb4 E#4 F4 Fb4 E4 B#3 C4 Cb5 B4 F##4 G4 Gbb4 F4', 80),
  lesson('rhythm', 'Notes, chords and rests', 'Count one beat per plain note. R means rest. Short steps last half a beat; chords inside brackets sound together.', 'C4 R D4:.5 E4:.5 F4 G4:2 R [C4 E4 G4]:2 R:2 C5:4', 90),
  lesson('g-major', 'G major scale', 'One sharp: F♯. Keep the same pulse ascending and descending.', 'G3 A3 B3 C4 D4 E4 F#4 G4:2 F#4 E4 D4 C4 B3 A3 G3:2', 80),
  lesson('f-major', 'F major scale', 'One flat: B♭. Compare the flat key with the natural B in C major.', 'F3 G3 A3 Bb3 C4 D4 E4 F4:2 E4 D4 C4 Bb3 A3 G3 F3:2', 80),
  lesson('d-major', 'D major scale', 'Two sharps: F♯ and C♯. Aim for smooth changes between white and black keys.', 'D4 E4 F#4 G4 A4 B4 C#5 D5:2 C#5 B4 A4 G4 F#4 E4 D4:2', 80),
  lesson('harmonic-minor', 'A harmonic minor', 'Raise G to G♯. Listen for the larger gap from F to G♯ near the top.', 'A3 B3 C4 D4 E4 F4 G#4 A4:2 G#4 F4 E4 D4 C4 B3 A3:2', 75),
  lesson('chromatic', 'Chromatic staircase', 'Use every semitone, then come back down. Start slowly and give each note a fresh press.', 'C4 C#4 D4 D#4 E4 F4 F#4 G4 G#4 A4 A#4 B4 C5:2 B4 Bb4 A4 Ab4 G4 Gb4 F4 E4 Eb4 D4 Db4 C4:2', 85),
  lesson('blues', 'C blues scale', 'The G♭ is the blues note. Try adding echo after practicing the sequence.', 'C4 Eb4 F4 Gb4 G4 Bb4 C5:2 Bb4 G4 Gb4 F4 Eb4 C4:2', 90),
  lesson('sevenths', 'Major, minor and seventh chords', 'Hear C major, C minor, C dominant seventh and C major seventh. Press each whole chord together.', '[C4 E4 G4]:2 [C4 Eb4 G4]:2 [C4 E4 G4 Bb4]:2 [C4 E4 G4 B4]:4', 65),
  lesson('inversions', 'C major inversions', 'The same C, E and G change order. Listen as the lowest note changes.', '[C4 E4 G4]:2 [E4 G4 C5]:2 [G4 C5 E5]:2 [C5 E5 G5]:4', 65),
  lesson('pop-chords', 'Four-chord progression', 'C, G, A minor, F. Keep every chord steady for four beats, then make a variation with Copy to template.', '[C4 E4 G4]:4 [B3 D4 G4]:4 [A3 C4 E4]:4 [A3 C4 F4]:4', 80),
  lesson('alberti', 'Alberti bass pattern', 'Low, high, middle, high: a broken-chord accompaniment. Choose Warm for a softer sound.', 'C3 G3 E3 G3 C3 G3 E3 G3 F3 C4 A3 C4 G3 D4 B3 D4 C3:2', 100),
  lesson('bass-walk', 'Walking bass', 'Walk through C, E, G, A, then B♭. Keep the low notes light and even.', 'C2 E2 G2 A2 Bb2 A2 G2 E2 F2 A2 C3 D3 G2 B2 D3 F3 C3:2', 100),
  lesson('octave-jumps', 'Octave jumps', 'Same letter, different height. Try three visible octaves so the jumps stay in view.', 'C3 C4 C5 C4 D3 D4 D5 D4 E3 E4 E5 E4 C3:2 C5:2', 75),
  lesson('three-octave', 'Three-octave arpeggio', 'Choose four octaves to see the whole sweep. Practice waits for you if the jumps need time.', 'C2 E2 G2 C3 E3 G3 C4 E4 G4 C5:2 G4 E4 C4 G3 E3 C3 G2 E2 C2:2', 90),
  lesson('full-range', 'From A0 to C8', 'Explore the full 88-key keyboard. Scroll across the keys; the live guide scrolls with them. Each note lasts two beats.', 'A0:2 C1:2 C2:2 C3:2 C4:2 C5:2 C6:2 C7:2 C8:4', 60),
  lesson('mary', 'Mary Had a Little Lamb', 'A gentle three-note melody. Repeat E with separate presses.', 'E4 D4 C4 D4 E4 E4 E4:2 D4 D4 D4:2 E4 G4 G4:2 E4 D4 C4 D4 E4 E4 E4 E4 D4 D4 E4 D4 C4:2', 100),
  lesson('frere', 'Frère Jacques', 'Try the repeated phrases, then the quicker notes in the middle.', 'C4 D4 E4 C4 C4 D4 E4 C4 E4 F4 G4:2 E4 F4 G4:2 G4:.5 A4:.5 G4:.5 F4:.5 E4 C4 G4:.5 A4:.5 G4:.5 F4:.5 E4 C4 C4 G3 C4:2 C4 G3 C4:2', 85),
  lesson('amazing', 'Amazing Grace — opening', 'A pickup note leads into the longer C. Notice the dotted rhythm on E.', 'G3 C4:2 E4:.5 C4:.5 E4:2 D4 C4:2 A3 G3:2 G3 C4:2 E4:.5 C4:.5 E4:2 D4 G4:3', 75),
  lesson('offbeat', 'Offbeat rhythm', 'Count the rests too. The notes arrive between the main beats; slow Play along down first.', 'R:.5 C4:.5 R:.5 E4:.5 R:.5 G4:.5 R:.5 E4:.5 C4:1.5 G4:.5 R [C4 E4 G4]:2', 80),
  lesson('ambient', 'Ambient chord loop', 'Long, open chords. Choose Dreamy and turn on Loop for an atmospheric practice backdrop.', '[C3 G3 D4 E4]:4 [A2 E3 B3 C4]:4 [F2 C3 G3 A3]:4 [G2 D3 A3 B3]:4', 60),
  lesson('retro-run', 'Retro synth run', 'Choose Retro, then try the quarter-beat run. Begin slowly and raise the tempo as you get comfortable.', 'C4:.25 E4:.25 G4:.25 C5:.25 G4:.25 E4:.25 C4:.25 R:.25 A3:.25 C4:.25 E4:.25 A4:.25 E4:.25 C4:.25 A3:.25 R:.25 C4:2', 75),
];

export const pianoLessonGroups = {
  'Scales & note names': ['c-major', 'a-minor', 'g-major', 'f-major', 'd-major', 'harmonic-minor', 'chromatic', 'blues', 'black-keys', 'enharmonics'],
  'Chords & accompaniment': ['arpeggio', 'chords', 'sevenths', 'inversions', 'pop-chords', 'alberti', 'bass-walk'],
  'Melodies': ['twinkle', 'ode', 'mary', 'frere', 'amazing'],
  'Rhythm & creative loops': ['rhythm', 'offbeat', 'ambient', 'retro-run'],
  'Octave adventures': ['octave-jumps', 'three-octave', 'full-range'],
};

export function validatePianoTemplate(value) {
  if (!value || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 80) throw Error('Give your template a title of 1–80 characters.');
  if (typeof value.description !== 'string' || value.description.length > 600) throw Error('Keep instructions under 600 characters.');
  const tempo = Number(value.tempo);
  if (!Number.isFinite(tempo) || tempo < 40 || tempo > 240) throw Error('Choose a tempo between 40 and 240 BPM.');
  const steps = parsePianoSequence(value.sequence);
  return { title: value.title.trim(), description: value.description.trim(), sequence: value.sequence.trim(), tempo, steps, spotifyLink: normalizePianoSpotifyLink(value.spotifyLink) };
}

export function readPianoTemplates(storage) {
  try {
    const text = (storage || globalThis.localStorage)?.getItem(PIANO_TEMPLATE_KEY);
    if (!text) return { templates: [], error: '' };
    const data = JSON.parse(text);
    if (!Array.isArray(data) || data.length > MAX_PIANO_TEMPLATES) throw Error('Invalid library');
    const ids = new Set();
    const templates = data.map(value => {
      if (typeof value.id !== 'string' || !/^user-[a-z0-9-]{1,80}$/i.test(value.id) || ids.has(value.id)) throw Error('Invalid template ID');
      ids.add(value.id); return { ...validatePianoTemplate(value), id: value.id, builtin: false };
    });
    return { templates, error: '' };
  } catch { return { templates: [], error: 'Your saved template library could not be read. New templates will stay in this session; the existing library will be preserved.' }; }
}

export function savePianoTemplates(templates, storage) {
  try {
    const target = storage || globalThis.localStorage;
    if (!target) throw Error('Storage unavailable');
    target.setItem(PIANO_TEMPLATE_KEY, JSON.stringify(templates.map(({ id, title, description, sequence, tempo, spotifyLink }) => ({ id, title, description, sequence, tempo, spotifyLink }))));
    return '';
  } catch { return 'Saved for this session only. Local storage is unavailable; download a copy to keep your template.'; }
}

export function createPianoLessonPlayer(piano, onChange = () => {}, timers = globalThis) {
  let session = null, version = 0;
  function stop() {
    if (session) {
      const old = session; session = null;
      timers.clearTimeout(old.timer); timers.clearTimeout(old.releaseTimer);
      old.sources.forEach(source => piano.release(source));
    }
    onChange({ running: false, index: -1 });
  }
  async function advance(current, index) {
    if (session !== current) return;
    if (index >= current.steps.length) {
      if (current.loop) index = 0;
      else { stop(); return; }
    }
    const step = current.steps[index];
    if (piano.ensureNotes) piano.ensureNotes(step.notes);
    else { const octave = octaveForStep(step.notes, piano.getSnapshot().octave); if (piano.getSnapshot().octave !== octave) piano.setOctave(octave); }
    const state = piano.getSnapshot(), baseMidi = state.baseMidi ?? (state.octave + 1) * 12;
    onChange({ running: true, index, starting: true, startedAt: null });
    const sources = step.notes.map((note, noteIndex) => `lesson:${current.id}:${index}:${noteIndex}`);
    sources.forEach(source => current.sources.add(source));
    await Promise.all(step.notes.map((note, noteIndex) => piano.press(note.midi - baseMidi, sources[noteIndex])));
    if (session !== current) return;
    if (piano.getSnapshot().error) { stop(); return; }
    const duration = step.beats * 60000 / current.tempo;
    onChange({ running: true, index, starting: false, startedAt: globalThis.performance?.now?.() ?? Date.now() });
    current.releaseTimer = timers.setTimeout(() => { sources.forEach(source => { piano.release(source); current.sources.delete(source); }); }, duration * .85);
    current.timer = timers.setTimeout(() => { void advance(current, index + 1); }, duration);
  }
  function play(template, tempo = template.tempo, loop = false) {
    stop(); piano.stopAll();
    session = { id: ++version, steps: template.steps, tempo, loop, sources: new Set(), timer: null, releaseTimer: null };
    void advance(session, 0);
  }
  return { play, stop };
}
