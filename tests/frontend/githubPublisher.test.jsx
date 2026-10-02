import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import GitHubPublisher, { githubPublicationSteps } from '../../src/components/GitHubPublisher';
import publisherModule from '../../electron/githubPublisher';

const { createGitHubPublisher } = publisherModule;
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'law-github-controller-'));
  const python = path.join(root, 'python.exe'); fs.writeFileSync(python, '');
  const workers = [], launch = vi.fn(() => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = vi.fn(); workers.push(child); return child;
  });
  const publisher = createGitHubPublisher({ root, storage: path.join(root, 'jobs'), launch, environment: { LAW_PYTHON: python } });
  return { root, publisher, workers, launch, environment: { LAW_PYTHON: python }, cleanup: () => {
    const resolved = fs.realpathSync(root);
    if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) || !path.basename(resolved).startsWith('law-github-controller-')) throw Error('Unexpected test directory');
    fs.rmSync(resolved, { recursive: true, force: true });
  } };
}

describe('GitHub publication controller', () => {
  it('starts no process at construction or status reads; the UI requires desktop access', () => {
    const fixture = setup();
    try {
      expect(fixture.publisher.state().status).toBe('idle');
      expect(fixture.launch).not.toHaveBeenCalled();
      const html = renderToStaticMarkup(<GitHubPublisher/>);
      expect(html).toContain('Review source changes');
      expect(html).toContain('disabled');
      expect(fixture.launch).not.toHaveBeenCalled();
    } finally { fixture.cleanup(); }
  });
  it('requires a reviewed snapshot and serializes explicit selected paths as data', () => {
    const fixture = setup();
    try {
      expect(() => fixture.publisher.validate({ id: 'unknown', paths: ['src/app.js'] })).toThrow('Review');
      fixture.publisher.prepare();
      expect(() => fixture.publisher.prepare()).toThrow('already running');
      const worker = fixture.workers[0];
      worker.stdout.write(JSON.stringify({ kind: 'result', result: { folder: 'private-snapshot', preview: { id: 'review', changes: [] } } }) + '\n');
      worker.emit('close', 0);
      expect(() => fixture.publisher.validate({ id: 'stale', paths: ['src/app.js'] })).toThrow('Review');
      expect(() => fixture.publisher.commit({ id: 'review', paths: ['src/app.js'], message: 'Update' })).toThrow('Validate');
      expect(() => fixture.publisher.push({ id: 'review' })).toThrow('Commit');
      fixture.publisher.validate({ id: 'review', paths: ['src/app.js'], folder: 'renderer-path' });
      const request = JSON.parse(fixture.workers[1].stdin.read().toString());
      expect(request.folder).toBe('private-snapshot');
      expect(request.paths).toEqual(['src/app.js']);
      expect(request.action).toBe('validate');
      expect(request.message).toBeUndefined();
      expect(fixture.launch.mock.calls[1][1]).toEqual(['-B', path.join(fixture.root, 'scripts', 'publish-github.py')]);
      expect(fixture.launch.mock.calls[1][2].windowsHide).toBe(true);
    } finally { fixture.cleanup(); }
  });
  it('separates all stages, invalidates changed selections, and retains a commit after push failure', () => {
    const fixture = setup();
    const finish = (result, number = fixture.workers.length - 1) => {
      fixture.workers[number].stdout.write(JSON.stringify({ kind: 'result', result }) + '\n');
      fixture.workers[number].emit('close', 0);
    };
    try {
      fixture.publisher.prepare();
      finish({ folder: 'private-snapshot', preview: { id: 'review', changes: [] } });
      fixture.publisher.validate({ id: 'review', paths: ['src/app.js'] });
      finish({ id: 'review', paths: ['src/app.js'], files: 1 });
      expect(fixture.publisher.state().status).toBe('validated');
      expect(() => fixture.publisher.commit({ id: 'review', paths: ['src/other.js'], message: 'Update' })).toThrow('Validate');
      fixture.publisher.commit({ id: 'review', paths: ['src/app.js'], message: 'Text with $() and quotes' });
      expect(JSON.parse(fixture.workers[2].stdin.read().toString())).toMatchObject({ action: 'commit', message: 'Text with $() and quotes' });
      finish({ id: 'review', commit: 'a'.repeat(40), branch: 'codex/github-update-review', files: 1 });
      expect(fixture.publisher.state().status).toBe('committed');
      expect(() => fixture.publisher.validate({ id: 'review', paths: ['src/app.js'] })).toThrow('committed');
      fixture.publisher.push({ id: 'review', folder: 'renderer-path', commit: 'renderer-commit' });
      const request = JSON.parse(fixture.workers[3].stdin.read().toString());
      expect(request).toMatchObject({ action: 'push', folder: 'private-snapshot' });
      expect(request.commit).toBeUndefined();
      fixture.workers[3].stdout.write('{"kind":"error","error":"Push failed"}\n'); fixture.workers[3].emit('close', 1);
      expect(fixture.publisher.state()).toMatchObject({ status: 'failed', commit: { commit: 'a'.repeat(40) } });
      fixture.publisher.push({ id: 'review' });
      finish({ commit: 'a'.repeat(40), files: 1, url: 'https://github.com/example/app/commit/aaa' });
      expect(fixture.publisher.state().status).toBe('published');
      expect(() => fixture.publisher.push({ id: 'review' })).toThrow('Review');
    } finally { fixture.cleanup(); }
  });
  it('restores a completed local commit without launching a worker', () => {
    const fixture = setup();
    try {
      const folder = path.join(fixture.root, 'jobs', 'github-review'); fs.mkdirSync(folder, { recursive: true });
      const preview = { id: 'review', changes: [] }, validation = { id: 'review', paths: ['src/app.js'] }, commit = { id: 'review', commit: 'a'.repeat(40) };
      fs.writeFileSync(path.join(folder, 'validated.json'), JSON.stringify(validation));
      fs.writeFileSync(path.join(folder, 'committed.json'), JSON.stringify(commit));
      fs.writeFileSync(path.join(fixture.root, 'jobs', 'publication-state.json'), JSON.stringify({ state: { status: 'committing', preview }, snapshot: { folder, preview } }));
      const restored = createGitHubPublisher({ root: fixture.root, storage: path.join(fixture.root, 'jobs'), launch: fixture.launch, environment: fixture.environment });
      expect(restored.state()).toMatchObject({ status: 'committed', validation, commit, selectedPaths: ['src/app.js'], busy: false });
      expect(fixture.launch).not.toHaveBeenCalled();
    } finally { fixture.cleanup(); }
  });
  it('shows separate controls and disables commit when the selection no longer matches validation', () => {
    const previous = globalThis.window;
    globalThis.window = { workstationDesktop: { prepareGitHubPublication() {}, validateGitHubSelection() {}, commitGitHubSelection() {}, pushGitHubCommit() {} } };
    try {
      const initialJob = { status: 'validated', preview: { id: 'review', repository: 'https://github.com/example/app', branch: 'main', captured_at: '2026-10-02', changes: [{ path: 'src/app.js', status: 'modified' }], blocked: [] }, selectedPaths: ['src/app.js'], validation: { paths: ['src/app.js'] } };
      const html = renderToStaticMarkup(<GitHubPublisher initialJob={initialJob}/>);
      expect(html).toContain('Validate selected changes'); expect(html).toContain('Commit locally'); expect(html).toContain('Push to GitHub');
      expect(html).not.toContain('Validate, commit and push selected changes');
      expect(html).toMatch(/<button type="button">Commit locally/);
      expect(html).toMatch(/<button type="button" disabled="">Push to GitHub/);
      expect(githubPublicationSteps(initialJob, ['src/other.js']).validated).toBe(false);
      const changed = renderToStaticMarkup(<GitHubPublisher initialJob={{ ...initialJob, selectedPaths: ['src/other.js'] }}/>);
      expect(changed).toContain('Selection changed');
      expect(changed).toMatch(/<button type="button" disabled="">Commit locally/);
    } finally { globalThis.window = previous; }
  });
  it('reports worker failures and can recover with another review', () => {
    const fixture = setup();
    try {
      fixture.publisher.prepare();
      fixture.workers[0].stdout.write('{"kind":"progress","phase":"Checking source"}\n{"kind":"error","error":"Git authentication failed"}\n');
      fixture.workers[0].emit('close', 1);
      expect(fixture.publisher.state()).toMatchObject({ status: 'failed', error: 'Git authentication failed' });
      fixture.publisher.prepare();
      fixture.workers[1].emit('close', 1);
      expect(fixture.publisher.state().error).toContain('interrupted');
    } finally { fixture.cleanup(); }
  });
});
