import { apiUrl } from './api';

export const memoryCategories = ['general', 'preference', 'project', 'constraint', 'personal'];
export const memoryDraft = memory => ({
  memory_text: memory?.memory_text || '', memory_type: memory?.memory_type || 'general',
  importance: memory?.importance ?? 3, is_active: memory?.is_active !== false,
});
export function filterMemories(memories, { query = '', category = '', status = 'all', sort = 'priority' } = {}) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return memories.filter(memory => (!category || memory.memory_type === category)
    && (status === 'all' || (status === 'active') === memory.is_active)
    && terms.every(term => `${memory.memory_text} ${memory.memory_type} ${memory.project_name || ''}`.toLocaleLowerCase().includes(term)))
    .sort((a, b) => (sort === 'priority' ? b.importance - a.importance : 0)
      || (sort === 'oldest' ? a.updated_at.localeCompare(b.updated_at) : b.updated_at.localeCompare(a.updated_at)) || b.id - a.id);
}
export async function memoryRequest(path = '', { method = 'GET', body, signal } = {}) {
  const response = await fetch(apiUrl(`/memory${path}${path.includes('?') ? '&' : '?'}username=local-user`), {
    method, signal, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Could not update the memory library. Check the fields and try again.');
  if (method === 'GET' && (!Array.isArray(result.memories) || !Array.isArray(result.candidate_ids)
    || result.memories.some(memory => typeof memory.is_active !== 'boolean' || !Number.isInteger(memory.version)))) {
    throw new Error('Fully quit and reopen the desktop app to load the updated memory controls.');
  }
  return result;
}
export function memoryDate(value) {
  if (!value) return 'Unknown';
  // SQLite stores UTC without an offset; show that instant in the local timezone.
  const parsed = new Date(/(?:[zZ]|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(parsed.getTime()) ? 'Unknown' : parsed.toLocaleString();
}
