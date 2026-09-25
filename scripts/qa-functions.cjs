// Hidden, isolated desktop integration checks. No user app interaction, real
// inference, program updates or graphics reset. Standard clipboard is restored.
const { app, BrowserWindow, WebContentsView, session, ipcMain, protocol, net, clipboard, ClipboardItem, nativeImage, screen } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process'), { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { appAsset, APP_HEADERS, trustedUrl } = require('../electron/security');
const { createTabCapture, TAB_LABELS, hasVisibleContent } = require('../electron/tabCapture');
const { snapshotDocument } = require('../electron/captureSnapshot');
const { writeClipboardImage } = require('../electron/desktopFunctions');
const { createMediaManager } = require('../electron/mediaManager');
const root = path.resolve(__dirname, '..'), work = fs.mkdtempSync(path.join(os.tmpdir(), 'law-functions-'));
app.setPath('userData', path.join(work, 'profile'));
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
let win, mediaWin, child, capture, realMedia, lastClipboard, backup;
async function readImage() {
  const item = (await clipboard.read()).find(item => item.types.includes('image/png'));
  return item ? nativeImage.createFromBuffer(Buffer.from(await (await item.getType('image/png')).arrayBuffer())) : nativeImage.createEmpty();
}
const checks = [], captures = [], actions = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, timeout = 20000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await pause(100); } throw Error('Timed out: ' + label); }
app.whenReady().then(async () => {
  backup = await Promise.all((await clipboard.read()).filter(item => item.types.length).map(async item => new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)]))))));
  const actualClipboard = { async writeImage(image) { await clipboard.write([new ClipboardItem({ 'image/png': new Blob([image.toPNG()], { type: 'image/png' }) })]); lastClipboard = (await readImage()).toPNG(); } };
  child = spawn(path.join(root, 'venv', 'Scripts', 'python.exe'), [path.join(__dirname, 'qa-generation-controls-fixture.py'), work], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.on('data', bytes => process.stderr.write(bytes));
  const connection = await new Promise((resolve, reject) => { let out = ''; const timer = setTimeout(() => reject(Error('Fixture startup')), 25000); child.once('error', reject); child.stdout.on('data', bytes => { out += bytes; if (out.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(out.split('\n')[0])); } }); });
  const api = async (route, options = {}) => { const response = await fetch(connection.base + route, { ...options, headers: { 'X-LAW-Session': connection.token, 'Content-Type': 'application/json', ...options.headers } }); if (!response.ok) throw Error(route + ': ' + response.status); return response.json(); };
  await until(async () => { try { await api('/sessions/list'); return true; } catch { return false; } }, 'fixture ready');
  protocol.handle('app', async request => { const response = await net.fetch(pathToFileURL(appAsset(process.env.LAW_QA_DIST || path.join(root, 'tmp', 'functions-check-dist'), request.url)).toString()); return new Response(response.body, { headers: { ...Object.fromEntries(response.headers), ...APP_HEADERS } }); });
  win = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { preload: path.join(root, 'electron', 'preload.js'), contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
  mediaWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, offscreen: true, backgroundThrottling: false } });
  await mediaWin.loadURL('data:text/html,' + encodeURIComponent('<style>body{margin:0;background:#152132;color:white;font:18px sans-serif}input{font:inherit}</style><h1>Media capture fixture</h1><input value="saved"><canvas width="80" height="80"></canvas>'));
  await mediaWin.webContents.executeJavaScript(`document.querySelector('input').value='unsaved media filter';document.querySelector('canvas').getContext('2d').fillRect(0,0,80,80)`);
  if (process.env.LAW_QA_MEDIA_DIRECTORY) realMedia = createMediaManager({ WebContentsView, session, getWindow: () => win,
    python: path.join(root, 'venv', 'Scripts', 'python.exe'), directory: process.env.LAW_QA_MEDIA_DIRECTORY, reports: path.join(work, 'media-reports'),
    spawnProcess: (exe, args, options) => spawn(exe, ['-B', ...args], options) });
  capture = createTabCapture({ BrowserWindow, screen, clipboard: actualClipboard, getWindow: () => win, mediaManager: realMedia || { snapshot: () => mediaWin.webContents.executeJavaScript('(' + snapshotDocument.toString() + ')({embedded:true})') } });
  const trusted = event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && trustedUrl(event.senderFrame.url);
  ipcMain.on('app:connection', event => { event.returnValue = trusted(event) ? connection : null; });
  ipcMain.handle('media-manager:place', () => {});
  ipcMain.handle('maintenance:import-status', () => ({ active: false }));
  ipcMain.handle('functions:copy-image', (event, data) => { assert(trusted(event)); return writeClipboardImage(data, { clipboard: actualClipboard, nativeImage }); });
  ipcMain.handle('functions:run-action', (event, action) => { assert(trusted(event)); actions.push(action); return { ok: true }; });
  ipcMain.handle('functions:capture-tab', async (event, tab) => { assert(trusted(event)); try { const result = await capture.capture(tab); captures.push(result); return result; } catch (error) { return { error: error.message }; } });
  const js = async code => { try { return await win.webContents.executeJavaScript(code); } catch (error) { throw Error(error.message + '\nCode: ' + code.slice(0, 600)); } };
  const click = (text, selector = 'body') => js(`(()=>{const scope=document.querySelector(${JSON.stringify(selector)}); const button=[...scope.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}||b.querySelector('strong')?.textContent===${JSON.stringify(text)}); if(!button||button.disabled)throw Error('Missing/disabled button: '+${JSON.stringify(text)});button.click();})()`);
  const set = (selector, value) => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}); if(!e)throw Error('Missing input'); const p=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
  const nav = tab => js(`document.querySelector('[data-sidebar-route="${tab}"]').click()`);
  const rows = () => fs.existsSync(path.join(work, 'generation.jsonl')) ? fs.readFileSync(path.join(work, 'generation.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  await win.loadURL('app://local/index.html');
  await until(() => js("!!document.querySelector('#image-studio')"), 'app mounted');
  await nav('tools');
  assert.equal(await js("document.querySelectorAll('.functions-workspace button').length"), 19); // Add + Markdown + 2 actions + 15 captures
  await click('+ Add Button'); await set('.functions-editor input', 'My capture'); await set('.functions-editor select', 'capture:generate'); await click('Save button');
  assert(await js("localStorage.getItem('local-ai-workstation-function-buttons-v1').includes('capture:generate')"));
  await click('Update Installed Programs'); await until(() => js("!document.querySelector('.function-launcher:disabled')"), 'mock updater');
  await click('Refresh GPU Driver'); await until(() => actions.length === 2, 'mock graphics reset');
  checks.push('All 15 capture buttons, two fixed system actions, and persisted custom action shortcuts');

  await nav('generate');
  await until(() => js("!!document.querySelector('#image-studio option[value=\"qa-image\"]')"), 'image catalog');
  await set('#image-studio .image-studio-controls > label select', 'qa-image');
  await set('#image-studio textarea', 'Original unsent prompt');
  await click('Edit Image Request Before Send', '#image-studio');
  await until(() => js("!!document.querySelector('.image-request-editor[open]')"), 'request editor');
  await set('.image-request-editor textarea', 'Cancelled edit'); await click('Cancel', '.image-request-editor');
  assert.equal(await js("document.querySelector('#image-studio textarea').value"), 'Original unsent prompt'); assert.equal(rows().length, 0);
  await click('Edit Image Request Before Send', '#image-studio');
  await set('.image-request-editor textarea', 'Edited request sent'); await click('Send Request', '.image-request-editor');
  await until(() => rows().length === 1, 'one submitted request');
  assert.equal(rows()[0].prompt, 'Edited request sent');
  await until(() => js("!!document.querySelector('.image-studio-result img')?.naturalWidth"), 'generated image');
  await click('Copy Image', '#image-studio');
  await until(() => !!lastClipboard, 'clipboard image');
  assert.equal((await readImage()).getSize().width, 1024);
  checks.push('Request editing cancels without submitting or changing the original; Send submits exactly one edited request; Copy Image writes a real 1024-pixel clipboard image');

  await js("document.querySelector('#image-studio').scrollTop=300");
  const scroll = await js("document.querySelector('#image-studio').scrollTop");
  const sticky = await js("(()=>{const b=document.querySelector('.generate-shortcut').getBoundingClientRect(),p=document.querySelector('#image-studio').getBoundingClientRect();return b.top>=p.top&&b.bottom<=p.bottom})()");
  assert(sticky);
  await click('Jump to Chat →', '#image-studio');
  assert.equal(await js("document.querySelector('[data-capture-tab=chats]').hidden"), false);
  await nav('generate'); assert.equal(await js("document.querySelector('#image-studio').scrollTop"), scroll);
  await nav('queue');
  await until(() => js("!!document.querySelector('.queue-open')"), 'queue result');
  await js("document.querySelector('.queue-open').click()");
  await until(() => js("!document.querySelector('[data-capture-tab=chats]').hidden"), 'queue opens submitting chat');
  checks.push('Floating Jump to Chat remains in view and preserves Generate scroll; queue image result opens its submitting chat');

  await nav('tools'); await click('Markdown Viewer', '.functions-workspace');
  await set('#markdown-source', '# Unsaved Markdown\n\nDo not change me');
  await click('← Functions');
  await click('My capture', '.functions-workspace');
  await until(() => js("document.querySelector('.functions-workspace [role=status]').textContent.includes('Screenshot copied')"), 'custom capture button writes image');
  captures.length = 0;
  await js("document.querySelector('.functions-workspace button').focus()");
  const before = await js("JSON.stringify({tab:localStorage.getItem('local-ai-workstation-navigation-v1'),focus:document.activeElement.textContent,prompt:document.querySelector('#image-studio textarea').value,markdown:document.querySelector('#markdown-source').value,scroll:document.querySelector('#image-studio').scrollTop})");
  const commandsBefore = rows().length;
  for (const tab of Object.keys(TAB_LABELS)) {
    const result = await js(`window.workstationDesktop.captureTab(${JSON.stringify(tab)})`);
    assert(result.ok, tab + ': ' + result.error);
    const image = await readImage(); assert(hasVisibleContent(image), tab + ' is blank'); assert.equal(image.getSize().width, result.width);
    fs.writeFileSync(path.join(work, `capture-${tab}.png`), image.toPNG());
    assert.equal(win.isVisible(), false); assert.equal(mediaWin.isVisible(), false);
    const after = await js("JSON.stringify({tab:localStorage.getItem('local-ai-workstation-navigation-v1'),focus:document.activeElement.textContent,prompt:document.querySelector('#image-studio textarea').value,markdown:document.querySelector('#markdown-source').value,scroll:document.querySelector('#image-studio').scrollTop})");
    assert.equal(after, before, tab + ' changed source state');
  }
  assert.equal(rows().length, commandsBefore);
  assert.equal(captures.length, 15);
  const bad = await js("window.workstationDesktop.captureTab('invalid')"); assert(bad.error);
  checks.push('All 15 captures produce actual clipboard images at desktop dimensions, including embedded Media Manager; original focus, tab, unsaved text and scroll remain identical; no duplicate generation');
  const result = { ok: true, work, checks, captures, systemActions: 'mocked', realMediaManager: !!realMedia };
  fs.writeFileSync(path.join(work, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}).catch(error => { console.error(error.stack); fs.writeFileSync(path.join(work, 'result.json'), JSON.stringify({ ok: false, work, checks, error: error.stack }, null, 2)); process.exitCode = 1; }).finally(async () => {
  capture?.dispose(); realMedia?.dispose(); win?.destroy(); mediaWin?.destroy();
  if (backup && lastClipboard && (await readImage()).toPNG().equals(lastClipboard)) { if (backup.length) await clipboard.write(backup); else clipboard.clear(); }
  child?.stdin.write('\n');
  if (child) await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(5000)]);
  child?.kill(); app.exit(process.exitCode || 0);
});
