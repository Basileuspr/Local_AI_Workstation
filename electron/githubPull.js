const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { redactSecrets } = require('./redactSecrets');

const executeGit = promisify(execFile);
const repository = /^https:\/\/github\.com\/Basileuspr\/Local_AI_Workstation(?:\.git)?\/?$/i;

async function pullGitHub({ root, execute = executeGit, environment = process.env }) {
  const directory = fs.realpathSync(root);
  async function git(args) {
    try {
      const result = await execute('git', ['-c', 'pull.rebase=false', '-c', 'merge.autoStash=false', '-c', 'rebase.autoStash=false', ...args], {
        cwd: directory, shell: false, windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024,
        env: { ...environment, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
      });
      return { stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() };
    } catch (error) {
      if (error.code === 'ENOENT') throw Error('Git is unavailable. Install Git and restart the desktop app.');
      const detail = redactSecrets(String(error.stderr || error.stdout || '').trim());
      throw Error(error.killed ? 'Git timed out. Check the repository status before retrying.' : detail || 'Git could not complete the update. Check repository access and try again.');
    }
  }
  const read = async args => (await git(args)).stdout;
  if (fs.realpathSync(await read(['rev-parse', '--show-toplevel'])) !== directory) throw Error('Open the app from its repository root before pulling updates.');
  if (await read(['branch', '--show-current']) !== 'main') throw Error('Switch the app repository to main before pulling updates.');
  if (await read(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']) !== 'origin/main') throw Error('Set main to track origin/main before pulling updates.');
  for (const args of [['remote', 'get-url', '--all', 'origin'], ['remote', 'get-url', '--push', '--all', 'origin']]) {
    if (!repository.test(await read(args))) throw Error('The origin remote must point to Basileuspr/Local_AI_Workstation on GitHub.');
  }
  if (await read(['status', '--porcelain', '--untracked-files=normal'])) throw Error('Local changes need attention. Commit or preserve them before pulling updates.');
  const before = await read(['rev-parse', 'HEAD']);
  const result = await git(['pull', '--ff-only', 'origin', 'main']);
  const after = await read(['rev-parse', 'HEAD']);
  const ahead = Number(await read(['rev-list', '--count', 'origin/main..HEAD']));
  return { before, after, changed: before !== after, ahead, output: redactSecrets([result.stdout, result.stderr].filter(Boolean).join('\n')) };
}

module.exports = { pullGitHub };
