import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import BreakRoom from '../../src/components/BreakRoom';
import { audioOutput } from '../../src/audioOutput';
import { createMiniPiano } from '../../src/miniPiano';
import { pianoSoundPresets } from '../../src/pianoEffects';
import '../../src/styles.css';
async function renderSound(settings, stop = false, held = false) {
  const context = new OfflineAudioContext(1, 96000, 48000);
  const piano = createMiniPiano(async () => ({ context, input: context.destination }));
  piano.setEffects(settings); await piano.press(0, 'qa');
  if (stop) piano.stopAll();
  const paused = !held && !stop ? context.suspend(.1) : null;
  const rendering = context.startRendering();
  if (paused) { await paused; piano.release('qa'); await context.resume(); }
  const buffer = await rendering, data = buffer.getChannelData(0);
  const rms = (from, to) => {
    let sum = 0; for (let i = Math.floor(from * 48000); i < Math.floor(to * 48000); i++) sum += data[i] ** 2;
    return Math.sqrt(sum / ((to - from) * 48000));
  };
  const harmonic = multiple => {
    let real = 0, imaginary = 0;
    for (let i = 19200; i < 38400; i++) { const phase = 2 * Math.PI * 261.625565 * multiple * i / 48000; real += data[i] * Math.cos(phase); imaginary += data[i] * Math.sin(phase); }
    return Math.hypot(real, imaginary);
  };
  const result = { harmonicRatio: harmonic(3) / Math.max(1e-12, harmonic(1)), onset: rms(.01, .08), tail: rms(.3, .8), late: rms(1.2, 1.8), samples: Array.from(data.slice(4800, 5000)) };
  piano.stopAll(); return result;
}
window.pianoQA = { renderSound, presets: pianoSoundPresets, levels: () => audioOutput.mixer.levels(), master: value => audioOutput.configure(value) };
function Fixture() {
  const [active, setActive] = useState(true);
  return <React.StrictMode><div style={{ height: '100%', overflow: 'auto' }}>
    <nav style={{ padding: 12 }}><button onClick={() => setActive(value => !value)}>Switch workspace</button><input aria-label="Outside piano" /></nav>
    <div hidden={!active}><BreakRoom active={active} /></div>
  </div></React.StrictMode>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
