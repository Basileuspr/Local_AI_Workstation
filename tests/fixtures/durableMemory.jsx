import './workspaceControlsBackend';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import '../../src/styles.css';
import '../../src/components/WorkspaceControls.css';

const records = Array.from({ length: 34 }, (_, index) => ({
  id: index + 1, user_id: 1, project_id: null, session_id: null, memory_type: index % 2 ? 'preference' : 'project',
  memory_text: index === 0 ? 'Use metric units in recipes.' : `Project note ${index + 1}: Keep the reference material organized.`,
  importance: index === 0 ? 5 : 3, is_active: index !== 3, version: 1,
  created_at: '2026-01-01T12:00:00', updated_at: '2026-01-01T12:00:00',
}));
window.memoryQA = { records, writes: [], fail: false, failRead: false, downloads: [] };
const originalFetch = window.fetch;
window.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (!url.pathname.startsWith('/memory')) return originalFetch(input, options);
  const qa = window.memoryQA, method = options.method || 'GET', body = options.body ? JSON.parse(options.body) : {};
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  if (method === 'GET') return qa.failRead ? json({ detail: 'Fixture read unavailable' }, 503) : json({ memories: qa.records,
    candidate_ids: qa.records.filter(memory => memory.is_active).sort((a, b) => b.importance - a.importance || b.updated_at.localeCompare(a.updated_at) || b.id - a.id).slice(0, 10).map(memory => memory.id), count: qa.records.length });
  qa.writes.push({ method, body, path: url.pathname });
  if (qa.fail) return json({ detail: 'Fixture save unavailable; draft retained.' }, 503);
  if (method === 'POST') {
    const record = { ...body, id: Math.max(...qa.records.map(memory => memory.id), 0) + 1, version: 1, created_at: '2026-11-01T12:00:00', updated_at: '2026-11-01T12:00:00' };
    qa.records.push(record); return json({ memory: record });
  }
  const record = qa.records.find(memory => memory.id === Number(url.pathname.split('/').at(-1)));
  if (!record) return json({ detail: 'Memory no longer exists.' }, 404);
  if (record.version !== (body.version || Number(url.searchParams.get('version')))) return json({ detail: 'This memory changed elsewhere. Refresh and review it before saving again.' }, 409);
  if (method === 'PATCH') { Object.assign(record, body, { version: record.version + 1, updated_at: '2026-11-01T12:00:00' }); return json({ memory: record }); }
  qa.records = qa.records.filter(memory => memory.id !== record.id); return json({ deleted: record.id });
};
const createURL = URL.createObjectURL;
URL.createObjectURL = blob => { if (blob.type === 'application/json') blob.text().then(text => window.memoryQA.downloads.push(JSON.parse(text))); return createURL(blob); };
createRoot(document.getElementById('root')).render(<App />);
