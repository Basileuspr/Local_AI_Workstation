export const demoNetwork = {
  hiddenWeights: [[.8, -.5], [-.4, .9], [.6, .6]], hiddenBiases: [.1, -.2, 0],
  outputWeights: [[1, -.6, .3], [-.5, .8, -.4]], outputBiases: [.05, -.05],
};
export const freshNetwork = () => JSON.parse(JSON.stringify(demoNetwork));
export const activate = (value, kind) => kind === 'relu' ? Math.max(0, value) : kind === 'sigmoid' ? 1 / (1 + Math.exp(-value)) : Math.tanh(value);
export function forwardPass(network, inputs, activation = 'tanh') {
  const hiddenSums = network.hiddenWeights.map((weights, index) => weights.reduce((sum, weight, i) => sum + weight * inputs[i], network.hiddenBiases[index]));
  const hidden = hiddenSums.map(value => activate(value, activation));
  const logits = network.outputWeights.map((weights, index) => weights.reduce((sum, weight, i) => sum + weight * hidden[i], network.outputBiases[index]));
  const maximum = Math.max(...logits), exps = logits.map(value => Math.exp(value - maximum));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return { hiddenSums, hidden, logits, outputs: exps.map(value => value / total) };
}
export const networkConnections = [
  ...demoNetwork.hiddenWeights.flatMap((row, to) => row.map((_, from) => ({ id: `hidden-${to}-${from}`, layer: 'hidden', from, to, label: `Input ${from + 1} → Hidden ${to + 1}` }))),
  ...demoNetwork.outputWeights.flatMap((row, to) => row.map((_, from) => ({ id: `output-${to}-${from}`, layer: 'output', from, to, label: `Hidden ${from + 1} → Output ${to + 1}` }))),
];
export function setConnectionWeight(network, connection, value) {
  if (!Number.isFinite(value)) return network;
  const key = `${connection.layer}Weights`;
  return { ...network, [key]: network[key].map((row, index) => index === connection.to ? row.map((weight, from) => from === connection.from ? Math.max(-3, Math.min(3, value)) : weight) : row) };
}
