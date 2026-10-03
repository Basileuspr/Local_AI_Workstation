import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { appTabs } from '../../src/navigation';
import { filterLearningLessons, learningCourses, learningPracticePrompt, learningStorageKey, normalizeLearningProgress, readLearningProgress } from '../../src/learningCourses';
import { cubeStl, inventoryCsv } from '../../src/learning/samples';
import LearningUniversity from '../../src/components/LearningUniversity';

afterEach(() => vi.unstubAllGlobals());

describe('app-based learning courses', () => {
  it('keeps the original stable IDs before the new curriculum', () => {
    expect(learningCourses.university.lessons.slice(0, 6).map(lesson => lesson.id)).toEqual(['clear-requests', 'tokens-context', 'data-types', 'retrieval', 'networks', 'experiments']);
    expect(learningCourses['agent-university'].lessons.slice(0, 6).map(lesson => lesson.id)).toEqual(['agent-loop', 'permission', 'tool-contracts', 'untrusted-input', 'recovery', 'evaluation']);
  });

  it('gives every lesson a valid quiz, real workspace destinations and completion evidence', () => {
    const covered = new Set();
    for (const curriculum of Object.values(learningCourses)) {
      const ids = new Set();
      for (const lesson of curriculum.lessons) {
        expect(ids.has(lesson.id), lesson.id).toBe(false); ids.add(lesson.id);
        expect(lesson.choices[lesson.answer], lesson.id).toBeTruthy();
        expect(Number.isInteger(lesson.answer), lesson.id).toBe(true);
        expect(lesson.explanation.length, lesson.id).toBeGreaterThan(30);
        expect(lesson.steps.length, lesson.id).toBeGreaterThanOrEqual(3);
        expect(lesson.checkpoint.length, lesson.id).toBeGreaterThan(35);
        expect(lesson.module.length, lesson.id).toBeGreaterThan(0);
        expect(lesson.workspaces.length, lesson.id).toBeGreaterThan(0);
        for (const tab of lesson.workspaces) { expect(appTabs, lesson.id).toContain(tab); covered.add(tab); }
      }
    }
    for (const tab of appTabs.filter(tab => !['university', 'agent-university'].includes(tab))) expect(covered.has(tab), `No practical lesson covers ${tab}`).toBe(true);
  });

  it('preserves old notes and checks while initializing added lessons without cross-course state', () => {
    const saved = { 'tokens-context': { passed: true, notes: 'Original budget notes' }, 'agent-loop': { passed: true, notes: 'Other course' } };
    const storage = { getItem: vi.fn(key => key === learningStorageKey('university') ? JSON.stringify(saved) : null) };
    const progress = readLearningProgress('university', storage);
    expect(progress['tokens-context']).toEqual({ passed: true, notes: 'Original budget notes' });
    expect(progress).not.toHaveProperty('agent-loop');
    expect(progress['csv-sqlite']).toEqual({ passed: false, notes: '' });
    expect(Object.keys(progress)).toHaveLength(learningCourses.university.lessons.length);
    const agent = normalizeLearningProgress('agent-university', { 'agent-loop': { passed: true, notes: 'Original agent notes' } });
    expect(agent['agent-loop']).toEqual({ passed: true, notes: 'Original agent notes' });
    expect(agent['app-project-capstone']).toEqual({ passed: false, notes: '' });
  });

  it('searches real workspace names and combines words with the chosen topic', () => {
    const found = filterLearningLessons('university', { query: '  SPREADSHEETS   totals ', topic: 'Sources and documents' });
    expect(found.map(lesson => lesson.id)).toEqual(['csv-sqlite']);
    expect(filterLearningLessons('university', { query: 'Spreadsheets', topic: 'Images and training' })).toEqual([]);
    expect(filterLearningLessons('agent-university', { query: 'capstone' }).map(lesson => lesson.id)).toContain('app-project-capstone');
    expect(filterLearningLessons('university')).toHaveLength(learningCourses.university.lessons.length);
    expect(filterLearningLessons('university', { query: 'nonexistent-example-74623' })).toEqual([]);
  });

  it('copies a self-contained tutor exercise without implying tool execution', () => {
    const prompt = learningPracticePrompt('agent-university', 'discover-app-tools');
    expect(prompt).toContain('Ordinary chat has no general tool-calling executor');
    expect(prompt).toContain('Workspaces: Dashboard, Functions, Chat');
    expect(prompt).toContain('Manual app practice:');
    expect(prompt).toContain('Result to check:');
    expect(prompt).toContain('wait for my attempt');
    expect(learningPracticePrompt('university', 'csv-sqlite')).toContain(inventoryCsv.text);
    expect(learningPracticePrompt('university', 'missing')).toBe('');
  });

  it('renders new navigation and practical guidance without opening a workspace', () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    const openWorkspace = vi.fn();
    const html = renderToStaticMarkup(<LearningUniversity onOpenWorkspace={openWorkspace} />);
    expect(html).toContain('Search University lessons');
    expect(html).toContain('University topic');
    expect(html).toContain('Practice in the app');
    expect(html).toContain('Check your result');
    expect(html).toContain('Open Chat for this lesson');
    expect(html).toContain('22 of 22 lessons');
    expect(openWorkspace).not.toHaveBeenCalled();
  });

  it('keeps the sample table and its quiz arithmetic consistent', () => {
    const rows = inventoryCsv.text.trim().split('\n').slice(1).map(line => line.split(','));
    const total = subset => subset.reduce((sum, row) => sum + Number(row[2]) * Number(row[3]), 0);
    expect(total(rows)).toBe(36);
    expect(total(rows.filter(row => row[1] === 'stationery'))).toBe(28);
    const lesson = learningCourses.university.lessons.find(item => item.id === 'csv-sqlite');
    expect(lesson.choices[lesson.answer]).toBe('28 credits');
  });

  it('provides a closed practice cube with outward normals and the promised dimensions', () => {
    const facets = [...cubeStl.text.matchAll(/facet normal ([^\n]+)\n\s+outer loop\n\s+vertex ([^\n]+)\n\s+vertex ([^\n]+)\n\s+vertex ([^\n]+)/g)];
    expect(facets).toHaveLength(12);
    const edges = new Map(), coordinates = [];
    for (const facet of facets) {
      const [normal, a, b, c] = facet.slice(1).map(value => value.split(' ').map(Number));
      coordinates.push(a, b, c);
      const ab = b.map((value, index) => value - a[index]), ac = c.map((value, index) => value - a[index]);
      const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      expect(cross.reduce((sum, value, index) => sum + value * normal[index], 0)).toBeGreaterThan(0);
      for (const [start, end] of [[a, b], [b, c], [c, a]]) {
        const edge = [start.join(','), end.join(',')].sort().join('|');
        edges.set(edge, (edges.get(edge) || 0) + 1);
      }
    }
    expect([...edges.values()].every(count => count === 2)).toBe(true);
    for (const axis of [0, 1, 2]) {
      expect(Math.min(...coordinates.map(vertex => vertex[axis]))).toBe(0);
      expect(Math.max(...coordinates.map(vertex => vertex[axis]))).toBe(20);
    }
  });
});
