import { pianoKeysForRange, pianoMapping } from './miniPiano';

export const pianoGuideNow = () => globalThis.performance?.now?.() ?? Date.now();
export function pianoTimeline(steps) {
  let beat = 0;
  return steps.map((step, index) => {
    const entry = { ...step, index, beat, endBeat: beat + step.beats };
    beat = entry.endBeat; return entry;
  });
}
export const pianoGuideLanes = pianoKeysForRange();
export function pianoKeyHint(midi, octave, keyCount = 24, baseMidi = (octave + 1) * 12) {
  const index = midi - baseMidi;
  return index < 0 || index >= keyCount ? 'octave change' : pianoMapping[index]?.toUpperCase() || 'tap key';
}

// Judges note/chord attacks, with a separate release required for repeated notes.
// Audio is produced by the normal piano keys; this clock never plays for the user.
export function createPianoRhythmRun(steps, tempo, now = pianoGuideNow()) {
  const timeline = pianoTimeline(steps), beatMs = 60000 / tempo, startedAt = now + 4 * beatMs;
  const results = steps.map(() => null), total = steps.filter(step => step.notes.length).length;
  let held = [], streak = 0, feedback = 'Get ready — four-beat count-in', feedbackKind = 'ready';
  const endAt = startedAt + timeline.at(-1).endBeat * beatMs;
  const windowFor = step => Math.min(240, beatMs * .3, step.beats * beatMs * .45);
  function snapshot(time) {
    const beat = (time - startedAt) / beatMs;
    const index = Math.max(0, timeline.findLastIndex(step => step.beat <= beat));
    return { startedAt, tempo, running: time < endAt, done: time >= endAt, index, countIn: Math.max(0, Math.ceil(-beat)),
      results: [...results], total, hits: results.filter(value => value === 'hit').length, misses: results.filter(value => value === 'miss').length,
      streak, feedback, feedbackKind };
  }
  function tick(time) {
    for (const step of timeline) {
      if (results[step.index]) continue;
      if (!step.notes.length && time >= startedAt + step.endBeat * beatMs) results[step.index] = 'rest';
      else if (step.notes.length && time > startedAt + step.beat * beatMs + windowFor(step)) {
        results[step.index] = 'miss'; streak = 0; feedback = `Missed ${step.notes.map(note => note.name).join(' + ')} — keep going`; feedbackKind = 'miss';
      }
    }
    return snapshot(time);
  }
  function observe(notes, time = pianoGuideNow()) {
    tick(time);
    const next = [...new Set(notes)].sort((a, b) => a - b);
    const attack = next.some(note => !held.includes(note)); held = next;
    if (!attack || time >= endAt) return snapshot(time);
    const candidates = timeline.filter(step => !results[step.index] && step.notes.length &&
      Math.abs(time - (startedAt + step.beat * beatMs)) <= windowFor(step));
    const match = candidates.filter(step => step.notes.map(note => note.midi).sort((a, b) => a - b).join(',') === next.join(','))
      .sort((a, b) => Math.abs(time - startedAt - a.beat * beatMs) - Math.abs(time - startedAt - b.beat * beatMs))[0];
    if (match) {
      results[match.index] = 'hit'; streak++;
      const offset = time - startedAt - match.beat * beatMs;
      feedback = `${Math.abs(offset) < 70 ? 'On time' : offset < 0 ? 'Early hit' : 'Late hit'} · ${match.notes.map(note => note.name).join(' + ')}`;
      feedbackKind = 'hit';
    } else if (time < startedAt - windowFor(timeline[0])) { feedback = 'Wait for the notes to reach the line'; feedbackKind = 'ready'; }
    else if (candidates.length) { feedback = `Aim for ${candidates[0].notes.map(note => note.name).join(' + ')}`; feedbackKind = 'try'; }
    else { feedback = 'Watch the next notes at the line'; feedbackKind = 'try'; }
    return snapshot(time);
  }
  return { startedAt, tick, observe };
}
