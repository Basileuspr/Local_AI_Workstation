import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { codingChecks, codingTerminal, parseCheckCommand } from '../../src/codingCoordinator';
import { CodingResult } from '../../src/components/CodingCoordinator';
const { createCodingCoordinator } = createRequire(import.meta.url)('../../electron/codingCoordinator');

describe('coding command and desktop boundary', () => {
  it('preserves quoted Windows paths without introducing a shell', () => {
    expect(parseCheckCommand('"C:\\My Project\\venv\\python.exe" -m pytest "tests/test space.py"')).toEqual(['C:\\My Project\\venv\\python.exe', '-m', 'pytest', 'tests/test space.py']);
    expect(parseCheckCommand('node check.js ; whoami')).toEqual(['node', 'check.js', ';', 'whoami']);
    expect(() => parseCheckCommand('python "missing')).toThrow('quote');
    expect(() => codingChecks('')).toThrow();
    expect(codingChecks('python check.py\nnode --test')).toHaveLength(2);
  });
  it('binds starts to native-selected projects and rejects arbitrary routes', async () => {
    const request = vi.fn(async () => ({ id: 'task' }));
    const bridge = createCodingCoordinator({ choose: async () => ({ filePaths: ['C:\\Project'] }), request });
    await expect(bridge.control({ action: 'start', projectId: 'guessed' })).rejects.toThrow('Choose');
    const project = await bridge.choose();
    await bridge.control({ action: 'start', projectId: project.id, root: 'C:\\Elsewhere', goal: 'Fix', model: 'other', checks: [], trusted_checks: true });
    expect(request.mock.calls[0][1].root).toBe('C:\\Project');
    await expect(bridge.control({ action: '../shell', id: 'a'.repeat(32) })).rejects.toThrow('Unknown');
    await expect(bridge.control({ action: 'resume', id: '../outside' })).rejects.toThrow('Unknown');
  });
});

it('shows failed checks, source diffs and preserved files without rendering source HTML', () => {
  const html = renderToStaticMarkup(<CodingResult run={{ status: 'needs_review', phase: 'Check failed', error: '', model: 'other', rounds: 3,
    plan: ['Fix'], summary: 'Ready for review', review: { approved: false, summary: 'Missing edge case' }, changes: [{ path: 'a.py', diff: '<script>bad()</script>' }],
    check_results: [{ name: 'test', revision: 1, passed: false, output: 'AssertionError' }], protected_files: ['user.txt'], events: [] }}/>);
  expect(html).toContain('AssertionError'); expect(html).toContain('needs attention'); expect(html).toContain('user.txt');
  expect(html).not.toContain('<script>'); expect(codingTerminal('running')).toBe(false); expect(codingTerminal('interrupted')).toBe(true);
});
