import * as tf from '@tensorflow/tfjs';
import { BasicPitch, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch';
import model from '@spotify/basic-pitch/model/model.json';
import weightsUrl from './assets/piano-model/basic-pitch.bin?inline';

self.onmessage = async ({ data: { samples, threshold } }) => {
  try {
    await tf.setBackend('cpu'); await tf.ready();
    const encoded = weightsUrl.slice(weightsUrl.indexOf(',') + 1);
    const binary = atob(encoded), weights = Uint8Array.from(binary, character => character.charCodeAt(0));
    const graph = await tf.loadGraphModel(tf.io.fromMemory({ modelTopology: model.modelTopology,
      weightSpecs: model.weightsManifest.flatMap(group => group.weights), weightData: weights.buffer }));
    const frames = [], onsets = [];
    const predictor = new BasicPitch(Promise.resolve(graph));
    await predictor.evaluateModel(samples, (f, o) => { frames.push(...f); onsets.push(...o); }, value => self.postMessage({ type: 'progress', value }));
    const notes = noteFramesToTime(outputToNotesPoly(frames, onsets, threshold, threshold, 7))
      .filter(note => note.durationSeconds >= .07 && note.startTimeSeconds < samples.length / 22050)
      .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds || a.pitchMidi - b.pitchMidi);
    self.postMessage({ type: 'result', notes });
  } catch (error) { self.postMessage({ type: 'error', message: `Could not convert this clip: ${error.message}` }); }
  // The caller terminates this one-shot worker, freeing the model and all tensors.
};
