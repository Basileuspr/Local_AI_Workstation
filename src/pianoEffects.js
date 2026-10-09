export const cleanPianoEffects = { waveform: 'triangle', tone: 100, reverb: 0, echo: 0, tremolo: 0, sustain: 0 };
export const pianoSoundPresets = {
  Clean: cleanPianoEffects,
  Warm: { ...cleanPianoEffects, waveform: 'sine', tone: 45, sustain: 25 },
  Dreamy: { ...cleanPianoEffects, tone: 65, reverb: 45, echo: 25, sustain: 45 },
  Retro: { ...cleanPianoEffects, waveform: 'square', tone: 35, echo: 20, tremolo: 35 },
};

// One rack per piano, always upstream of the workstation mixer and master mute.
export function createPianoEffectsRack(context, output, settings) {
  const input = context.createGain(), filter = context.createBiquadFilter(), amp = context.createGain();
  const reverb = context.createConvolver(), reverbWet = context.createGain();
  const delay = context.createDelay(1), feedback = context.createGain(), echoWet = context.createGain();
  const lfo = context.createOscillator(), depth = context.createGain();
  const nodes = [input, filter, amp, reverb, reverbWet, delay, feedback, echoWet, lfo, depth];
  const impulse = context.createBuffer(2, Math.ceil(context.sampleRate * 1.6), context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
  }
  reverb.buffer = impulse; filter.type = 'lowpass'; filter.Q.value = .5;
  delay.delayTime.value = .28; feedback.gain.value = .28; lfo.frequency.value = 5;
  input.connect(filter); filter.connect(amp); amp.connect(output);
  amp.connect(reverb); reverb.connect(reverbWet); reverbWet.connect(output);
  amp.connect(delay); delay.connect(echoWet); echoWet.connect(output); delay.connect(feedback); feedback.connect(delay);
  lfo.connect(depth); depth.connect(amp.gain); lfo.start();
  function update(value) {
    const smooth = (param, amount) => param.setTargetAtTime(amount, context.currentTime, .025);
    smooth(filter.frequency, 300 * (20000 / 300) ** (value.tone / 100));
    smooth(reverbWet.gain, value.reverb / 100 * .65);
    smooth(echoWet.gain, value.echo / 100 * .55);
    smooth(amp.gain, 1 - value.tremolo / 200); smooth(depth.gain, value.tremolo / 200);
  }
  update(settings);
  return { input, update, dispose() { lfo.stop(); nodes.forEach(node => node.disconnect()); } };
}
