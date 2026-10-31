// Synthetic UI fixture only. These scores are not real model measurements.
import React from 'react';
import { createRoot } from 'react-dom/client';
import TestingLab from '../../src/components/TestingLab';
import '../../src/styles.css';

const suite = { id: 'a'.repeat(32), hash: 'f'.repeat(64), created_at: new Date().toISOString(), name: 'Workstation essentials · UI fixture', description: 'Synthetic fixtures for interface verification; no real model quality claim.', cases: [
  { id: 'updated-data', name: 'Recalculate corrected data', category: 'updates', messages: [{ role: 'user', content: 'Synthetic A=10, B=5, C=15.' }, { role: 'assistant', content: 'The total is 30.' }, { role: 'user', content: 'Replace B with 20. Return only JSON with total.' }], checks: [{ kind: 'json_equals', value: '{"total":45}' }], reference: '{"total":45}', rubric: 'Use the replacement value, producing 45; do not add old and new B.', source: 'Synthetic supplied fixture' },
  { id: 'missing-data', name: 'Recognize missing information', category: 'facts', messages: [{ role: 'user', content: 'Revenue is 100 credits. Expenses are absent. Return only JSON with profit:null.' }], checks: [{ kind: 'json_equals', value: '{"profit":null}' }], reference: '{"profit":null}', rubric: 'Do not invent missing expenses or profit.', source: 'Synthetic supplied fixture' },
] };
const clone = value => JSON.parse(JSON.stringify(value));
function makeRun(id, request, daysAgo = 0, completeOnline = false) {
  const selected = state?.suites.find(s => s.id === request.suite_id) || suite;
  return { id, suite_id: selected.id, suite_name: selected.name, suite_hash: selected.hash, cohort: 'c'.repeat(64), system: 'Use supplied evidence and state uncertainty.', created_at: new Date(Date.now() - daysAgo * 86400000).toISOString(), status: completeOnline || request.targets.every(t => t.kind === 'ollama') ? 'completed' : 'awaiting_response', request, suite: clone(selected), environment: { build: { build_id: 'synthetic-ui-fixture' } }, results: request.targets.flatMap((target, index) => selected.cases.map((item, i) => ({ id: `${id}-${index}-${i}`, target_index: index, case_id: item.id, repeat: 1, status: target.kind === 'manual' && !completeOnline ? 'awaiting_response' : 'completed', ...(target.kind === 'manual' && !completeOnline ? {} : { response: item.checks[0]?.value || 'Fixture answer', evaluation: { score: 100, checks: item.checks.map(c => ({ ...c, passed: true })) }, metrics: target.kind === 'ollama' ? { inference_seconds: 1.5 + daysAgo * .1, queue_seconds: .1, prepare_seconds: .3, tokens_per_second: 30 } : {}, review: { request_accuracy: 4, factual_accuracy: 4, freshness: 4, notes: 'Fixture review', reviewed_at: new Date().toISOString() } }) }))) };
}
function summary(run) {
  return { ...Object.fromEntries(['id', 'suite_id', 'suite_name', 'suite_hash', 'cohort', 'created_at', 'status'].map(key => [key, run[key]])), total: run.results.length, completed: run.results.filter(r => r.status === 'completed').length, groups: run.request.targets.map((target, index) => {
    const rows = run.results.filter(r => r.target_index === index), done = rows.filter(r => r.status === 'completed'), reviewed = done.filter(r => r.review);
    const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    return { ...target, target_index: index, total: rows.length, completed: done.length, failed: 0, automated_score: mean(done.map(r => r.evaluation.score)), automated_count: done.length, review_count: reviewed.length, request_accuracy: mean(reviewed.map(r => r.review.request_accuracy * 25)), factual_accuracy: mean(reviewed.map(r => r.review.factual_accuracy * 25)), freshness: mean(reviewed.filter(r => r.review.freshness != null).map(r => r.review.freshness * 25)), inference_seconds: mean(done.map(r => r.metrics.inference_seconds).filter(n => n != null)), tokens_per_second: mean(done.map(r => r.metrics.tokens_per_second).filter(n => n != null)) };
  }) };
}
let state;
try { state = JSON.parse(localStorage.getItem('law-testing-lab-fixture')); } catch { /* Start a new fixture. */ }
if (!state) {
  state = { suites: [suite], runs: [], schedules: [] };
  const request = { suite_id: suite.id, targets: [{ kind: 'ollama', model: 'fixture-local:1' }, { kind: 'manual', model: 'Online fixture v1' }], context_tokens: 4096, output_tokens: 1024, repeats: 1, seed: 42, temperature: 0, timeout_seconds: 300 };
  state.runs = [0, 1, 2, 3].map((day, index) => makeRun(String(index).repeat(32), request, day, true));
}
window.testingLabQA = { state, calls: [], errors: [] };
window.addEventListener('error', event => window.testingLabQA.errors.push(event.message));
window.addEventListener('unhandledrejection', event => window.testingLabQA.errors.push(String(event.reason)));
window.fetch = async (input, init = {}) => {
  const url = new URL(input, location.href), path = url.pathname, body = init.body ? JSON.parse(init.body) : null;
  window.testingLabQA.calls.push({ path, method: init.method || 'GET' });
  let result, status = 200;
  if (path === '/models') result = { models: [{ name: 'fixture-local:1' }] };
  else if (path === '/evaluations') result = { suites: state.suites, runs: state.runs.map(summary), schedules: state.schedules, history_limit: 500 };
  else if (path === '/evaluations/runs' && body) { result = makeRun('d'.repeat(32), body); state.runs.unshift(result); }
  else if (path === '/evaluations/suites') { result = { ...body, id: 'e'.repeat(32), hash: 'b'.repeat(64), created_at: new Date().toISOString() }; state.suites.push(result); }
  else if (path === '/evaluations/schedules') { result = { ...body, id: 'schedule', enabled: true, runs_started: 0, suite_name: suite.name, next_due: new Date().toISOString() }; state.schedules.push(result); }
  else if (path === '/evaluations/schedules/schedule/disable') { result = state.schedules[0]; result.enabled = false; }
  else if (path.startsWith('/evaluations/runs/')) {
    const parts = path.split('/'); result = state.runs.find(run => run.id === parts[3]);
    if (parts[4] === 'responses') { const row = result.results.find(r => r.id === parts[5]); Object.assign(row, body, { status: 'completed', evaluation: { score: 100, checks: [] }, metrics: {} }); }
    if (parts[4] === 'reviews') { const row = result.results.find(r => r.id === parts[5]); row.review = { ...body, reviewed_at: new Date().toISOString() }; }
  } else { status = 404; result = { detail: `Unexpected fixture path ${path}` }; }
  localStorage.setItem('law-testing-lab-fixture', JSON.stringify(state));
  return new Response(JSON.stringify(clone(result)), { status, headers: { 'Content-Type': 'application/json' } });
};
createRoot(document.getElementById('root')).render(<TestingLab />);
