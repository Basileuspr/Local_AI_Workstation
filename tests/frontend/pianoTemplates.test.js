import { afterEach, expect, it, vi } from 'vitest';
import { createPianoLessonPlayer, enharmonicNames, octaveForStep, parsePianoNote, parsePianoSequence, pianoLessons, pianoLessonGroups, PIANO_TEMPLATE_KEY, readPianoTemplates, savePianoTemplates, validatePianoTemplate } from '../../src/pianoTemplates';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('maps enharmonic spellings to the same pitch with correct written octaves', () => {
  for (const [a, b] of [['C#4', 'Db4'], ['D#4', 'Eb4'], ['F#4', 'Gb4'], ['G#4', 'Ab4'], ['A#4', 'Bb4'], ['E#4', 'F4'], ['Fb4', 'E4'], ['B#3', 'C4'], ['Cb5', 'B4'], ['F##4', 'G4'], ['Gbb4', 'F4'], ['B##3', 'C#4'], ['Cbb5', 'Bb4']]) {
    expect(parsePianoNote(a).midi).toBe(parsePianoNote(b).midi);
  }
  expect(parsePianoNote('Fx4').midi).toBe(67);
  expect(parsePianoNote('G𝄫4').midi).toBe(65);
  expect(parsePianoNote('C♮4').midi).toBe(60);
  expect(enharmonicNames(60)).toEqual(['C4', 'D𝄫4', 'B♯3']);
  expect(enharmonicNames(60, false)).toEqual(['C4', 'B♯3']);
  expect(enharmonicNames(71)).toContain('C♭5');
  for (let midi = 21; midi <= 108; midi++) for (const name of enharmonicNames(midi)) expect(parsePianoNote(name).midi).toBe(midi);
});

it('parses melodies, chords, rests, rhythm and every authored lesson', () => {
  const steps = parsePianoSequence(' Db4:0.5 [C4 E4 G4]:2\nR:.25 F𝄪4:1.5 ');
  expect(steps.map(step => step.beats)).toEqual([.5, 2, .25, 1.5]);
  expect(steps[1].notes.map(note => note.midi)).toEqual([60, 64, 67]);
  expect(steps[2].notes).toEqual([]);
  expect(steps[0].notes[0].name).toBe('D♭4');
  expect(pianoLessons).toHaveLength(29);
  expect(new Set(pianoLessons.map(item => item.id)).size).toBe(29);
  for (const item of pianoLessons) expect(validatePianoTemplate(item).steps).toEqual(item.steps);
  expect(octaveForStep(parsePianoSequence('[B3 C4]')[0].notes)).toBe(3);
});

it('rejects malformed, excessive and unplayable steps without dropping user text', () => {
  for (const text of ['', 'R R', 'H4', 'C4:0', 'C4:9', 'C4:-1', 'C4garbage', '[C4 E4', 'C4 [D4 [E4]]', '[C#4 Db4]', 'C0', 'G#0', 'C#8', '<script>', 'C4 '.repeat(129)]) expect(() => parsePianoSequence(text)).toThrow();
  expect(() => validatePianoTemplate({ title: '', description: '', tempo: 90, sequence: 'C4' })).toThrow('title');
  expect(() => validatePianoTemplate({ title: 'Test', description: '', tempo: 25, sequence: 'C4' })).toThrow('tempo');
  expect(() => validatePianoTemplate({ title: 'Test', description: '', tempo: 90 })).toThrow('characters');
  expect(octaveForStep([{ midi: 36 }, { midi: 59 }], 4)).toBe(2);
});

it('round-trips custom templates and reports inaccessible or corrupt storage', () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const template = { ...validatePianoTemplate({ title: ' My lesson ', description: 'Learn flats', sequence: 'Db4 [F4 Ab4]:2 R C5', tempo: 100 }), id: 'user-example' };
  expect(savePianoTemplates([template], storage)).toBe('');
  const loaded = readPianoTemplates(storage);
  expect(loaded.error).toBe(''); expect(loaded.templates[0].title).toBe('My lesson');
  expect(loaded.templates[0].steps).toEqual(template.steps);
  const raw = 'invalid original library'; values.set(PIANO_TEMPLATE_KEY, raw);
  expect(readPianoTemplates(storage).error).toContain('preserved'); expect(values.get(PIANO_TEMPLATE_KEY)).toBe(raw);
  expect(savePianoTemplates([template], { setItem: () => { throw Error('quota'); } })).toContain('session only');
  expect(readPianoTemplates({ getItem: () => { throw Error('denied'); } }).templates).toEqual([]);
});

function fakePiano() {
  let octave = 4;
  return { press: vi.fn(async () => {}), release: vi.fn(), stopAll: vi.fn(), setOctave: vi.fn(value => { octave = value; }), getSnapshot: () => ({ octave, error: '' }) };
}

it('plays chords and rests for their beat lengths, releases voices, and finishes', async () => {
  vi.useFakeTimers();
  const piano = fakePiano(), update = vi.fn(), player = createPianoLessonPlayer(piano, update);
  player.play({ steps: parsePianoSequence('[C4 E4 G4]:2 R C5'), tempo: 120 });
  await vi.advanceTimersByTimeAsync(0);
  expect(piano.press.mock.calls.map(call => call[0])).toEqual([0, 4, 7]);
  await vi.advanceTimersByTimeAsync(850); expect(piano.release).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(150); expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ running: true, index: 1, startedAt: expect.any(Number) }));
  expect(piano.press).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(500); expect(piano.press.mock.calls.at(-1)[0]).toBe(12);
  await vi.advanceTimersByTimeAsync(500); expect(update).toHaveBeenLastCalledWith({ running: false, index: -1 });
  expect(vi.getTimerCount()).toBe(0);
});

it('stops pending audio starts and looping playback without late notes', async () => {
  vi.useFakeTimers();
  const piano = fakePiano(), update = vi.fn(); let finish;
  piano.press.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const player = createPianoLessonPlayer(piano, update);
  player.play({ steps: parsePianoSequence('C4 D4'), tempo: 120 }); player.stop();
  expect(piano.release).toHaveBeenCalledTimes(1);
  finish(); await vi.advanceTimersByTimeAsync(2000);
  expect(piano.press).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  piano.press.mockResolvedValue(undefined);
  player.play({ steps: parsePianoSequence('C2'), tempo: 120 }, 120, true);
  await vi.advanceTimersByTimeAsync(1500);
  expect(piano.setOctave).toHaveBeenCalledWith(2);
  expect(piano.press).toHaveBeenCalledTimes(5);
  player.stop(); await vi.advanceTimersByTimeAsync(1000);
  expect(piano.press).toHaveBeenCalledTimes(5); expect(vi.getTimerCount()).toBe(0);
});

it('covers every lesson in a browsable category and supports full-range templates', () => {
  expect(Object.values(pianoLessonGroups).flat().sort()).toEqual(pianoLessons.map(item => item.id).sort());
  expect(parsePianoSequence('[A0 C8]:4')[0].notes.map(note => note.midi)).toEqual([21,108]);
});
