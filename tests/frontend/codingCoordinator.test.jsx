import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { codingChecks, codingTerminal, parseCheckCommand, displayCommand, checkStatus } from '../../src/codingCoordinator';
import { CodingResult } from '../../src/components/CodingCoordinator';
import { VerificationApproval, VerificationHistory } from '../../src/components/CodingVerification';
const { createCodingCoordinator } = createRequire(import.meta.url)('../../electron/codingCoordinator');

describe('coding command and desktop boundary', () => {
  it('preserves quoted Windows paths without introducing a shell', () => {
    expect(parseCheckCommand('"C:\\My Project\\venv\\python.exe" -m pytest "tests/test space.py"')).toEqual(['C:\\My Project\\venv\\python.exe', '-m', 'pytest', 'tests/test space.py']);
    expect(parseCheckCommand('node check.js ; whoami')).toEqual(['node', 'check.js', ';', 'whoami']);
    expect(() => parseCheckCommand('python "missing')).toThrow('quote');
    expect(() => codingChecks('')).toThrow();
    expect(codingChecks('python check.py\nnode --test')).toHaveLength(2);
    expect(codingChecks('', true)).toEqual([]);
    const argv = ['C:\\My Project\\python.exe', '-c', 'print("hello")'];
    expect(parseCheckCommand(displayCommand(argv))).toEqual(argv);
  });
  it('binds starts to native-selected projects and rejects arbitrary routes', async () => {
    const request = vi.fn(async () => ({ id: 'task' }));
    const bridge = createCodingCoordinator({ choose: async () => ({ filePaths: ['C:\\Project'] }), request });
    await expect(bridge.control({ action: 'start', projectId: 'guessed' })).rejects.toThrow('Choose');
    const project = await bridge.choose();
    await bridge.control({ action: 'start', projectId: project.id, root: 'C:\\Elsewhere', goal: 'Fix', model: 'other', checks: [], trusted_checks: true });
    expect(request.mock.calls[0][1].root).toBe('C:\\Project');
    await bridge.control({ action: 'inspect', projectId: project.id, root: 'C:\\Elsewhere' });
    expect(request.mock.calls[1]).toEqual(['/projects/inspect', { root: 'C:\\Project' }]);
    await bridge.control({ action: 'approve-checks', projectId: project.id, selected_checks: ['fixture'], checks: [], expected_fingerprints: { fixture: 'hash' } });
    expect(request.mock.calls[2][1].expected_fingerprints).toEqual({ fixture: 'hash' });
    await expect(bridge.control({ action: 'verification-approval', id: 'a'.repeat(32), request_id: '../bad' })).rejects.toThrow();
    await expect(bridge.control({ action: '../shell', id: 'a'.repeat(32) })).rejects.toThrow('Unknown');
    await expect(bridge.control({ action: 'resume', id: '../outside' })).rejects.toThrow('Unknown');
  });
});

it('keeps unexecuted checks distinct from failures and shows actual execution evidence', () => {
  const html = renderToStaticMarkup(<VerificationHistory checks={[{ name: 'Python', revision: 2, status: 'not_run', passed: false,
    exit_code: null, argv: ['python', '-m', 'pytest'], cwd: 'C:\\Project', reason: 'User declined', output: '' },
    { name: 'Node', revision: 2, status: 'failed', exit_code: 7, seconds: .4, argv: ['node', 'check.js'], cwd: 'C:\\Project', output: 'failed assertion' }]}/>);
  expect(html).toContain('not run'); expect(html).toContain('This check did not execute.');
  expect(html).toContain('User declined'); expect(html).toContain('Exit status'); expect(html).toContain('0.4 seconds');
  expect(checkStatus({ passed: true })).toBe('passed');
  expect(codingTerminal('awaiting_approval')).toBe(false);
});

it('shows the exact pending command and a manual action without implying execution', () => {
  const html = renderToStaticMarkup(<VerificationApproval pending={{ kind: 'manual', reason: 'Ready to verify', checks: [{ id: 'check', name: 'Test', argv: ['python', 'check.py'], cwd: 'C:\\Project', timeout_seconds: 120 }] }} onDecision={() => {}}/>);
  expect(html).toContain('Run verification now'); expect(html).toContain('Finish without verification');
  expect(html).toContain('python check.py'); expect(html).not.toContain('Save approval');
});

it('shows failed checks, source diffs and preserved files without rendering source HTML', () => {
  const html = renderToStaticMarkup(<CodingResult run={{ status: 'needs_review', phase: 'Check failed', error: '', model: 'other', rounds: 3,
    plan: ['Fix'], summary: 'Ready for review', review: { approved: false, summary: 'Missing edge case' }, changes: [{ path: 'a.py', diff: '<script>bad()</script>' }],
    check_results: [{ name: 'test', revision: 1, passed: false, output: 'AssertionError' }], protected_files: ['user.txt'], events: [] }}/>);
  expect(html).toContain('AssertionError'); expect(html).toContain('needs attention'); expect(html).toContain('user.txt');
  expect(html).not.toContain('<script>'); expect(codingTerminal('running')).toBe(false); expect(codingTerminal('interrupted')).toBe(true);
});
