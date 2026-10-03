import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatSubmissionQueue } from '../../src/chatSubmissionQueue';
import { pinMessage } from '../../src/api';
import { reducer } from '../../src/useStore';
import { learningCourses, normalizeLearningProgress, readLearningProgress } from '../../src/learningCourses';
import LearningUniversity from '../../src/components/LearningUniversity';
import NeuralNetworkVisualizer from '../../src/components/NeuralNetworkVisualizer';
import BreakRoom from '../../src/components/BreakRoom';
import AppUpdateCheck from '../../src/components/AppUpdateCheck';
import { forwardPass, freshNetwork, activate, networkConnections, setConnectionWeight } from '../../src/neuralNetwork';
import { shuffledCards, readMatchBest } from '../../src/memoryMatch';

afterEach(() => vi.unstubAllGlobals());

it('steering follows the saved partial reply before waiting prompts, retaining their order and models', async () => {
  const queue = new ChatSubmissionQueue(), order = [];
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  queue.enqueue({ id: 'original', session_id: 'a', pane_id: 'primary', run: async () => { order.push('responding'); await gate; order.push('partial saved'); } });
  queue.enqueue({ id: 'waiting-a', session_id: 'a', model: 'alpha', run: async () => { order.push('waiting-a'); } });
  queue.enqueue({ id: 'waiting-b', session_id: 'b', pane_id: 'secondary', model: 'beta', run: async () => { order.push('waiting-b'); } });
  expect(queue.enqueue({ id: 'steer', session_id: 'a', afterId: 'original', run: async () => { order.push('steer'); } })).toBe(true);
  expect(queue.getSnapshot().map(job => job.id)).toEqual(['original', 'steer', 'waiting-a', 'waiting-b']);
  expect(queue.getSnapshot().at(-1).model).toBe('beta');
  finish(); await vi.waitFor(() => expect(queue.getSnapshot()).toEqual([]));
  expect(order).toEqual(['responding', 'partial saved', 'steer', 'waiting-a', 'waiting-b']);
});

it('refuses steering a completed job or a different chat pane', async () => {
  const queue = new ChatSubmissionQueue(); let finish;
  queue.enqueue({ id: 'active', session_id: 'a', run: () => new Promise(resolve => { finish = resolve; }) });
  expect(queue.enqueue({ id: 'wrong', session_id: 'b', afterId: 'active', run: vi.fn() })).toBe(false);
  expect(queue.enqueue({ id: 'wrong-pane', session_id: 'a', pane_id: 'secondary', afterId: 'active', run: vi.fn() })).toBe(false);
  finish(); await vi.waitFor(() => expect(queue.getSnapshot()).toEqual([]));
  expect(queue.enqueue({ id: 'late', session_id: 'a', afterId: 'active', run: vi.fn() })).toBe(false);
});

it('updates only the pinned message and does not certify a newer unrelated history', async () => {
  const state = { currentSessionId: 'a', sessionRevision: 'r2', conversationHistory: [{ id: 'm', content: 'kept' }, { id: 'n', content: 'new' }], memorySummary: 'kept summary' };
  const saved = { id: 'a', message_id: 'm', pinned: true, previous_revision: 'r1', revision: 'r-pin' };
  const next = reducer(state, { type: 'MESSAGE_PIN_SAVED', payload: saved });
  expect(next.sessionRevision).toBe('r2'); expect(next.memorySummary).toBe('kept summary');
  expect(next.conversationHistory).toEqual([{ id: 'm', content: 'kept', pinned: true }, { id: 'n', content: 'new' }]);
  expect(reducer(state, { type: 'MESSAGE_PIN_SAVED', payload: { ...saved, id: 'b' } })).toBe(state);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => saved })));
  expect(await pinMessage('a', 'm', true)).toEqual(saved);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ pinned: true });
});

it('keeps course notes and progress scoped, bounded and usable without storage', () => {
  const progress = normalizeLearningProgress('university', { 'tokens-context': { passed: true, notes: 'x'.repeat(13000) }, 'agent-loop': { passed: true }, extra: 'ignore' });
  expect(progress['tokens-context'].notes).toHaveLength(12000); expect(progress['tokens-context'].passed).toBe(true);
  expect(progress).not.toHaveProperty('agent-loop'); expect(progress).not.toHaveProperty('extra');
  vi.stubGlobal('localStorage', { getItem: () => { throw Error('blocked'); } });
  expect(readLearningProgress('agent-university')['agent-loop']).toEqual({ passed: false, notes: '' });
  for (const course of ['university', 'agent-university']) {
    expect(new Set(learningCourses[course].lessons.map(lesson => lesson.id)).size).toBe(learningCourses[course].lessons.length);
    const html = renderToStaticMarkup(<LearningUniversity course={course} />);
    expect(html).toContain('Copy practice prompt'); expect(html).toContain('Export notes');
  }
});

it('computes known forward passes and stable softmax proportions', () => {
  expect(activate(-1.25, 'relu')).toBe(0); expect(activate(0, 'sigmoid')).toBe(.5);
  const network = { hiddenWeights: [[.5, -1]], hiddenBiases: [.25], outputWeights: [[1], [-1]], outputBiases: [0, 0] };
  const pass = forwardPass(network, [1, 2], 'relu');
  expect(pass.hiddenSums).toEqual([-1.25]); expect(pass.hidden).toEqual([0]); expect(pass.outputs).toEqual([.5, .5]);
  const demo = freshNetwork(), changed = setConnectionWeight(demo, networkConnections[0], -3);
  expect(demo.hiddenWeights[0][0]).toBe(.8); expect(changed.hiddenWeights[0][0]).toBe(-3);
  for (const activation of ['tanh', 'relu', 'sigmoid']) {
    const value = forwardPass(changed, [2, -2], activation);
    expect(value.outputs.every(v => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
    expect(value.outputs.reduce((a, b) => a + b)).toBeCloseTo(1, 12);
  }
  expect(renderToStaticMarkup(<NeuralNetworkVisualizer />)).toContain('no trained class meaning');
});

it('creates exactly eight card pairs and handles an unavailable best-score store', () => {
  const cards = shuffledCards(() => .5);
  expect(cards).toHaveLength(16); expect(new Set(cards.map(card => card.id)).size).toBe(16);
  for (let pair = 0; pair < 8; pair++) expect(cards.filter(card => card.pair === pair)).toHaveLength(2);
  expect(readMatchBest({ getItem: () => '2' })).toBeNull();
  expect(readMatchBest({ getItem: () => '8' })).toBe(8);
  vi.stubGlobal('localStorage', { getItem: () => null });
  expect(renderToStaticMarkup(<BreakRoom active={false} />)).toContain('Memory cards');
  expect(renderToStaticMarkup(<AppUpdateCheck />)).toContain('Check for Updates');
});
