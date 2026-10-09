import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MiniPiano from '../../src/components/MiniPiano';
import { createMiniPiano, pianoFrequency, pianoKeysForRange } from '../../src/miniPiano';

function audioFixture() {
  const oscillators = [], gains = [];
  const context = {
    currentTime: 5,
    createOscillator() {
      const osc = { frequency: {}, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() };
      oscillators.push(osc); return osc;
    },
    createGain() {
      const gain = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
      gains.push(gain); return gain;
    },
  };
  return { context, input: {}, oscillators, gains };
}

it('plays correctly tuned chords and keeps a note held by independent input sources', async () => {
  const audio = audioFixture(), piano = createMiniPiano(async () => audio);
  await piano.press(9, 'keyboard'); await piano.press(9, 'pointer'); await piano.press(0, 'second');
  expect(audio.oscillators).toHaveLength(2);
  expect(audio.oscillators[0].frequency.value).toBe(440);
  expect(audio.oscillators[1].frequency.value).toBeCloseTo(261.625565);
  piano.release('keyboard'); expect(audio.oscillators[0].stop).not.toHaveBeenCalled();
  piano.release('pointer'); expect(audio.oscillators[0].stop).toHaveBeenCalledWith(5.15);
  piano.stopAll(); expect(piano.getSnapshot().playing).toEqual([]);
  audio.oscillators[0].onended(); expect(audio.gains[0].disconnect).toHaveBeenCalled();
});

it('cancels pending audio startup on release, hidden tab or octave change', async () => {
  const audio = audioFixture(); let resolve;
  const open = new Promise(done => { resolve = done; });
  const piano = createMiniPiano(() => open);
  const first = piano.press(0, 'quick'); piano.release('quick');
  const second = piano.press(4, 'hidden'); piano.stopAll();
  const third = piano.press(7, 'octave'); piano.setOctave(5);
  resolve(audio); await Promise.all([first, second, third]);
  expect(audio.oscillators).toHaveLength(0);
  await piano.press(9, 'new'); expect(audio.oscillators[0].frequency.value).toBe(880);
  piano.stopAll();
});

it('updates held volume and recovers from unavailable audio', async () => {
  const audio = audioFixture(), open = vi.fn().mockRejectedValueOnce(Error('unavailable')).mockResolvedValue(audio);
  const piano = createMiniPiano(open);
  await piano.press(0, 'key'); expect(piano.getSnapshot().error).toContain('Audio unavailable');
  await piano.press(0, 'key'); piano.setVolume(0);
  expect(piano.getSnapshot().error).toBe('');
  expect(audio.gains[0].gain.setTargetAtTime).toHaveBeenCalledWith(0, 5, .01);
  piano.setOctave(100); expect(piano.getSnapshot().octave).toBe(6);
  piano.setOctave(-1); expect(piano.getSnapshot().octave).toBe(1);
  expect(pianoFrequency(9, 2)).toBe(110);
});

it('renders all 24 accessible keys and octave/volume controls without opening audio', () => {
  const html = renderToStaticMarkup(<MiniPiano />);
  expect(html.match(/data-piano-note=/g)).toHaveLength(24);
  expect(html).toContain('aria-label="C4"'); expect(html).toContain('aria-label="B5"');
  expect(html).toContain('Lower octave'); expect(html).toContain('Higher octave');
  expect(html).toContain('Tap a key to start audio');
  expect(html).toContain('Enharmonic equivalents'); expect(html).toContain('New template');
  expect(html).toContain('C major scale'); expect(html).toContain('Sharps &amp; flats');
});

it('distinguishes lesson playback from manually held keys, including shared voices', async () => {
  const audio = audioFixture(), piano = createMiniPiano(async () => audio);
  await piano.press(0, 'lesson:one'); expect(piano.getSnapshot().manualPlaying).toEqual([]);
  await piano.press(0, 'keyboard:a'); expect(piano.getSnapshot().manualPlaying).toEqual([0]);
  piano.release('keyboard:a'); expect(piano.getSnapshot().manualPlaying).toEqual([]);
  expect(piano.getSnapshot().playing).toEqual([0]); piano.stopAll();
});

it('plays wider ranges and automatically includes the lowest and highest piano notes', async () => {
  const audio = audioFixture(), piano = createMiniPiano(async () => audio);
  piano.setKeyCount(48); piano.setOctave(4);
  await piano.press(47, 'high'); expect(audio.oscillators.at(-1).frequency.value).toBeCloseTo(3951.0664);
  piano.ensureNotes([{ midi: 21 }, { midi: 108 }]);
  expect(piano.getSnapshot()).toMatchObject({ keyCount: 88, baseMidi: 21, playing: [] });
  await piano.press(0, 'low'); await piano.press(87, 'top');
  expect(audio.oscillators.at(-2).frequency.value).toBe(27.5);
  expect(audio.oscillators.at(-1).frequency.value).toBeCloseTo(4186.009);
  piano.setKeyCount(36); expect(piano.getSnapshot().playing).toEqual([]);
  piano.ensureNotes([{ midi: 24 }]); expect(piano.getSnapshot().baseMidi).toBe(24);
  for (const [base, count, whites] of [[60,24,14],[48,36,21],[24,48,28],[21,88,52]]) {
    const keys = pianoKeysForRange(base,count);
    expect(keys.filter(key => !key.black)).toHaveLength(whites);
    expect(keys[0].left).toBe(0); expect(keys.at(-1).left + keys.at(-1).width).toBeCloseTo(100);
    expect(keys.every(key => key.left >= 0 && key.left + key.width <= 100.000001)).toBe(true);
  }
  piano.stopAll();
});
it('updates waveform and sustain while preserving safe settings and voice cleanup', async () => {
  const audio = audioFixture(), piano = createMiniPiano(async () => audio);
  await piano.press(0, 'key'); piano.setEffects({ waveform: 'square', sustain: 100, reverb: 200, echo: -10 });
  expect(audio.oscillators[0].type).toBe('square');
  expect(piano.getSnapshot().effects).toMatchObject({ sustain: 100, reverb: 100, echo: 0 });
  piano.release('key'); expect(audio.oscillators[0].stop).toHaveBeenCalledWith(8.15);
  expect(piano.getSnapshot().playing).toEqual([]);
  piano.setEffects({ waveform: 'bad', sustain: NaN }); expect(piano.getSnapshot().effects.waveform).toBe('square');
});
