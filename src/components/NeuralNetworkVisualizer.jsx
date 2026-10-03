import { useState } from 'react';
import { forwardPass, freshNetwork, networkConnections, setConnectionWeight } from '../neuralNetwork';
import WorkspaceInfo from './WorkspaceInfo';
import './Learning.css';
import './NeuralNetwork.css';

const positions = { input: [[65, 115], [65, 255]], hidden: [[275, 75], [275, 185], [275, 295]], output: [[485, 115], [485, 255]] };
const fmt = value => value.toFixed(3);
export default function NeuralNetworkVisualizer() {
  const [inputs, setInputs] = useState([.5, -.5]), [network, setNetwork] = useState(freshNetwork);
  const [activation, setActivation] = useState('tanh'), [connectionId, setConnectionId] = useState('hidden-0-0');
  const [biasId, setBiasId] = useState('hidden-0'), [stage, setStage] = useState(2);
  const pass = forwardPass(network, inputs, activation);
  const connection = networkConnections.find(item => item.id === connectionId);
  const weight = network[`${connection.layer}Weights`][connection.to][connection.from];
  const [biasLayer, biasIndex] = biasId.split('-'), bias = network[`${biasLayer}Biases`][Number(biasIndex)];
  function reset() { setNetwork(freshNetwork()); setInputs([.5, -.5]); setActivation('tanh'); setStage(2); }
  function neuron(layer, values, visible) {
    return positions[layer].map(([x, y], i) => <g key={`${layer}-${i}`}>
      <circle cx={x} cy={y} r="31" fill={visible ? 'var(--accent-dim)' : 'var(--bg-card)'} stroke={visible ? (values[i] < 0 ? 'var(--orange)' : 'var(--accent)') : 'var(--border)'} strokeWidth={visible ? 2 + Math.min(3, Math.abs(values[i]) * 3) : 2} />
      <text x={x} y={y + 5} textAnchor="middle" fill="var(--text)" fontSize="13">{visible ? fmt(values[i]) : '—'}</text>
      <text x={x} y={y + 49} textAnchor="middle" fill="var(--text-dim)" fontSize="12">{layer === 'input' ? 'Input' : layer === 'hidden' ? 'Hidden' : 'Output'} {i + 1}</text>
    </g>);
  }
  return <section className="learning-workspace neural-workspace" aria-label="Neural Network">
    <header className="learning-heading"><div><span className="learning-eyebrow">INTERACTIVE FORWARD PASS</span><h1>Neural Network</h1><p>Change inputs, weights, and biases to see a small network compute its activations. This educational network runs locally in your browser; it is separate from installed AI models.</p></div><button type="button" onClick={reset}>Reset network</button></header>
    <div className="neural-layout"><div className="neural-diagram">
      <svg viewBox="0 0 560 370" role="img" aria-label={`Two inputs, three hidden neurons, two softmax outputs. Visible stage: ${['inputs', 'hidden layer', 'output layer'][stage]}.`}>
        {networkConnections.map(item => {
          const [x1, y1] = positions[item.layer === 'hidden' ? 'input' : 'hidden'][item.from], [x2, y2] = positions[item.layer][item.to];
          const currentWeight = network[`${item.layer}Weights`][item.to][item.from];
          const shown = item.layer === 'hidden' ? stage >= 1 : stage >= 2;
          return <g key={item.id} opacity={shown ? 1 : .15}><title>{`${item.label}: weight ${fmt(currentWeight)}`}</title>
            <line x1={x1 + 30} y1={y1} x2={x2 - 30} y2={y2} stroke={currentWeight < 0 ? 'var(--orange)' : 'var(--accent)'} strokeWidth={1 + Math.abs(currentWeight) * 1.5} strokeDasharray={currentWeight < 0 ? '6 4' : undefined} opacity={item.id === connectionId ? 1 : .4} />
          </g>;
        })}
        {neuron('input', inputs, true)}{neuron('hidden', pass.hidden, stage >= 1)}{neuron('output', pass.outputs, stage >= 2)}
      </svg>
      <p className="neural-legend">Solid blue: positive weight · Dashed orange: negative weight · Line width: weight magnitude</p>
      <div className="learning-actions"><button type="button" onClick={() => setStage(0)}>Start at inputs</button><button type="button" disabled={stage === 2} onClick={() => setStage(value => value + 1)}>Next layer</button><button type="button" onClick={() => setStage(2)}>Show all layers</button></div>
      <p role="status">Showing {['inputs', 'hidden activations', 'the complete forward pass'][stage]}.</p>
    </div><div className="neural-controls">
      <WorkspaceInfo tab="neural-network" buttonText="Info & examples" />
      {inputs.map((value, index) => <label key={index}>Input {index + 1}: {fmt(value)}<input type="range" min="-2" max="2" step=".05" aria-label={`Input ${index + 1}`} value={value} onChange={event => setInputs(current => current.map((v, i) => i === index ? Number(event.target.value) : v))} /></label>)}
      <label>Hidden activation<select aria-label="Hidden activation" value={activation} onChange={event => setActivation(event.target.value)}><option value="tanh">tanh (−1 to 1)</option><option value="relu">ReLU (zero or positive)</option><option value="sigmoid">Sigmoid (0 to 1)</option></select></label>
      <label>Connection<select aria-label="Connection" value={connectionId} onChange={event => setConnectionId(event.target.value)}>{networkConnections.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Weight: {fmt(weight)}<input type="range" min="-3" max="3" step=".05" aria-label="Connection weight" value={weight} onChange={event => setNetwork(current => setConnectionWeight(current, connection, Number(event.target.value)))} /></label>
      <label>Neuron bias<select aria-label="Neuron bias" value={biasId} onChange={event => setBiasId(event.target.value)}>{[['hidden', 3], ['output', 2]].flatMap(([layer, count]) => Array.from({ length: count }, (_, i) => <option key={`${layer}-${i}`} value={`${layer}-${i}`}>{layer === 'hidden' ? 'Hidden' : 'Output'} {i + 1}</option>))}</select></label>
      <label>Bias: {fmt(bias)}<input type="range" min="-3" max="3" step=".05" aria-label="Bias value" value={bias} onChange={event => setNetwork(current => ({ ...current, [`${biasLayer}Biases`]: current[`${biasLayer}Biases`].map((v, i) => i === Number(biasIndex) ? Number(event.target.value) : v) }))} /></label>
    </div></div>
    <div className="neural-readings"><section><h2>Hidden layer</h2><p>Weighted sum = Σ(input × weight) + bias. Apply {activation} to obtain the activation.</p>
      <table><thead><tr><th>Neuron</th><th>Weighted sum</th><th>Activation</th></tr></thead><tbody>{pass.hidden.map((value, i) => <tr key={i}><th>Hidden {i + 1}</th><td>{stage >= 1 ? fmt(pass.hiddenSums[i]) : '—'}</td><td>{stage >= 1 ? fmt(value) : '—'}</td></tr>)}</tbody></table></section>
      <section><h2>Output layer</h2><p>Softmax converts the output scores into proportions that sum to 1. These outputs have no trained class meaning.</p>
      <table><thead><tr><th>Neuron</th><th>Score</th><th>Softmax</th></tr></thead><tbody>{pass.outputs.map((value, i) => <tr key={i}><th>Output {i + 1}</th><td>{stage >= 2 ? fmt(pass.logits[i]) : '—'}</td><td>{stage >= 2 ? `${(value * 100).toFixed(1)}%` : '—'}</td></tr>)}</tbody></table></section></div>
  </section>;
}
