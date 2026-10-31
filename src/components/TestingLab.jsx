import { useEffect, useMemo, useState } from 'react';
import { evaluationCategories, evaluationMetrics, evaluationRequest, formatMetric, parseSuite, responsePrompt, runCSV, suiteDraft, trendSeries } from '../evaluations';
import { loadModels } from '../api';
import { downloadBlob } from '../downloadBlob';
import './TestingLab.css';

const palette = ['#75bfff', '#e7a8ff', '#71d6b1', '#ffbf77'];
const date = value => value ? new Date(value).toLocaleString() : '—';
const exportFile = (value, name, type = 'application/json') => downloadBlob(new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type }), name);

export function EvaluationChart({ series, metric, onOpen }) {
  const points = series.flatMap(item => item.points);
  if (!points.length) return <div className="tl-empty">No measurements for these filters yet. Run the suite, then review answers to populate human scores.</div>;
  const minTime = Math.min(...points.map(p => p.time)), maxTime = Math.max(...points.map(p => p.time));
  const maxValue = metric.endsWith('accuracy') || ['automated_score', 'freshness'].includes(metric) ? 100 : Math.max(1, ...points.map(p => p.value)) * 1.1;
  const x = value => maxTime === minTime ? 380 : 52 + (value - minTime) / (maxTime - minTime) * 670;
  const y = value => 210 - value / maxValue * 180;
  return <><svg className="tl-chart" viewBox="0 0 760 255" role="img" aria-label={`${evaluationMetrics[metric]} over time`}>
    {[0, .25, .5, .75, 1].map(f => <g key={f}><line x1="52" x2="722" y1={y(maxValue * f)} y2={y(maxValue * f)} /><text x="44" y={y(maxValue * f) + 4} textAnchor="end">{formatMetric(maxValue * f)}</text></g>)}
    <text x="52" y="242">{new Date(minTime).toLocaleDateString()}</text><text x="722" y="242" textAnchor="end">{new Date(maxTime).toLocaleDateString()}</text>
    {series.map((item, index) => <g key={item.name} style={{ color: palette[index % palette.length] }}>
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={item.points.map(p => `${x(p.time)},${y(p.value)}`).join(' ')} />
      {item.points.map(p => <circle key={p.runId} cx={x(p.time)} cy={y(p.value)} r="5" fill="currentColor" tabIndex="0" role="button" aria-label={`Open ${item.name} run, ${date(p.time)}, ${formatMetric(p.value)}`}
        onClick={() => onOpen(p.runId)} onKeyDown={e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); onOpen(p.runId); } }}><title>{`${item.name}: ${formatMetric(p.value)} · ${date(p.time)} · ${p.count} responses${p.partial ? ' · partial run' : ''}`}</title></circle>)}
    </g>)}
  </svg><div className="tl-legend">{series.map((item, index) => <span key={item.name}><i style={{ background: palette[index % palette.length] }} />{item.name}</span>)}</div></>;
}

function ReviewResponse({ run, row, perform }) {
  const item = run.suite.cases.find(test => test.id === row.case_id);
  const [answer, setAnswer] = useState(''), [conditions, setConditions] = useState('');
  const [scores, setScores] = useState({ request_accuracy: row.review?.request_accuracy ?? '', factual_accuracy: row.review?.factual_accuracy ?? '', freshness: row.review?.freshness ?? '', notes: row.review?.notes || '' });
  const [copied, setCopied] = useState('');
  async function copy() { try { await navigator.clipboard.writeText(responsePrompt(run, row)); setCopied('Prompt copied'); } catch { setCopied('Select and copy the prompt below.'); } }
  return <div className="tl-response">
    <div className="tl-row"><h3>{item.name} · repetition {row.repeat}</h3><span className="tl-tag">{row.status.replaceAll('_', ' ')}</span></div>
    <p>{evaluationCategories[item.category]}</p>
    <details><summary>Exact prompt for this response</summary><button onClick={copy}>Copy prompt</button> <span role="status">{copied}</span><pre>{responsePrompt(run, row)}</pre></details>
    <details><summary>Reference, checks &amp; review rubric</summary><p>{item.rubric}</p><pre>{item.reference || 'Human review required.'}</pre><p>Source: {item.source || 'Not supplied'}</p>
      {item.checked_at && <p>Checked {date(item.checked_at)} · Valid until {date(item.valid_until)}</p>}
      {item.checks.map((check, i) => <pre key={i}>{check.kind}: {check.value}</pre>)}
    </details>
    {row.status === 'awaiting_response' && <div className="tl-manual"><p>Use the exact prompt in a fresh online conversation. Record the exact model/version and conditions such as web access, date, and reasoning mode. These responses have no measured latency.</p>
      <label>Online response<textarea value={answer} maxLength={128000} onChange={e => setAnswer(e.target.value)} rows="8" /></label>
      <label>Comparison conditions<input value={conditions} maxLength={2000} onChange={e => setConditions(e.target.value)} placeholder="Provider, model version, date, tools off, reasoning setting…" /></label>
      <button disabled={!answer.trim() || !conditions.trim()} onClick={() => perform(async () => { await evaluationRequest(`/runs/${run.id}/responses/${row.id}`, { response: answer, conditions }); setAnswer(''); }, 'Online response recorded.')}>Record response</button>
    </div>}
    {row.error && <p role="alert">{row.error}</p>}
    {row.response && <><h4>Recorded answer</h4><pre className="tl-answer">{row.response}</pre>
      {row.conditions && <p>Manual baseline · {row.conditions}</p>}
      <div className="tl-stats"><span>Automated checks <strong>{formatMetric(row.evaluation?.score)}{row.evaluation?.score != null ? '%' : ''}</strong></span><span>Local response <strong>{formatMetric(row.metrics?.inference_seconds)} s</strong></span><span>Queue <strong>{formatMetric(row.metrics?.queue_seconds)} s</strong></span><span>Preparation <strong>{formatMetric(row.metrics?.prepare_seconds)} s</strong></span></div>
      {row.evaluation?.reference_expired && <p role="alert">The reference expired before this response was recorded. Its checks are excluded from aggregate scores.</p>}
      {row.metrics?.done_reason === 'length' && <p role="alert">The model reached its output limit. Review for an incomplete answer.</p>}
      {row.evaluation?.checks.map((check, i) => <div className="tl-check" key={i}>{check.passed ? '✓' : '✕'} {check.kind}: <code>{check.value}</code></div>)}
      <fieldset className="tl-review"><legend>Human review · 0 incorrect, 1 poor, 2 mixed, 3 mostly correct, 4 fully correct</legend>
        {[['request_accuracy', 'Request accuracy'], ['factual_accuracy', 'Factual accuracy'], ['freshness', 'Freshness (optional)']].map(([key, label]) => <label key={key}>{label}<select value={scores[key]} onChange={e => setScores(s => ({ ...s, [key]: e.target.value }))}><option value="">Unrated</option>{[0, 1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}</select></label>)}
        <label className="tl-wide">Review notes<textarea rows="3" value={scores.notes} maxLength={4000} onChange={e => setScores(s => ({ ...s, notes: e.target.value }))} /></label>
        <button disabled={scores.request_accuracy === '' || scores.factual_accuracy === ''} onClick={() => perform(() => evaluationRequest(`/runs/${run.id}/reviews/${row.id}`, { request_accuracy: Number(scores.request_accuracy), factual_accuracy: Number(scores.factual_accuracy), freshness: scores.freshness === '' ? null : Number(scores.freshness), notes: scores.notes }, 'PUT'), 'Review saved.')}>Save review</button>
        {row.review && <span>Last saved {date(row.review.reviewed_at)}</span>}
      </fieldset>
      <details><summary>Runtime evidence</summary><pre>{JSON.stringify({ metrics: row.metrics, runtime: row.runtime, provenance: row.provenance || 'local_ollama' }, null, 2)}</pre></details>
    </>}
  </div>;
}

function CustomCase({ onAdd }) {
  const [name, setName] = useState(''), [prompt, setPrompt] = useState(''), [category, setCategory] = useState('instructions');
  const [expected, setExpected] = useState(''), [kind, setKind] = useState('json_equals'), [rubric, setRubric] = useState('');
  return <details><summary>Add a test from your own use case</summary><div className="tl-form">
    <label>Test name<input value={name} maxLength={150} onChange={e => setName(e.target.value)} /></label>
    <label>Category<select value={category} onChange={e => setCategory(e.target.value)}>{Object.entries(evaluationCategories).filter(([id]) => id !== 'live_freshness').map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
    <label className="tl-wide">Request<textarea rows="4" value={prompt} maxLength={16000} onChange={e => setPrompt(e.target.value)} /></label>
    <label>Automatic check<select value={kind} onChange={e => setKind(e.target.value)}><option value="json_equals">JSON equals</option><option value="exact">Exact text</option><option value="contains">Contains text</option><option value="not_contains">Does not contain text</option><option value="none">Human review only</option></select></label>
    <label>Expected answer / check value<textarea value={expected} maxLength={8000} onChange={e => setExpected(e.target.value)} /></label>
    <label className="tl-wide">What makes a correct answer?<textarea value={rubric} maxLength={4000} onChange={e => setRubric(e.target.value)} /></label>
    <button disabled={!name.trim() || !prompt.trim() || !rubric.trim() || (kind !== 'none' && !expected)} onClick={() => { onAdd({ id: `custom-${Date.now()}`, name, category, messages: [{ role: 'user', content: prompt }], checks: kind === 'none' ? [] : [{ kind, value: expected }], rubric, reference: expected, source: 'User-supplied fixture' }); }}>Add to suite draft</button>
  </div></details>;
}

export default function TestingLab({ active = true }) {
  const [data, setData] = useState({ suites: [], runs: [], schedules: [] }), [suiteId, setSuiteId] = useState('');
  const [models, setModels] = useState([]), [model, setModel] = useState(null), [online, setOnline] = useState('');
  const [repeats, setRepeats] = useState(1), [context, setContext] = useState(4096), [output, setOutput] = useState(1024);
  const [timeout, setTimeoutSeconds] = useState(300), [hours, setHours] = useState(24), [maxRuns, setMaxRuns] = useState(30);
  const [runId, setRunId] = useState(''), [run, setRun] = useState(null), [rowId, setRowId] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  const [draft, setDraft] = useState(''), [metric, setMetric] = useState('automated_score'), [cohort, setCohort] = useState(''), [days, setDays] = useState(0);
  const suite = data.suites.find(s => s.id === suiteId) || data.suites[0];
  useEffect(() => { if (suite?.id) { setSuiteId(suite.id); setDraft(JSON.stringify(suiteDraft(suite), null, 2)); setCohort(''); } }, [suite?.id]);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    loadModels().then(value => { if (!cancelled) { setModels(value.models); setModel(current => current === null ? value.models.find(m => !m.is_embedding)?.name || '' : current); if (value.error) setError(value.error); } });
    return () => { cancelled = true; };
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(); let timer;
    async function poll() {
      try {
        const value = await evaluationRequest('', undefined, 'GET', controller.signal);
        const detail = runId ? await evaluationRequest(`/runs/${runId}`, undefined, 'GET', controller.signal) : null;
        if (!controller.signal.aborted) { setData(value); if (detail) setRun(detail); }
      } catch (failure) { if (!controller.signal.aborted) setError(failure.message); }
      finally { if (!controller.signal.aborted) timer = setTimeout(poll, 3000); }
    }
    poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [active, runId, refresh]);
  const histories = data.runs.filter(r => r.suite_hash === suite?.hash);
  const cohorts = [...new Set(histories.map(r => r.cohort))];
  const selectedCohort = cohorts.includes(cohort) ? cohort : cohorts[0] || '';
  const series = useMemo(() => trendSeries(histories, selectedCohort, metric, days), [data.runs, suite?.hash, selectedCohort, metric, days]);
  const selectedRow = run?.results.find(r => r.id === rowId) || run?.results[0];
  async function perform(action, message) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await action(); setNotice(message); setRefresh(n => n + 1); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  function request(withOnline = true) {
    const targets = [...(model ? [{ kind: 'ollama', model }] : []), ...(withOnline && online.trim() ? [{ kind: 'manual', model: online.trim() }] : [])];
    return { suite_id: suite.id, targets, repeats: Number(repeats), context_tokens: Number(context), output_tokens: Number(output), timeout_seconds: Number(timeout), temperature: 0, seed: 42 };
  }
  function openRun(id) { if (id !== runId) { setRun(null); setRowId(''); setRunId(id); } }
  async function start() { const value = await evaluationRequest('/runs', request()); setRun(value); setRowId(''); setRunId(value.id); }
  const summary = data.runs.find(r => r.id === runId);
  return <section className="testing-lab" aria-labelledby="testing-lab-heading">
    <header className="tl-heading"><div><span className="tl-eyebrow">LOCAL AI WORKSTATION · EVALUATIONS</span><h1 id="testing-lab-heading">Testing Lab</h1><p>Measure what matters to you. Keep the evidence. See what improves.</p></div><span className="tl-tag">Persistent local history</span></header>
    {error && <p className="tl-error" role="alert">{error}</p>}{notice && <p className="tl-notice" role="status">{notice}</p>}
    <div className="tl-layout"><div className="tl-panel">
      <h2>Set up a comparison</h2>
      <fieldset disabled={busy} className="tl-form">
        <label className="tl-wide">Test suite<select value={suite?.id || ''} onChange={e => setSuiteId(e.target.value)}>{data.suites.map(s => <option key={s.id} value={s.id}>{s.name} · {s.hash.slice(0, 8)}</option>)}</select></label>
        <label>Local model<select value={model || ''} onChange={e => setModel(e.target.value)}><option value="">Manual responses only</option>{models.filter(m => !m.is_embedding).map(m => <option key={m.name} value={m.name}>{m.name}</option>)}</select></label>
        <label>Online model / version (optional)<input value={online} maxLength={200} onChange={e => setOnline(e.target.value)} placeholder="Exact flagship model version" /></label>
        <label>Repetitions<input type="number" min="1" max="5" value={repeats} onChange={e => setRepeats(e.target.value)} /></label>
        <label>Context tokens<input type="number" min="2048" max="32768" step="1024" value={context} onChange={e => setContext(e.target.value)} /></label>
        <label>Output token limit<input type="number" min="128" max="4096" step="128" value={output} onChange={e => setOutput(e.target.value)} /></label>
        <label>Timeout per local response (s)<input type="number" min="30" max="1800" value={timeout} onChange={e => setTimeoutSeconds(e.target.value)} /></label>
        <button className="tl-primary" disabled={!suite || (!model && !online.trim())} onClick={() => perform(start, 'Run created. Results are saved as each response completes.')}>Start comparison</button>
      </fieldset>
      <p className="tl-muted">Local runs use temperature 0 and seed 42. Online responses are pasted, with their conditions recorded. No provider API calls are made.</p>
      <p className="tl-muted">Text-only tests use the case messages, without chat memory, Knowledge retrieval or tools. Starter update cases test revisions supplied in the prompt. Live-source freshness needs your dated, verified reference.</p>
      <details><summary>Repeat over hours, days or weeks</summary><fieldset disabled={busy} className="tl-form">
        <label>Interval (hours)<input type="number" min="1" max="720" value={hours} onChange={e => setHours(e.target.value)} /></label><label>Number of runs<input type="number" min="1" max="365" value={maxRuns} onChange={e => setMaxRuns(e.target.value)} /></label>
        <button disabled={!suite || !model} onClick={() => perform(() => evaluationRequest('/schedules', { request: request(false), interval_hours: Number(hours), max_runs: Number(maxRuns) }), 'Local schedule saved. First run starts at the next scheduler check.')}>Schedule local runs</button>
      </fieldset><p className="tl-muted">The backend must remain running and this computer awake. One evaluation runs at a time through Prompt Queue. Missed intervals produce one run on return, without a backlog. Stopping a run does not disable its schedule.</p>
      {data.schedules.map(s => <div className="tl-schedule" key={s.id}><strong>{s.suite_name}</strong><span>{s.runs_started}/{s.max_runs} · every {s.interval_hours}h · {s.enabled ? `next ${date(s.next_due)}` : 'disabled'}</span>{s.last_error && <p role="alert">{s.last_error}</p>}{s.enabled && <button disabled={busy} onClick={() => perform(() => evaluationRequest(`/schedules/${s.id}/disable`, {}), 'Schedule disabled.')}>Disable schedule</button>}</div>)}
      </details>
    </div><div className="tl-panel">
      <div className="tl-row"><h2>Your test cases</h2><span>{suite?.cases.length || 0} cases</span></div><p>{suite?.description}</p>
      <div className="tl-case-list">{suite?.cases.map(item => <details key={item.id}><summary>{item.name}<span>{evaluationCategories[item.category]}</span></summary><pre>{item.messages.map(m => `${m.role}: ${m.content}`).join('\n\n')}</pre><p>{item.rubric}</p></details>)}</div>
      <details><summary>Customize suite &amp; save a revision</summary><p>Saved revisions preserve previous runs. Edit or remove cases in the JSON draft. Dated live-source cases require reference, source, checked_at and valid_until fields; expired evidence pauses scheduled testing.</p>
        <CustomCase onAdd={item => { try { const value = parseSuite(draft); value.cases.push(item); setDraft(JSON.stringify(value, null, 2)); setNotice('Case added to the draft. Save a revision to run it.'); } catch (failure) { setError(failure.message); } }} />
        <label>Suite JSON<textarea className="tl-json" rows="14" value={draft} onChange={e => setDraft(e.target.value)} /></label>
        <div className="tl-row"><button disabled={busy || !suite} onClick={() => perform(async () => { const saved = await evaluationRequest('/suites', parseSuite(draft)); setData(d => ({ ...d, suites: [...d.suites, saved] })); setSuiteId(saved.id); }, 'Suite revision saved.')}>Save suite revision</button><button disabled={!suite} onClick={() => exportFile(suiteDraft(suite), 'testing-suite.json')}>Export suite</button></div>
      </details>
    </div></div>

    <section className="tl-panel" aria-label="Results over time"><div className="tl-row"><div><h2>Results over time</h2><p className="tl-muted">Same suite revision and local settings. Human reviews are subjective; automated checks measure only the stated assertions.</p></div><div className="tl-filters">
      <label>Measure<select value={metric} onChange={e => setMetric(e.target.value)}>{Object.entries(evaluationMetrics).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
      <label>Settings group<select value={selectedCohort} onChange={e => setCohort(e.target.value)}><option value="">No runs</option>{cohorts.map(c => <option key={c} value={c}>{c.slice(0, 12)}</option>)}</select></label>
      <label>Period<select value={days} onChange={e => setDays(Number(e.target.value))}><option value="0">All saved</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select></label>
    </div></div><EvaluationChart series={series} metric={metric} onOpen={openRun} />
    <p className="tl-muted">Charts use up to the latest 500 runs and available completed responses. Partial coverage is visible in run details. Model/version changes and online tool settings can affect comparability; inspect runtime evidence. Online response speed is unavailable.</p></section>

    <div className="tl-layout tl-history-layout"><section className="tl-panel"><h2>Saved runs</h2><p className="tl-muted">Showing all suites, newest first (up to 500). Selecting a run opens its frozen prompts, settings and answers.</p>
      {!data.runs.length && <div className="tl-empty">Your first comparison will appear here.</div>}
      <div className="tl-run-list">{data.runs.map(item => <button key={item.id} aria-pressed={runId === item.id} onClick={() => openRun(item.id)}><strong>{item.suite_name}</strong><span>{date(item.created_at)}</span><span>{item.status.replaceAll('_', ' ')} · {item.completed}/{item.total} responses</span><span>{item.groups.map(g => g.model).join(' vs ')}</span></button>)}</div>
    </section><section className="tl-panel" aria-label="Run details">
      {!run && <div className="tl-empty">{runId ? 'Loading saved run…' : 'Select a saved run to inspect answers and compare models.'}</div>}
      {run && <><div className="tl-row"><div><h2>{run.suite_name}</h2><p>{date(run.created_at)} · {run.status.replaceAll('_', ' ')}</p></div><div className="tl-actions"><button onClick={() => exportFile(run, `evaluation-${run.id}.json`)}>Export JSON</button><button onClick={() => exportFile(runCSV(run), `evaluation-${run.id}.csv`, 'text/csv;charset=utf-8')}>Export CSV</button>{['queued', 'running'].includes(run.status) && <button disabled={busy} onClick={() => perform(() => evaluationRequest(`/runs/${run.id}/stop`, {}), 'Run stopped. Completed results retained.')}>Stop run</button>}</div></div>
        {run.error && <p role="alert">{run.error}</p>}
        <div className="tl-table-wrap"><table><caption>Coverage and scores · — means unmeasured or unreviewed</caption><thead><tr><th>Model</th><th>Responses</th><th>Failed</th><th>Checks</th><th>Request</th><th>Facts</th><th>Freshness</th><th>Reviewed</th></tr></thead><tbody>{summary?.groups.map(g => <tr key={g.target_index}><th>{g.model}<small>{g.kind === 'manual' ? 'Pasted online baseline' : 'Local Ollama'}</small></th><td>{g.completed}/{g.total}</td><td>{g.failed}</td><td>{formatMetric(g.automated_score)}% <small>{g.automated_count} scored</small></td><td>{formatMetric(g.request_accuracy)}%</td><td>{formatMetric(g.factual_accuracy)}%</td><td>{formatMetric(g.freshness)}%</td><td>{g.review_count}/{g.completed}</td></tr>)}</tbody></table></div>
        <details><summary>Frozen settings &amp; build identity</summary><pre>{JSON.stringify({ request: run.request, suite_hash: run.suite_hash, settings_group: run.cohort, environment: run.environment }, null, 2)}</pre></details>
        <label>Response to inspect<select value={selectedRow?.id || ''} onChange={e => setRowId(e.target.value)}>{run.results.map(row => <option key={row.id} value={row.id}>{run.request.targets[row.target_index].model} · {run.suite.cases.find(c => c.id === row.case_id)?.name} · #{row.repeat} · {row.status}</option>)}</select></label>
        {selectedRow && <fieldset className="tl-response-fieldset" disabled={busy}><ReviewResponse key={`${run.id}:${selectedRow.id}`} run={run} row={selectedRow} perform={perform} /></fieldset>}
      </>}
    </section></div>
  </section>;
}
