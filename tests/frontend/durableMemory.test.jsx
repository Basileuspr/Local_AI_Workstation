import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DurableMemory from '../../src/components/DurableMemory';
import { filterMemories, memoryDate, memoryRequest } from '../../src/durableMemory';
import { featureDirectory, filterFeatures } from '../../src/featureUseCases';
import { appTabs } from '../../src/navigation';

afterEach(() => vi.unstubAllGlobals());
const entries = [
  { id: 1, memory_text: 'Use grams in recipes', memory_type: 'preference', importance: 5, is_active: true, updated_at: '2026-01-01' },
  { id: 2, memory_text: 'Retired deadline', memory_type: 'project', project_name: 'Recipes', importance: 3, is_active: false, updated_at: '2026-03-01' },
  { id: 3, memory_text: 'New style', memory_type: 'preference', importance: 5, is_active: true, updated_at: '2026-02-01' },
];
describe('durable memory library', () => {
  it('combines filters and preserves the original library while sorting', () => {
    expect(filterMemories(entries).map(m => m.id)).toEqual([3, 1, 2]);
    expect(filterMemories(entries, { query: 'recipe', status: 'paused' }).map(m => m.id)).toEqual([2]);
    expect(filterMemories(entries, { query: 'grams preference', category: 'preference', status: 'active' }).map(m => m.id)).toEqual([1]);
    expect(filterMemories(entries, { sort: 'oldest' }).map(m => m.id)).toEqual([1, 3, 2]);
    expect(entries.map(m => m.id)).toEqual([1, 2, 3]);
  });
  it('is discoverable with management and context guidance', () => {
    expect(appTabs).toContain('memory');
    expect(featureDirectory.find(item => item.id === 'memory').useCases).toHaveLength(2);
    expect(filterFeatures('pause memories').map(item => item.id)).toContain('memory');
    const html = renderToStaticMarkup(<DurableMemory active={false} />);
    for (const text of ['Durable Memory', 'Search memories', 'Category', 'Status', 'Sort', 'Add memory', 'context budget']) expect(html).toContain(text);
  });
  it('preserves edit versions and gives usable API errors', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ detail: 'Changed elsewhere' }) });
    vi.stubGlobal('fetch', fetch);
    await expect(memoryRequest('/2', { method: 'PATCH', body: { version: 1, is_active: false } })).rejects.toThrow('Changed elsewhere');
    expect(fetch.mock.calls[0][0]).toContain('/memory/2?username=local-user');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ version: 1, is_active: false });
    fetch.mockResolvedValue({ ok: false, json: async () => ({ detail: [{ msg: 'Invalid' }] }) });
    await expect(memoryRequest()).rejects.toThrow('Check the fields');
  });
  it('interprets SQLite dates as UTC and tolerates missing dates', () => {
    expect(memoryDate('2026-01-01T12:00:00')).toBe(new Date('2026-01-01T12:00:00Z').toLocaleString());
    expect(memoryDate(null)).toBe('Unknown');
  });
  it('asks for a restart instead of mislabeling entries from an older backend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ memories: entries, count: 3 }) }));
    await expect(memoryRequest()).rejects.toThrow('Fully quit and reopen');
  });
});
