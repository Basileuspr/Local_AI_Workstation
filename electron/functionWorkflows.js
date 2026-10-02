const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { automateWindows } = require('./functionAutomation');
const { auditFolder } = require('./functionAudit');

function createFunctionWorkflows({ file, chooseDirectory, openProgram, copyText, copyImage, automate = automateWindows, audit = auditFolder }) {
  let run = null;
  const readFolders = async () => {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return []; throw Error('Saved function folders could not be read.'); }
  };
  async function folder(id, purpose) {
    const record = (await readFolders()).find(record => record.id === id && record.purpose === purpose);
    if (!record) throw Error('Choose this folder again using Browse.');
    if (!(await fs.stat(record.path)).isDirectory() || (await fs.lstat(record.path)).isSymbolicLink()) throw Error('Selected folder is missing or is a directory link.');
    if (purpose === 'audit' && /nvidia/i.test(record.path)) throw Error('NVIDIA paths are excluded from folder audits.');
    return record.path;
  }
  async function execute(current, workflow, expand) {
    const signal = current.controller.signal;
    const check = () => { if (signal.aborted) throw Error('Function stopped.'); };
    const result = { text: '', image: null, saved: [] };
    try {
      // Resolve all folders before executing any steps, so invalid destinations fail early.
      const folders = new Map();
      for (const step of workflow.steps) if (step.folderId) folders.set(step.folderId, await folder(step.folderId, step.type === 'folder-audit' ? 'audit' : 'output'));
      for (let index = 0; index < workflow.steps.length; index++) {
        check(); current.index = index; current.steps[index].status = 'running';
        const step = workflow.steps[index];
        if (step.type === 'launch') {
          if (step.target.startsWith('program:')) await openProgram(step.target.slice(8));
          else await automate({ action: 'launch', target: step.target }, { signal });
        } else if (step.type === 'window-wait') {
          const deadline = Date.now() + 15000;
          let found = false;
          while (Date.now() < deadline) {
            check();
            const windows = (await automate({ action: 'windows' }, { signal })).windows;
            const matches = windows.filter(window => window.process === step.window.process && (!step.window.title || window.title === step.window.title));
            if (matches.length > 1) throw Error('More than one matching window. Choose an exact title.');
            if (matches.length === 1) { found = true; break; }
            await new Promise(resolve => setTimeout(resolve, 250));
          }
          if (!found) throw Error('The selected window did not appear within 15 seconds.');
        } else if (step.type === 'window-capture') {
          result.image = (await automate({ action: 'capture', window: step.window }, { signal })).image;
        } else if (step.type === 'pointer-paste' || step.type === 'pointer-click') {
          const response = await automate({ action: step.type, window: step.window, point: step.point,
            text: step.type === 'pointer-paste' ? expand(step.text, result.text) : undefined }, { signal });
          current.steps[index].detail = response.detail;
        } else if (step.type === 'control-set' || step.type === 'control-invoke') {
          await automate({ action: step.type === 'control-set' ? 'set' : 'invoke', window: step.window,
            control: step.control, text: step.type === 'control-set' ? expand(step.text, result.text) : undefined }, { signal });
        } else if (step.type === 'folder-audit') {
          const audited = await audit(folders.get(step.folderId), { depth: step.depth, signal });
          result.text = audited.text; result.report = audited.report;
        } else if (step.type === 'text') result.text = expand(step.text, result.text);
        else if (step.type === 'output-copy') {
          if (result.image) await copyImage(result.image);
          else if (result.text) await copyText(result.text);
          else throw Error('No result yet. Add a screenshot, audit or text step first.');
        } else if (step.type === 'output-save') {
          if (!result.text && !result.image) throw Error('No result yet. Add a screenshot, audit or text step first.');
          const base = path.join(folders.get(step.folderId), `function-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
          const outputs = [];
          if (result.text) outputs.push([base + '.md', result.text]);
          if (result.report) outputs.push([base + '.json', JSON.stringify(result.report, null, 2)]);
          if (result.image) outputs.push([base + '.png', Buffer.from(result.image.split(',')[1], 'base64')]);
          for (const [filename, data] of outputs) { check(); await fs.writeFile(filename, data, { flag: 'wx' }); result.saved.push(filename); }
        }
        current.steps[index].status = 'complete';
        check();
      }
      current.status = 'complete';
    } catch (error) {
      current.status = signal.aborted ? 'stopped' : 'failed'; current.error = error.message;
      if (current.steps[current.index]?.status !== 'complete') current.steps[current.index].status = current.status;
    } finally { current.result = result; current.finishedAt = new Date().toISOString(); }
  }
  return {
    get busy() { return run?.status === 'running'; },
    async chooseFolder(purpose) {
      if (!['audit', 'output'].includes(purpose)) throw Error('Invalid folder purpose.');
      const selected = await chooseDirectory(purpose);
      if (!selected) return null;
      const records = await readFolders(), id = randomUUID();
      const record = { id, path: selected, purpose };
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file + '.tmp', JSON.stringify([...records, record]), 'utf8');
      await fs.rename(file + '.tmp', file);
      return { id, name: selected };
    },
    async inspect(request) {
      if (this.busy) throw Error('Stop the running function before inspecting windows.');
      if (!['windows', 'controls', 'pick-pointer'].includes(request?.action)) throw Error('Invalid inspection request.');
      if (request.action === 'controls') {
        const { validateWorkflow } = await import('../src/functionContract.mjs');
        validateWorkflow({ id: 'inspection', name: 'Inspection', steps: [{ type: 'window-wait', window: request.window }] });
      }
      return automate(request);
    },
    async start(workflow) {
      if (this.busy) throw Error('A function is already running.');
      const { validateWorkflow, expandFunctionText } = await import('../src/functionContract.mjs');
      validateWorkflow(workflow);
      // Check again after async import: two simultaneous starts must not race.
      if (this.busy) throw Error('A function is already running.');
      run = { id: randomUUID(), name: workflow.name, status: 'running', index: 0, error: '',
        startedAt: new Date().toISOString(), controller: new AbortController(), steps: workflow.steps.map(step => ({ type: step.type, status: 'pending' })) };
      void execute(run, structuredClone(workflow), expandFunctionText);
      return { id: run.id };
    },
    state() {
      if (!run) return null;
      const { controller, ...value } = run;
      return structuredClone(value);
    },
    stop(id) {
      if (run?.id !== id) throw Error('This run is no longer active.');
      run.controller.abort();
      return { ok: true };
    },
    dispose() { run?.controller.abort(); },
  };
}
module.exports = { createFunctionWorkflows };
