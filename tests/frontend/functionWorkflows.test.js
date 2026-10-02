import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateWorkflow, expandFunctionText } from '../../src/functionContract.mjs';
import { loadWorkflows, saveWorkflows } from '../../src/functionWorkflow.mjs';
const require = createRequire(import.meta.url);
const { createFunctionWorkflows } = require('../../electron/functionWorkflows');
const { auditFolder } = require('../../electron/functionAudit');
const { automateWindows } = require('../../electron/functionAutomation');
const workflow = steps => ({ id: 'example', name: 'Example', steps });
async function finish(engine) {
  const deadline = Date.now() + 5000;
  while (engine.state()?.status === 'running' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  expect(engine.state().status).not.toBe('running');
  return engine.state();
}
function engine(options = {}) { return createFunctionWorkflows({ file: path.join(os.tmpdir(), 'unselected-function-folders.json'), copyText: vi.fn(), copyImage: vi.fn(), openProgram: vi.fn(), ...options }); }

describe('function sequences', () => {
  it('rejects arbitrary launches, selectors, unselected folders and overlong workflows before side effects', async () => {
    const automate = vi.fn(), runner = engine({ automate });
    for (const steps of [[{ type: 'launch', target: 'powershell -Command whoami' }], [{ type: 'shell', text: 'whoami' }],
      [{ type: 'folder-audit', folderId: 'C:\\private', depth: 3 }], [{ type: 'control-set', window: { process: 'Codex', title: '' }, control: { name: '', automationId: '', controlType: 'Edit' }, text: 'test' }],
      Array.from({ length: 31 }, () => ({ type: 'launch', target: 'task-manager' }))]) {
      await expect(runner.start(workflow(steps))).rejects.toThrow();
    }
    expect(automate).not.toHaveBeenCalled();
  });
  it('persists naturally sorted functions separately from legacy buttons and leaves corrupt data intact', () => {
    const data = new Map(), storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
    storage.setItem('local-ai-workstation-function-buttons-v1', 'legacy');
    saveWorkflows([{ ...workflow([{ type: 'text', text: '2' }]), id: '2', name: 'Task 10' }, { ...workflow([{ type: 'text', text: '1' }]), id: '1', name: 'Task 2' }], storage);
    expect(loadWorkflows(storage).map(item => item.name)).toEqual(['Task 2', 'Task 10']);
    expect(storage.getItem('local-ai-workstation-function-buttons-v1')).toBe('legacy');
    expect(() => saveWorkflows([workflow([{ type: 'unknown' }])], storage)).toThrow();
    expect(loadWorkflows(storage)).toHaveLength(2);
  });
  it('passes exact window and control selectors in sequence and rejects simultaneous starts', async () => {
    const window = { process: 'Codex', title: 'My chat' }, control = { name: 'Prompt', automationId: 'prompt', controlType: 'ControlType.Edit' };
    const automate = vi.fn(async request => request.action === 'windows' ? { windows: [window] } : { ok: true });
    const runner = engine({ automate });
    const task = workflow([{ type: 'launch', target: 'codex' }, { type: 'window-wait', window }, { type: 'control-set', window, control, text: 'Inspect please' }, { type: 'control-invoke', window, control: { ...control, name: 'Send', controlType: 'ControlType.Button' } }]);
    const starts = await Promise.allSettled([runner.start(task), runner.start(task)]);
    expect(starts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await finish(runner)).status).toBe('complete');
    expect(automate.mock.calls.map(([request]) => request.action)).toEqual(['launch', 'windows', 'set', 'invoke']);
    expect(automate.mock.calls[2][0]).toMatchObject({ window, control, text: 'Inspect please' });
  });
  it('stops on failure and never presses Send after a failed fill', async () => {
    const window = { process: 'Codex', title: '' }, control = { name: 'Prompt', automationId: '', controlType: 'ControlType.Edit' };
    const automate = vi.fn(async () => { throw Error('Existing draft'); }), runner = engine({ automate });
    await runner.start(workflow([{ type: 'control-set', window, control, text: 'Inspect' }, { type: 'control-invoke', window, control }]));
    const state = await finish(runner);
    expect(state.status).toBe('failed'); expect(state.error).toBe('Existing draft');
    expect(state.steps.map(step => step.status)).toEqual(['failed', 'pending']); expect(automate).toHaveBeenCalledTimes(1);
  });
  it('cancels in-flight work without starting later steps and retains partial text', async () => {
    let entered;
    const ready = new Promise(resolve => { entered = resolve; });
    const automate = vi.fn((_request, { signal }) => new Promise((resolve, reject) => { entered(); signal.addEventListener('abort', () => reject(Error('Stopped')), { once: true }); }));
    const copyText = vi.fn(), runner = engine({ automate, copyText });
    const { id } = await runner.start(workflow([{ type: 'text', text: 'Keep this result' }, { type: 'launch', target: 'task-manager' }, { type: 'output-copy' }]));
    await ready; runner.stop(id);
    const state = await finish(runner);
    expect(state.status).toBe('stopped'); expect(state.result.text).toBe('Keep this result'); expect(copyText).not.toHaveBeenCalled();
  });
  it('saves real bounded audit results into a registered folder with fresh filenames', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'law-function-audit-'));
    try {
      const source = path.join(root, 'source'), output = path.join(root, 'output');
      await fs.mkdir(source); await fs.mkdir(output);
      await fs.writeFile(path.join(source, 'package.json'), '{secret-content}');
      await fs.mkdir(path.join(source, 'NVIDIA')); await fs.writeFile(path.join(source, 'NVIDIA', 'excluded.bin'), 'secret');
      let picked = source;
      const copyText = vi.fn(), runner = engine({ file: path.join(root, 'folders.json'), chooseDirectory: async () => picked, copyText });
      const audit = await runner.chooseFolder('audit'); picked = output; const save = await runner.chooseFolder('output');
      const task = workflow([{ type: 'folder-audit', folderId: audit.id, depth: 2 }, { type: 'text', text: 'Discuss:\n{{report}}' }, { type: 'output-save', folderId: save.id }, { type: 'output-copy' }]);
      await runner.start(task); const first = await finish(runner);
      expect(first.status).toBe('complete'); expect(first.result.report.files).toBe(1);
      expect(first.result.text).toContain('Discuss:'); expect(first.result.text).toContain('package.json'); expect(first.result.text).not.toContain('secret-content');
      expect(first.result.report.skipped.join()).toContain('NVIDIA'); expect(first.result.saved).toHaveLength(2);
      expect(await fs.readFile(first.result.saved[0], 'utf8')).toBe(first.result.text);
      await runner.start(task); const second = await finish(runner);
      expect(second.result.saved[0]).not.toBe(first.result.saved[0]); expect(await fs.readdir(output)).toHaveLength(4);
      expect(copyText).toHaveBeenCalledTimes(2);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  it('reports depth and entry limits and cancellation', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'law-audit-limits-'));
    try {
      await fs.mkdir(path.join(root, 'nested')); await fs.writeFile(path.join(root, 'nested', 'deep.txt'), 'deep'); await fs.writeFile(path.join(root, 'top.txt'), 'top');
      const shallow = await auditFolder(root, { depth: 0 }); expect(shallow.report.files).toBe(1); expect(shallow.report.skipped.join()).toContain('depth limit');
      expect((await auditFolder(root, { limit: 1 })).report.partial).toBe(true);
      const controller = new AbortController(); controller.abort(); await expect(auditFolder(root, { signal: controller.signal })).rejects.toThrow('stopped');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  it('keeps report expansion literal and keeps shell-like text encoded as data', async () => {
    expect(expandFunctionText('Review {{report}}', '$& $(whoami)')).toBe('Review $& $(whoami)');
    const execute = vi.fn((_file, _args, _options, callback) => callback(null, '{"ok":true}'));
    await automateWindows({ action: 'set', text: '$(whoami); "quoted"' }, { platform: 'win32', execute });
    const args = execute.mock.calls[0][1]; expect(args).not.toContain('-Command');
    expect(JSON.parse(Buffer.from(args.at(-1), 'base64').toString()).text).toBe('$(whoami); "quoted"');
    await expect(automateWindows({ action: 'shell' }, { platform: 'win32', execute })).rejects.toThrow();
  });
  it('validates recorded pointer bounds and keeps paste/click operations ordered', async () => {
    const window = { process: 'ChatGPT', title: '' }, point = { x: 100, y: 100, width: 800, height: 600 };
    const automate = vi.fn(async () => ({ ok: true, detail: 'Delivered' })), runner = engine({ automate });
    expect(() => validateWorkflow(workflow([{ type: 'pointer-click', window, point: { ...point, x: 900 } }]))).toThrow();
    await runner.start(workflow([{ type: 'pointer-paste', window, point, text: 'Inspect this app' }, { type: 'pointer-click', window, point }]));
    const state = await finish(runner); expect(state.status).toBe('complete');
    expect(automate.mock.calls.map(([request]) => request.action)).toEqual(['pointer-paste', 'pointer-click']);
    expect(state.steps[0].detail).toBe('Delivered');
  });
});
