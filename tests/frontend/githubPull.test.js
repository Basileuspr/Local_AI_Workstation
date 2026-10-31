import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import pullModule from '../../electron/githubPull';
import publisherModule from '../../electron/githubPublisher';

const { pullGitHub } = pullModule;
const { createGitHubPublisher } = publisherModule;
const executeGit = promisify(execFile);

function fixture() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'law-github-pull-'));
  const environment = { ...process.env, GIT_CONFIG_GLOBAL: path.join(work, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  fs.writeFileSync(environment.GIT_CONFIG_GLOBAL, '');
  const remote = path.join(work, 'remote.git'), seed = path.join(work, 'seed'), root = path.join(work, 'app');
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Pull fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd, env: environment, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(work, 'init', '--bare', '--initial-branch=main', remote);
  git(work, 'init', '--initial-branch=main', seed);
  fs.writeFileSync(path.join(seed, 'source.txt'), 'first\n');
  git(seed, 'add', '.'); git(seed, 'commit', '-m', 'Initial fixture');
  git(seed, 'remote', 'add', 'origin', remote); git(seed, 'push', '-u', 'origin', 'main');
  git(work, 'clone', remote, root);
  // Only URL inspection is synthetic; actual fetch/merge uses the local bare fixture.
  const execute = vi.fn((file, args, options) => args.includes('get-url')
    ? Promise.resolve({ stdout: 'https://github.com/Basileuspr/Local_AI_Workstation.git\n' })
    : executeGit(file, args, options));
  const advance = () => {
    fs.writeFileSync(path.join(seed, 'source.txt'), 'second\n');
    git(seed, 'add', '.'); git(seed, 'commit', '-m', 'Fixture update'); git(seed, 'push', 'origin', 'main');
    return git(seed, 'rev-parse', 'HEAD');
  };
  return { work, root, environment, execute, git, advance, cleanup() {
    const resolved = fs.realpathSync(work);
    if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) || !path.basename(resolved).startsWith('law-github-pull-')) throw Error('Unexpected test directory');
    fs.rmSync(resolved, { recursive: true, force: true });
  } };
}

describe('Dashboard GitHub pull', () => {
  it('fast-forwards a real checkout, reports unchanged retries, and never uses a shell or autostash', async () => {
    const f = fixture();
    try {
      const expected = f.advance();
      expect(await pullGitHub(f)).toMatchObject({ changed: true, after: expected, ahead: 0 });
      expect(fs.readFileSync(path.join(f.root, 'source.txt'), 'utf8')).toBe('second\n');
      expect(await pullGitHub(f)).toMatchObject({ changed: false, after: expected });
      const call = f.execute.mock.calls.find(([, args]) => args.includes('pull'));
      expect(call[1]).toEqual(['-c', 'pull.rebase=false', '-c', 'merge.autoStash=false', '-c', 'rebase.autoStash=false', 'pull', '--ff-only', 'origin', 'main']);
      expect(call[2]).toMatchObject({ cwd: fs.realpathSync(f.root), shell: false, windowsHide: true, env: { GIT_TERMINAL_PROMPT: '0' } });
    } finally { f.cleanup(); }
  }, 15000);

  it('preserves dirty files and diverged commits even when Git is configured to rebase and autostash', async () => {
    const f = fixture();
    try {
      fs.writeFileSync(path.join(f.root, 'unfinished.txt'), 'keep me');
      await expect(pullGitHub(f)).rejects.toThrow('Local changes');
      expect(f.execute.mock.calls.some(([, args]) => args.includes('pull'))).toBe(false);
      expect(fs.readFileSync(path.join(f.root, 'unfinished.txt'), 'utf8')).toBe('keep me');
      f.git(f.root, 'add', '.'); f.git(f.root, 'commit', '-m', 'Local work');
      f.git(f.root, 'config', 'pull.rebase', 'true'); f.git(f.root, 'config', 'rebase.autoStash', 'true');
      const before = f.git(f.root, 'rev-parse', 'HEAD');
      expect(await pullGitHub(f)).toMatchObject({ changed: false, ahead: 1 });
      f.advance();
      await expect(pullGitHub(f)).rejects.toThrow(/fast.forward|diverg/i);
      expect(f.git(f.root, 'rev-parse', 'HEAD')).toBe(before);
      expect(f.git(f.root, 'status', '--porcelain')).toBe('');
      expect(f.git(f.root, 'stash', 'list')).toBe('');
    } finally { f.cleanup(); }
  }, 15000);

  it('rejects a different branch, upstream, nested app folder, or rewritten remote before any pull', async () => {
    const f = fixture();
    try {
      f.git(f.root, 'switch', '-c', 'work');
      await expect(pullGitHub(f)).rejects.toThrow('Switch');
      f.git(f.root, 'switch', 'main');
      f.git(f.root, 'config', 'branch.main.merge', 'refs/heads/other');
      await expect(pullGitHub(f)).rejects.toThrow();
      f.git(f.root, 'config', 'branch.main.merge', 'refs/heads/main');
      const nested = path.join(f.root, 'nested'); fs.mkdirSync(nested);
      await expect(pullGitHub({ ...f, root: nested })).rejects.toThrow('repository root');
      f.git(f.root, 'remote', 'set-url', 'origin', 'https://github.com/Basileuspr/Local_AI_Workstation.git');
      f.git(f.root, 'config', 'url.https://example.test/.insteadOf', 'https://github.com/');
      await expect(pullGitHub({ ...f, execute: executeGit })).rejects.toThrow('origin remote');
      expect(f.execute.mock.calls.some(([, args]) => args.includes('pull'))).toBe(false);
    } finally { f.cleanup(); }
  }, 15000);

  it('reports missing Git and redacts credentials from command errors', async () => {
    await expect(pullGitHub({ root: os.tmpdir(), execute: async () => { throw Object.assign(Error(), { code: 'ENOENT' }); } })).rejects.toThrow('Git is unavailable');
    await expect(pullGitHub({ root: os.tmpdir(), execute: async () => { throw Object.assign(Error(), { stderr: 'fatal: https://user:private@example.test/repo' }); } })).rejects.toThrow('fatal: https://example.test/repo');
  });

  it('serializes pull/publication operations and releases the lock after success or failure', async () => {
    let finish, fail;
    const pull = vi.fn(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
    const publisher = createGitHubPublisher({ root: os.tmpdir(), storage: path.join(os.tmpdir(), 'unused-pull-state'), pull });
    expect(pull).not.toHaveBeenCalled();
    const running = publisher.pull();
    expect(publisher.state()).toMatchObject({ busy: true, pull: { status: 'running' } });
    await expect(publisher.pull()).rejects.toThrow('already running');
    expect(() => publisher.prepare()).toThrow('already running');
    finish({ changed: false, after: 'a'.repeat(40), ahead: 0 }); await running;
    expect(publisher.state()).toMatchObject({ busy: false, pull: { status: 'completed' } });
    const rejected = publisher.pull(); fail(Error('Authentication failed'));
    await expect(rejected).rejects.toThrow('Authentication failed');
    expect(publisher.state()).toMatchObject({ busy: false, pull: { status: 'failed', error: 'Authentication failed' } });
  });
});
