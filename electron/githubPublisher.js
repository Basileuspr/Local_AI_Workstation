const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const samePaths = (left, right) => Array.isArray(left) && Array.isArray(right) && JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
function createGitHubPublisher({ root, storage, launch = spawn, environment = process.env }) {
  let state = { status: 'idle', phase: '', error: '', preview: null, validation: null, commit: null, result: null }, snapshot, child, logFile;
  const stateFile = path.join(storage, 'publication-state.json');
  const insideStorage = value => typeof value === 'string' && path.dirname(path.resolve(value)) === path.resolve(storage) && path.basename(value).startsWith('github-');
  function persist() {
    fs.mkdirSync(storage, { recursive: true });
    fs.writeFileSync(stateFile + '.pending', JSON.stringify({ state, snapshot, logFile }));
    fs.renameSync(stateFile + '.pending', stateFile);
  }
  try {
    if (fs.existsSync(stateFile)) {
      const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (insideStorage(saved.snapshot?.folder) && saved.state.preview?.id === saved.snapshot.preview?.id) {
        state = { ...state, ...saved.state }; snapshot = saved.snapshot; logFile = snapshot.log;
        // Recover completed stages even if the desktop closed before receiving a result.
        for (const [name, field] of [['validated', 'validation'], ['committed', 'commit'], ['published', 'result']]) {
          const file = path.join(snapshot.folder, name + '.json');
          if (fs.existsSync(file)) {
            const stage = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (stage.id === state.preview.id) state[field] = stage;
          } else state[field] = null;
        }
        state.selectedPaths = state.validation?.paths || state.selectedPaths || [];
        state.status = state.result ? 'published' : state.commit ? 'committed' : state.validation ? 'validated' : 'ready';
        state.phase = state.result ? 'Published and verified' : state.commit ? 'Committed locally; ready to push' : state.validation ? 'Validated; ready to commit locally' : 'Ready for review';
        state.error = '';
      }
    }
  } catch { state.error = 'Could not restore the last update. Review a new source snapshot.'; }
  const busy = () => !!child || ['preparing', 'validating', 'committing', 'pushing'].includes(state.status);
  function start(action, request = {}) {
    if (busy()) throw Error('A GitHub publication is already running.');
    if (action !== 'prepare' && (!snapshot || !request || request.id !== state.preview?.id || state.result)) throw Error('Review the source changes before continuing.');
    if (action === 'validate' && (state.commit || !Array.isArray(request.paths) || !request.paths.length || request.paths.length > 5000 || request.paths.some(value => typeof value !== 'string') || new Set(request.paths).size !== request.paths.length)) throw Error('Select source changes to validate; a committed update needs a new review to change its selection.');
    if (action === 'commit' && (!state.validation || state.commit || !samePaths(request.paths, state.validation.paths) || typeof request.message !== 'string' || !request.message.trim() || request.message.length > 500)) throw Error('Validate this selection and enter a commit message before committing locally.');
    if (action === 'push' && !state.commit) throw Error('Commit the validated update locally before pushing to GitHub.');
    const python = environment.LAW_PYTHON || path.join(root, 'venv', 'Scripts', 'python.exe');
    if (!fs.existsSync(python)) throw Error('Set up the app Python environment before continuing.');
    if (action === 'prepare') {
      snapshot = null; logFile = null;
      state = { status: 'preparing', phase: 'Reviewing GitHub', error: '', preview: null, validation: null, commit: null, result: null };
    } else {
      const stages = { validate: ['validating', 'Validating selected changes'], commit: ['committing', 'Committing locally'], push: ['pushing', 'Pushing to GitHub'] };
      state = { ...state, status: stages[action][0], phase: stages[action][1], error: '' };
      if (action === 'validate') { state.validation = null; state.selectedPaths = [...request.paths]; }
    }
    persist();
    let buffer = '', completed = false, worker;
    try { worker = launch(python, ['-B', path.join(root, 'scripts', 'publish-github.py')], { cwd: root, windowsHide: true, env: environment, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (error) { state = { ...state, status: 'failed', error: 'Could not start the publication worker.' }; persist(); throw error; }
    child = worker;
    worker.stdout.on('data', chunk => {
      buffer += chunk.toString();
      if (buffer.length > 4 * 1024 * 1024) { worker.kill(); state = { ...state, status: 'failed', error: 'Publication response exceeded its limit.' }; persist(); return; }
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        try {
          const item = JSON.parse(line);
          if (item.kind === 'progress') { state = { ...state, phase: item.phase }; if (item.log && path.resolve(item.log).startsWith(path.resolve(storage) + path.sep)) logFile = item.log; }
          if (item.kind === 'error') { state = { ...state, status: 'failed', error: item.error }; persist(); }
          if (item.kind === 'result') {
            completed = true;
            if (action === 'prepare') { snapshot = item.result; state = { ...state, status: 'ready', phase: 'Ready for review', preview: item.result.preview, selectedPaths: [] }; }
            if (action === 'validate') state = { ...state, status: 'validated', phase: 'Validated; ready to commit locally', validation: item.result };
            if (action === 'commit') state = { ...state, status: 'committed', phase: 'Committed locally; ready to push', commit: item.result };
            if (action === 'push') state = { ...state, status: 'published', phase: 'Published and verified', result: item.result };
            persist();
          }
        } catch { state = { ...state, status: 'failed', error: 'Publication worker returned an invalid response.' }; }
      }
    });
    worker.stderr.resume();
    worker.on('error', () => { state = { ...state, status: 'failed', error: 'Could not start the publication worker.' }; persist(); });
    worker.on('close', () => {
      if (child === worker) child = null;
      if (!completed && busy()) state = { ...state, status: 'failed', error: 'Publication was interrupted. Completed stages and local commits are retained. Check GitHub if a push had started.' };
      persist();
    });
    worker.stdin.on('error', () => {});
    worker.stdin.end(JSON.stringify({ action, storage, ...(action !== 'prepare' ? { folder: snapshot.folder } : {}),
      ...(action === 'validate' ? { paths: request.paths } : {}), ...(action === 'commit' ? { message: request.message } : {}) }));
    return { started: true };
  }
  return { prepare: () => start('prepare'), validate: request => start('validate', request), commit: request => start('commit', request),
    push: request => start('push', request), state: () => ({ ...structuredClone(state), busy: busy() }), log: () => logFile || snapshot?.log || null };
}
module.exports = { createGitHubPublisher };
