// Hidden Electron integration: disposable data/profile, real builder/composer,
// real folder reports, synthetic external window actions, no user app launches.
const { app, BrowserWindow, ipcMain, protocol, net, nativeImage } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { appAsset, APP_HEADERS, trustedUrl } = require('../electron/security');
const { createFunctionWorkflows } = require('../electron/functionWorkflows');
const root = path.resolve(__dirname, '..'), work = fs.mkdtempSync(path.join(os.tmpdir(), 'law-sequences-'));
app.setPath('userData', path.join(work, 'profile'));
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let win, child, runner;
const calls = [], checks = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, timeout = 20000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await pause(50); } throw Error('Timed out: ' + label); }
app.whenReady().then(async () => {
  child = spawn(path.join(root, 'venv/Scripts/python.exe'), [path.join(root, 'scripts/qa-generation-controls-fixture.py'), work], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let backendError = ''; child.stderr.on('data', data => { backendError += data; });
  const connection = await new Promise((resolve, reject) => { let text = ''; const timer = setTimeout(() => reject(Error('Backend fixture failed: ' + backendError.slice(-2000))), 25000); child.stdout.on('data', data => { text += data; if (text.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(text.split('\n')[0])); } }); child.once('error', reject); });
  protocol.handle('app', async request => {
    const response = await net.fetch(pathToFileURL(appAsset(path.join(root, 'tmp/functions-check-dist'), request.url)).toString());
    return new Response(response.body, { headers: { ...Object.fromEntries(response.headers), ...APP_HEADERS } });
  });
  win = new BrowserWindow({ show: false, width: 1400, height: 1000, webPreferences: { preload: path.join(root, 'electron/preload.js'), contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
  const trusted = event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && trustedUrl(event.senderFrame.url);
  ipcMain.on('app:connection', event => { event.returnValue = trusted(event) ? connection : null; });
  ipcMain.handle('app:startup-status', () => ({ state: 'ready' }));
  ipcMain.handle('app:capabilities', () => ({ features: {} }));
  ipcMain.handle('media-manager:place', () => {});
  ipcMain.handle('viewer-browser:place', () => {});
  ipcMain.handle('maintenance:import-status', () => ({ active: false }));
  const source = path.join(work, 'audit-source'), output = path.join(work, 'audit-output');
  fs.mkdirSync(source); fs.mkdirSync(output); fs.writeFileSync(path.join(source, 'package.json'), '{}');
  const image = nativeImage.createFromBitmap(Buffer.alloc(120 * 80 * 4, 180), { width: 120, height: 80 }).toDataURL();
  runner = createFunctionWorkflows({ file: path.join(work, 'folders.json'), chooseDirectory: async purpose => purpose === 'audit' ? source : output,
    openProgram: async id => calls.push({ action: 'program', id }), copyText: async text => calls.push({ action: 'copy-text', size: text.length }), copyImage: async image => calls.push({ action: 'copy-image', size: image.length }),
    automate: async request => { calls.push(request); if (request.action === 'windows') return { windows: [{ process: 'Taskmgr', title: 'Task Manager' }] }; if (request.action === 'capture') return { image }; return { ok: true }; } });
  for (const [channel, method] of Object.entries({ 'choose-folder': 'chooseFolder', inspect: 'inspect', start: 'start', state: 'state', stop: 'stop' })) ipcMain.handle(`function-workflows:${channel}`, async (event, value) => { assert(trusted(event)); try { return await runner[method](value); } catch (error) { return { error: error.message }; } });
  const js = async code => { try { return await win.webContents.executeJavaScript(code); } catch (error) { throw Error(error.message + '\nCode: ' + code.slice(0, 500)); } };
  const click = (text, scope = '.function-sequences') => js(`(()=>{const b=[...document.querySelector(${JSON.stringify(scope)}).querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}||b.querySelector('strong')?.textContent===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Missing button '+${JSON.stringify(text)});b.click()})()`);
  const nav = tab => js(`document.querySelector('[data-sidebar-route="${tab}"]').click()`);
  await win.loadURL('app://local/index.html');
  await until(() => js("!!document.querySelector('.function-sequences')"), 'builder mounted');
  await nav('tools');
  assert.equal(calls.length, 0, 'Opening Functions must not run anything');
  await click('Task Manager screenshot'); await click('Save function');
  await until(() => js("!!localStorage.getItem('local-ai-workstation-functions-v2')"), 'function saved');
  assert.equal(calls.length, 0, 'Saving must not execute');
  await click('Run Task Manager screenshot');
  await until(() => js("document.querySelector('.function-result [role=status]')?.textContent==='complete'"), 'capture sequence complete');
  assert.deepEqual(calls.map(call => call.action), ['launch', 'windows', 'capture', 'copy-image']);
  assert(await js("!!document.querySelector('.function-result img')?.naturalWidth"));
  checks.push('Template, saving without execution, ordered Run, per-step statuses and screenshot preview');
  await js("document.querySelector('#input-area textarea').value='Keep my unsent draft'");
  await click('Add result to chat');
  await until(() => js("!!document.querySelector('[aria-label=\"Pending attachments\"] img')"), 'pending screenshot attachment');
  assert.equal(await js("document.querySelector('#input-area textarea').value"), 'Keep my unsent draft');
  assert.equal(await js("document.querySelector('[data-capture-tab=chats]').hidden"), false);
  assert(!fs.existsSync(path.join(work, 'generation.jsonl')), 'Handoff must not send');
  checks.push('Real composer receives pending screenshot, keeps draft and sends nothing');
  await nav('tools'); await click('Folder environment audit');
  await click('Browse folder to inspect'); await until(() => js("document.querySelector('.function-sequence-editor').textContent.includes('audit-source')"), 'source chosen');
  await click('Browse output folder'); await until(() => js("document.querySelector('.function-sequence-editor').textContent.includes('audit-output')"), 'output chosen');
  await click('Save function'); await click('Run Folder environment audit');
  await until(() => js("document.querySelector('.function-result [role=status]')?.textContent==='complete' && document.querySelector('.function-result textarea')?.value.includes('package.json')"), 'real folder audit saved');
  assert.equal(fs.readdirSync(output).length, 2);
  await click('Add result to chat');
  await until(() => js("document.querySelector('[aria-label=\"Pending attachments\"]')?.textContent.includes('function-result.md')"), 'pending report');
  assert.equal(await js("document.querySelector('#input-area textarea').value"), 'Keep my unsent draft');
  checks.push('Native-folder registry, actual audit Markdown/JSON outputs, report staged beside existing screenshot');
  await nav('tools'); await click('Codex application inspection');
  assert.equal(await js("document.querySelectorAll('.function-step').length"), 4);
  assert(await js("document.querySelector('.function-sequence-editor').textContent.includes('Point at text field')"));
  assert(await js("document.querySelector('.function-sequence-editor').textContent.includes('Point at button')"));
  checks.push('Codex template exposes pointer field/button steps');
  await click('Cancel');
  const picture = await win.webContents.capturePage(); fs.writeFileSync(path.join(root, 'tmp/functions-sequences-preview.png'), picture.toPNG());
  console.log(JSON.stringify({ ok: true, checks }));
}).catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  runner?.dispose(); win?.destroy();
  if (child && child.exitCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill(); await Promise.race([exited, pause(3000)]);
  }
  // Delete only the specific temporary directory created by this QA run.
  const target = path.resolve(work);
  if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('law-sequences-')) {
    try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* Locked fixture files may be retained for diagnostics. */ }
  }
  app.exit(process.exitCode || 0);
});
