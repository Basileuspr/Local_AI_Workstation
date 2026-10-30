import React from 'react';
import { createRoot } from 'react-dom/client';
import Coordinator from '../../src/components/Coordinator';
import '../../src/styles.css';

window.coordinatorCalls = [];
const runs = {};
const coding = { id: 'c'.repeat(32), harness_id: 'coding', goal: 'Fix arithmetic', model: 'fixture-model', status: 'completed', phase: 'Verified', rounds: 2, changes: [], plan: ['Inspect'], check_results: [], protected_files: [], events: [], summary: 'Done' };
window.fetch = async (url, options = {}) => {
  const path = new URL(url).pathname, body = options.body ? JSON.parse(options.body) : null;
  window.coordinatorCalls.push({ path, body });
  let result;
  if (path === '/models') result = { models: [{ name: 'fixture-model' }] };
  else if (path === '/coding/models') result = { models: [{ name: 'fixture-model', tools: true }] };
  else if (path === '/coding/runs') result = { runs: [coding], active: null };
  else if (path === `/coding/runs/${coding.id}`) result = coding;
  else if (path === '/coordinator/runs' && !body) result = { runs: [coding, ...Object.values(runs)] };
  else if (path === '/coordinator/runs') {
    const id = body.harness_id === 'research' ? 'a'.repeat(32) : 'b'.repeat(32);
    const run = { id, harness_id: body.harness_id, harness_version: 1, goal: body.goal, model: body.model, status: 'needs_review', phase: 'Ready for review', plan: ['Inspect inputs', 'Review evidence'], inputs: body, receipts: [], events: ['Checked results'], transfer: null };
    run.result = body.harness_id === 'research' ? { answer: [{ text: 'Captured source supports this answer.', citations: ['S1'] }], sources: [{ id: 'S1', url: 'https://example.org/evidence', title: 'Captured source', retrieved_at: 1793400000 }], failures: [] }
      : { summary: 'Organize these reference images.', coverage: 'Metadata only.', proposals: [{ media_id: 'library:item', tags: ['reference'], category: 'Reference', reason: 'Existing descriptive metadata' }], duplicate_groups: [] };
    runs[id] = run; result = run;
  } else if (path === '/visual-review/workflow/list') result = { total: 1, items: [{ media_id: 'library:item', name: 'reference.png', file_state: 'present', category: '' }] };
  else if (path === '/visual-review/workflow/presets') result = [{ id: '0', name: 'References', path: 'C:\\Fixture\\References' }];
  else if (path.startsWith('/coordinator/runs/')) {
    const [, , , id, action] = path.split('/'); result = runs[id];
    if (action === 'knowledge') result.receipts.push({ action: 'knowledge', source_ref: body.source_ref, result: { doc_id: 'saved' } });
    if (action === 'metadata') result.receipts.push({ action: 'metadata', media_id: body.media_ids[0], result: { tags: ['reference'] } });
    if (action === 'transfer-plan') result.transfer = { id: 'd'.repeat(32), status: 'ready', mode: body.mode, entries: [{ media_id: 'library:item', source: 'C:\\Fixture\\reference.png', target: 'C:\\Fixture\\References\\reference.png' }] };
    if (action === 'transfer') { result.transfer.status = 'complete'; result.receipts.push({ action: 'transfer', result: { status: 'complete' } }); }
  }
  if (!result) throw Error(`Unexpected fixture request: ${path}`);
  return { ok: true, json: async () => structuredClone(result) };
};
createRoot(document.getElementById('root')).render(<Coordinator active onNavigate={tab => { window.lastNavigation = tab; }}/>);
