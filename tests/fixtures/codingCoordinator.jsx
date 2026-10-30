import React from 'react';
import { createRoot } from 'react-dom/client';
import CodingCoordinator from '../../src/components/CodingCoordinator';
import '../../src/styles.css';

let run = null;
const id = 'a'.repeat(32);
window.codingCalls = [];
const python = { id: 'python', name: 'Python tests', category: 'tests', argv: ['python', '-m', 'pytest', '-q'], cwd: '.', source: 'pytest.ini', language: 'python', timeout_seconds: 120, recommended: true, fingerprint: 'python-v1', risk: 'Runs project code with your account permissions.' };
const frontend = { ...python, id: 'frontend', name: 'Frontend tests', argv: ['node', 'node_modules/vitest/vitest.mjs', 'run'], source: 'package.json', language: 'javascript', fingerprint: 'frontend-v1' };
const build = { ...frontend, id: 'build', name: 'Build verification', category: 'build', argv: ['node', 'build.js'], recommended: false, fingerprint: 'build-v1' };
const catalog = { environments: ['Python', 'JavaScript / TypeScript'], checks: [python, frontend, build], warnings: [], profiles: [], inspection: 'Configuration files only; no project commands were executed.' };

window.workstationDesktop = {
  chooseCodingProject: async () => ({ id: 'fixture-project', root: 'C:\\Projects\\Arithmetic' }),
  codingControl: async value => {
    window.codingCalls.push(value);
    if (value.action === 'inspect') return catalog;
    if (value.action === 'save-profile') { catalog.profiles = [{ name: value.name, selected_checks: value.selected_checks, checks: value.checks, verification_mode: value.verification_mode }]; return catalog; }
    if (value.action === 'approve-checks') { catalog.checks.forEach(check => { if (value.selected_checks.includes(check.id)) check.approved = true; }); return catalog; }
    if (value.action === 'revoke-checks') { catalog.checks.forEach(check => { check.approved = false; }); return catalog; }
    if (value.action === 'verification-approval') {
      run.pending_approval = null;
      run.status = value.approved ? 'completed' : 'needs_review';
      run.phase = value.approved ? 'Verified the addition change and its tests.' : 'Verification did not run.';
      run.review = value.approved ? { approved: true, summary: 'The one-line correction meets the request; all three configured examples pass.' } : null;
      run.check_results = [{ name: 'Python tests', revision: 1, status: value.approved ? 'passed' : 'not_run', passed: value.approved, output: value.approved ? '3 arithmetic checks passed' : '', exit_code: value.approved ? 0 : null, argv: python.argv, cwd: 'C:\\Projects\\Arithmetic', seconds: value.approved ? .14 : null, reason: value.approved ? 'Final verification for Python changes' : 'Manual verification declined' },
        { name: 'Frontend tests', revision: 1, status: 'not_run', passed: false, exit_code: null, argv: frontend.argv, cwd: 'C:\\Projects\\Arithmetic', reason: 'No matching JavaScript changes' }];
      return run;
    }
    if (value.action === 'start') run = { id, root: 'C:\\Projects\\Arithmetic', model: value.model, goal: value.goal,
      status: value.verification_mode === 'manual' ? 'awaiting_verification' : 'awaiting_approval', pending_approval: { id: 'b'.repeat(32), kind: value.verification_mode === 'manual' ? 'manual' : 'check', reason: 'Review the selected Python check before execution.', checks: [python] }, phase: 'Waiting for verification approval', rounds: 4, updated_at: Date.now() / 1000,
      plan: ['Inspect arithmetic and its tests', 'Fix addition without changing the public interface', 'Run configured checks and review the final diff'],
      changes: [{ path: 'arithmetic.py', diff: '--- a/arithmetic.py\n+++ b/arithmetic.py\n@@ -1,2 +1,2 @@\n def add(a, b):\n-    return a - b\n+    return a + b\n' }],
      check_results: [],
      review: null,
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
