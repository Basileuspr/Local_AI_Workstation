import { apiUrl } from './api';

export async function evaluationRequest(path = '', body, method = 'POST', signal) {
  const response = await fetch(apiUrl(`/evaluations${path}`), {
    method: body === undefined ? 'GET' : method, cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal || AbortSignal.timeout(30000),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value.detail === 'string' ? value.detail :
    Array.isArray(value.detail) ? value.detail.map(item => `${item.loc?.slice(1).join('.')}: ${item.msg}`).join('; ') : 'Testing Lab request failed.');
  return value;
}

export const evaluationCategories = { instructions: 'Following instructions', coding: 'Coding help', data: 'Data calculations', facts: 'Document / information accuracy', updates: 'Using revised information', live_freshness: 'Dated live-source evidence' };
export const evaluationMetrics = { automated_score: 'Automated checks (%)', request_accuracy: 'Reviewed request accuracy (%)', factual_accuracy: 'Reviewed factual accuracy (%)', freshness: 'Reviewed freshness (%)', inference_seconds: 'Local response time (s)', tokens_per_second: 'Local generation (tokens/s)' };
export const formatMetric = value => value == null ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
export const suiteDraft = suite => ({ name: suite.name, description: suite.description, cases: suite.cases });
export function parseSuite(text) {
  if (text.length > 500000) throw new Error('Suite JSON must be under 500 KB.');
  const value = JSON.parse(text);
  if (!value || Array.isArray(value) || typeof value.name !== 'string' || !Array.isArray(value.cases) || !value.cases.length) throw new Error('Provide a suite name and at least one test case.');
  return value;
}
export function trendSeries(runs, cohort, metric, days = 0, currentTime = Date.now()) {
  const series = new Map();
  for (const run of [...runs].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (run.cohort !== cohort || (days && currentTime - Date.parse(run.created_at) > days * 86400000)) continue;
    if (!['completed', 'completed_with_errors', 'awaiting_response'].includes(run.status)) continue;
    for (const group of run.groups) {
      if (group[metric] == null) continue;
      const key = `${group.kind}: ${group.model}`;
      if (!series.has(key)) series.set(key, []);
      series.get(key).push({ runId: run.id, time: Date.parse(run.created_at), value: group[metric], count: group.completed,
        partial: group.completed !== group.total });
    }
  }
  return [...series].map(([name, points]) => ({ name, points }));
}

export function responsePrompt(run, row) {
  const item = run.suite.cases.find(test => test.id === row.case_id);
  return JSON.stringify({ system: run.system, messages: item.messages }, null, 2);
}

export function runCSV(run) {
  const fields = ['run_id', 'suite_hash', 'cohort', 'created_at', 'model', 'kind', 'case', 'category', 'repeat', 'status', 'automated_score', 'request_accuracy_0_4', 'factual_accuracy_0_4', 'freshness_0_4', 'inference_seconds', 'tokens_per_second', 'response', 'conditions', 'review_notes', 'error'];
  const rows = run.results.map(row => {
    const target = run.request.targets[row.target_index], item = run.suite.cases.find(test => test.id === row.case_id);
    return [run.id, run.suite_hash, run.cohort, run.created_at, target.model, target.kind, item.name, item.category, row.repeat, row.status,
      row.evaluation?.score, row.review?.request_accuracy, row.review?.factual_accuracy, row.review?.freshness,
      row.metrics?.inference_seconds, row.metrics?.tokens_per_second, row.response, row.conditions, row.review?.notes, row.error];
  });
  // Prevent spreadsheet formula execution when exported model/user text is opened.
  const escape = value => { let text = String(value ?? ''); if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; };
  return [fields, ...rows].map(row => row.map(escape).join(',')).join('\r\n');
}
