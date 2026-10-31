import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import TestingLab, { EvaluationChart } from '../../src/components/TestingLab';
import { evaluationRequest, parseSuite, responsePrompt, runCSV, trendSeries } from '../../src/evaluations';
import { appTabs, resolveActiveTab } from '../../src/navigation';
import { filterNavigationSections, normalizeNavigationOrder, orderedSections } from '../../src/navigationOrder';
import { workspaceHelp } from '../../src/workspaceHelp';
import { queueDestination } from '../../src/queueNavigation';

afterEach(() => vi.unstubAllGlobals());
const run = (id, score, extra = {}) => ({ id, suite_hash: 'suite-v1', cohort: 'settings-1', created_at: `2026-10-${id}T12:00:00Z`, status: 'completed',
  groups: [{ kind: 'ollama', model: 'local:version', automated_score: score, completed: 10, total: 10 },
    { kind: 'manual', model: 'online-version', automated_score: null, inference_seconds: null, completed: 0, total: 10 }], ...extra });

describe('Testing Lab history and scoring presentation', () => {
  it('compares the same settings only, preserves zero scores and omits unavailable measurements', () => {
    const runs = [run('30', 80), run('29', 0), run('28', 100, { cohort: 'other-settings' }), run('27', 100, { status: 'interrupted' })];
    const result = trendSeries(runs, 'settings-1', 'automated_score');
    expect(result).toHaveLength(1);
    expect(result[0].points.map(p => p.value)).toEqual([0, 80]);
    expect(trendSeries(runs, 'settings-1', 'inference_seconds')).toEqual([]);
    expect(trendSeries(runs, 'settings-1', 'automated_score', 1, Date.parse('2026-10-30T13:00:00Z'))[0].points.map(p => p.value)).toEqual([80]);
    expect(trendSeries([run('30', 80, { status: 'running' })], 'settings-1', 'automated_score')).toEqual([]);
  });
  it('shows chart points as keyboard-accessible links to the underlying evidence', () => {
    const series = trendSeries([run('30', 70)], 'settings-1', 'automated_score');
    const { document } = parseHTML(renderToStaticMarkup(<EvaluationChart series={series} metric="automated_score" onOpen={() => {}} />));
    expect(document.querySelector('svg').getAttribute('aria-label')).toContain('Automated checks');
    expect(document.querySelector('circle').getAttribute('tabindex')).toBe('0');
    expect(document.querySelector('circle title').textContent).toContain('10 responses');
    expect(document.querySelector('polyline').getAttribute('points')).not.toContain('NaN');
    expect(renderToStaticMarkup(<EvaluationChart series={[]} metric="factual_accuracy" />)).toContain('No measurements');
  });
  it('provides full prompts without revealing references and protects spreadsheet exports from formulas', () => {
    const sample = { id: 'run', suite_hash: 'hash', cohort: 'settings', created_at: 'date', system: 'System request', request: { targets: [{ kind: 'manual', model: 'online' }] },
      suite: { cases: [{ id: 'case', name: 'Data', category: 'data', messages: [{ role: 'user', content: 'Question' }], reference: 'Never copy to baseline' }] },
      results: [{ id: 'result', case_id: 'case', target_index: 0, repeat: 1, status: 'completed', response: '=HYPERLINK("bad")', conditions: '+formula', review: { notes: '@danger' }, evaluation: { score: 0 } }] };
    expect(JSON.parse(responsePrompt(sample, sample.results[0]))).toEqual({ system: 'System request', messages: [{ role: 'user', content: 'Question' }] });
    const csv = runCSV(sample);
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv).toContain('"\'+formula"');
    expect(csv).toContain('"\'@danger"');
    expect(csv).toContain('"0"');
    expect(csv).not.toContain('Never copy to baseline');
  });
  it('validates suite drafts before sending them and surfaces structured server errors', async () => {
    expect(parseSuite('{"name":"Mine","cases":[{"id":"c"}]}').name).toBe('Mine');
    for (const text of ['[]', '{}', '{bad', 'x'.repeat(500001)]) expect(() => parseSuite(text)).toThrow();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ detail: [{ loc: ['body', 'cases', 0], msg: 'Invalid reference' }] }) }));
    await expect(evaluationRequest('/suites', { name: 'bad' })).rejects.toThrow('cases.0: Invalid reference');
    expect(fetch.mock.calls[0][1].cache).toBe('no-store');
  });
  it('integrates with navigation, shared help, the queue and responsive workspace controls', () => {
    expect(appTabs).toContain('testing-lab');
    expect(resolveActiveTab('testing-lab')).toBe('testing-lab');
    expect(queueDestination({ kind: 'evaluation' })).toEqual({ tab: 'testing-lab' });
    expect(filterNavigationSections(orderedSections(normalizeNavigationOrder()), 'factual accuracy').flatMap(s => s.items.map(i => i.id))).toContain('testing-lab');
    expect(workspaceHelp['testing-lab'].sections.length).toBeGreaterThan(0);
    expect(JSON.stringify(workspaceHelp['testing-lab'])).toContain('without normal chat memory');
    const { document } = parseHTML(renderToStaticMarkup(<TestingLab active={false} />));
    expect(document.querySelector('#testing-lab-heading').textContent).toBe('Testing Lab');
    expect(document.body?.textContent || document.toString()).not.toContain('API key');
    const start = [...document.querySelectorAll('button')].find(b => b.textContent === 'Start comparison');
    expect(start.hasAttribute('disabled')).toBe(true);
  });
});
