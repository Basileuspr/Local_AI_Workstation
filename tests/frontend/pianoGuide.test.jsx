import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPianoRhythmRun, pianoGuideLanes, pianoKeyHint, pianoTimeline } from '../../src/pianoGuide';
import { parsePianoSequence } from '../../src/pianoTemplates';
import PianoRoll from '../../src/components/PianoRoll';

it('builds a beat timeline with rests and chords and aligns lanes to the actual keyboard', () => {
  const timeline = pianoTimeline(parsePianoSequence('C4:.5 [E4 G4]:2 R D5'));
  expect(timeline.map(step => [step.beat, step.endBeat])).toEqual([[0, .5], [.5, 2.5], [2.5, 3.5], [3.5, 4.5]]);
  expect(pianoGuideLanes).toHaveLength(24);
  expect(pianoGuideLanes.filter(lane => !lane.black)).toHaveLength(14);
  expect(pianoGuideLanes[0].left).toBe(0);
  expect(pianoGuideLanes[1].left + pianoGuideLanes[1].width / 2).toBeCloseTo(100 / 14);
  expect(pianoGuideLanes.at(-1).left + pianoGuideLanes.at(-1).width).toBeCloseTo(100);
  expect(pianoKeyHint(60, 4)).toBe('A'); expect(pianoKeyHint(61, 4)).toBe('W');
  expect(pianoKeyHint(83, 4)).toBe('tap key'); expect(pianoKeyHint(60, 5)).toBe('octave change');
});

it('provides a four-beat count-in and scores enharmonic attacks at the hit line', () => {
  const run = createPianoRhythmRun(parsePianoSequence('Db4 C#4'), 120, 1000);
  expect(run.startedAt).toBe(3000); expect(run.tick(1000).countIn).toBe(4); expect(run.tick(2000).countIn).toBe(2);
  expect(run.observe([61], 1500).hits).toBe(0);
  run.observe([], 2800);
  const first = run.observe([61], 3000);
  expect(first.hits).toBe(1); expect(first.feedback).toContain('On time'); expect(first.results).toEqual(['hit', null]);
  // Holding the same key across the next note never counts as another attack.
  expect(run.observe([61], 3500).hits).toBe(1);
  run.observe([], 3520); expect(run.observe([61], 3540).hits).toBe(2);
  const finished = run.tick(4000);
  expect(finished.done).toBe(true); expect(finished.streak).toBe(2); expect(finished.misses).toBe(0);
});

it('accepts full chords, rejects extra notes, and keeps rests out of the hit score', () => {
  const run = createPianoRhythmRun(parsePianoSequence('[C4 E4 G4]:2 R D4'), 120, 0);
  expect(run.observe([60], 1950).hits).toBe(0);
  expect(run.observe([60, 64], 1980).hits).toBe(0);
  expect(run.observe([60, 64, 67, 69], 2000).hits).toBe(0);
  run.observe([], 2020);
  expect(run.observe([60, 64, 67], 2040).hits).toBe(1);
  run.observe([], 2200);
  const next = run.tick(3500); expect(next.results).toEqual(['hit', 'rest', null]); expect(next.total).toBe(2);
  expect(run.observe([62], 3500).hits).toBe(2);
  expect(run.tick(4000).done).toBe(true);
});

it('counts unplayed and mistimed notes once and ends after the whole sequence', () => {
  const run = createPianoRhythmRun(parsePianoSequence('C4 D4:.5 E4:.5'), 120, 0);
  expect(run.observe([60], 1800).hits).toBe(0);
  const misses = run.tick(3200);
  expect(misses.misses).toBe(3); expect(misses.hits).toBe(0); expect(misses.done).toBe(true);
  expect(run.observe([60], 4000).misses).toBe(3);
  const hitRun = createPianoRhythmRun(parsePianoSequence('C4 D4'), 120, 0);
  expect(hitRun.observe([60], 1900).feedback).toContain('Early hit');
  expect(hitRun.tick(2651).streak).toBe(0);
});

it('renders next-key prompts, grouped chord bars, rests and accessible controls', () => {
  const html = renderToStaticMarkup(<PianoRoll steps={parsePianoSequence('[C4 E4 G4] R D4')} title="Chord lesson" octave={4} tempo={90} mode="practice" />);
  expect(html).toContain('Live piano note guide'); expect(html).toContain('Play along'); expect(html).toContain('Practice · waits for you');
  expect(html).toContain('C4 + E4 + G4'); expect(html).toContain('<kbd>A</kbd>'); expect(html).toContain('<kbd>D</kbd>'); expect(html).toContain('<kbd>G</kbd>');
  expect(html.match(/data-guide-step="0"/g)).toHaveLength(3);
  expect(html).toContain('REST · 1 beat'); expect(html).toContain('Upcoming piano notes');
});
