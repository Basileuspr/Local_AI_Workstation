import React from 'react';
import { createRoot } from 'react-dom/client';
import CodingCoordinator from '../../src/components/CodingCoordinator';
import '../../src/styles.css';

let run = null;
const id = 'a'.repeat(32);
window.codingCalls = [];
window.workstationDesktop = {
  chooseCodingProject: async () => ({ id: 'fixture-project', root: 'C:\\Projects\\Arithmetic' }),
  codingControl: async value => {
    window.codingCalls.push(value);
    if (value.action === 'start') run = { id, root: 'C:\\Projects\\Arithmetic', model: value.model, goal: value.goal,
      status: 'completed', phase: 'Verified the addition change and its tests.', rounds: 4, updated_at: Date.now() / 1000,
      plan: ['Inspect arithmetic and its tests', 'Fix addition without changing the public interface', 'Run configured checks and review the final diff'],
      changes: [{ path: 'arithmetic.py', diff: '--- a/arithmetic.py\n+++ b/arithmetic.py\n@@ -1,2 +1,2 @@\n def add(a, b):\n-    return a - b\n+    return a + b\n' }],
      check_results: [{ name: 'Check 1', revision: 1, passed: true, output: '3 arithmetic checks passed\n', exit_code: 0 }],
      review: { approved: true, summary: 'The one-line correction meets the request; all three configured examples pass.' },
      summary: 'Corrected addition while preserving the existing user notes.', protected_files: ['user-notes.txt'], events: [{ text: 'Read project instructions' }, { text: 'Applied arithmetic.py patch' }, { text: 'Ran Check 1' }], error: '' };
    return run;
  },
};
window.fetch = async input => {
  const path = new URL(typeof input === 'string' ? input : input.url).pathname;
  let value;
  if (path === '/coding/models') value = { models: [{ name: 'gpt-oss:20b', tools: true }, { name: 'qwen3.5:9b', tools: true }, { name: 'legacy', tools: false }] };
  else if (path === '/coding/runs') value = { active: null, runs: run ? [run] : [] };
  else if (path === '/coding/runs/' + id) value = run;
  else throw Error('Unexpected request: ' + path);
  return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
createRoot(document.getElementById('root')).render(<div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}><CodingCoordinator/></div>);
