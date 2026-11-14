// Isolated production renderer and synthetic API; no user data or real inference.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename], { env, windowsHide: true, stdio: 'inherit' });
  child.on('error', error => { console.error(error); process.exitCode = 1; }); child.on('exit', code => { process.exitCode = code; });
} else {
  const { app, BrowserWindow, protocol } = require('electron');
  const { appAsset, APP_HEADERS } = require('../electron/security');
  const root = path.resolve(__dirname, '..'), work = fs.mkdtempSync(path.join(os.tmpdir(), 'law-hardening-qa-'));
  app.setPath('userData', path.join(work, 'profile')); app.disableHardwareAcceleration();
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
  let win; const checks = [], sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const timer = setTimeout(() => { console.error('Hardening QA timed out', work); app.exit(1); }, 180000);
  app.whenReady().then(async () => {
    const { build } = await import('vite'), react = (await import('@vitejs/plugin-react')).default;
    await build({ configFile: false, root, base: './', plugins: [react()], logLevel: 'error', worker: { format: 'es' }, assetsInclude: ['**/*.bin'],
      define: { __LAW_BUILD_INFO__: JSON.stringify({ build_id: 'hardening-diagnostic' }) },
      build: { outDir: path.join(work, 'dist'), rollupOptions: { input: ['hardening', 'hardeningPolling', 'workspaceControls'].map(name => path.join(root, `tests/fixtures/${name}.html`)) } } });
    protocol.handle('app', request => { const file = appAsset(path.join(work, 'dist'), request.url); return new Response(fs.readFileSync(file), { headers: { ...APP_HEADERS,
      'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' }[path.extname(file)] || 'application/octet-stream') } }); });
    win = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    const js = code => win.webContents.executeJavaScript(code, true);
    const until = async code => { for (let i = 0; i < 200; i++) { if (await js(code)) return; await sleep(40); } throw Error('Timed out: ' + code); };
    const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const field = (selector, value) => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
    await win.loadURL('app://local/tests/fixtures/hardening.html');
    await until("!!document.querySelector('#previous .chat-message-markdown')");
    assert.equal(await js('window.hardeningQA.mounts'), 0);
    await click('#toggle'); await until("!!document.querySelector('#draft')");
    await field('#draft', 'Keep this unfinished work');
    await click('#toggle'); await sleep(80); await click('#toggle');
    assert.equal(await js("document.querySelector('#draft').value"), 'Keep this unfinished work');
    assert.deepEqual(await js('[window.hardeningQA.mounts,window.hardeningQA.unmounts]'), [1, 0]);
    checks.push('Unused workspace stays unmounted; first visit starts it once and later switches preserve its draft');
    const reads = await js('window.hardeningQA.oldContentReads');
    for (let i = 1; i <= 20; i++) { await click('#stream'); await until(`document.querySelector('#ticks').textContent==='${i}'`); }
    assert.equal(await js('window.hardeningQA.oldContentReads'), reads);
    assert(await js("document.querySelector('article#stream').textContent.includes('Reply 20')"));
    await js("[...document.querySelectorAll('#previous button')].find(button=>button.textContent==='Pin list beside chat').click()");
    await until("document.querySelector('#pin').textContent==='previous'");
    await js("[...document.querySelectorAll('#previous button')].find(button=>button.textContent==='Edit list').click()");
    await until("!!document.querySelector('#previous input')");
    assert.deepEqual(await js('window.workspaceControlsQA.errors'), []);
    checks.push('Twenty streamed updates leave completed Markdown untouched; checklist pinning and editing remain available');

    await win.loadURL('app://local/tests/fixtures/workspaceControls.html?coexistence=1');
    await until("!!document.querySelector('[data-sidebar-route=generate]')");
    const untouched = ['audio', 'faces', 'lora', 'folder-review', 'hash-auditor'];
    for (const tab of untouched) assert(await js(`(()=>{const pane=document.querySelector('[data-capture-tab="${tab}"]');return !!pane && !pane.textContent.trim();})()`), tab + ' waits for first use');
    assert(!(await js('window.workspaceControlsQA.requests')).includes('/lora/hardware'));
    checks.push('Real app startup defers unused workspaces and their initial network calls');
    await click('[data-sidebar-route=generate]');
    await until("!!document.querySelector('#image-studio textarea')");
    await field('[aria-label="Image model"]', 'preview-image');
    await field('#image-studio textarea', 'Retain this generation prompt');
    await until("!document.querySelector('.image-generate-btn').disabled"); await click('.image-generate-btn');
    await until("!!document.querySelector('[aria-label=\"Image denoising steps\"]')");
    await click('[data-sidebar-route=chats]');
    await js('window.workspaceCoexistenceQA.advance(3)');
    await until("document.querySelector('[aria-label=\"Image denoising steps\"]').value===3");
    await click('[aria-label="Workspace options"]');
    await field('[aria-label="Pin tool beside chat"]', 'generate');
    await click('[aria-label="Workspace options"]');
    await until("!document.querySelector('[data-capture-tab=generate]').hidden");
    assert.equal(await js("document.querySelector('#image-studio textarea').value"), 'Retain this generation prompt');
    assert.equal(await js('window.workspaceCoexistenceQA.stopped.length'), 0);
    assert.deepEqual(await js('window.workspaceControlsQA.errors'), []);
    win.setSize(1441, 900); await sleep(100); win.setSize(1440, 900); win.webContents.invalidate(); await sleep(300);
    fs.writeFileSync(path.join(work, 'chat-and-generation.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    checks.push('Generation continues while hidden; chat pinning reveals the same prompt and progress without cancellation');
    await win.loadURL('app://local/tests/fixtures/hardeningPolling.html');
    await until('window.taskPollingQA?.active.faces===1 && window.taskPollingQA?.active.lora===1');
    await sleep(1700);
    assert.deepEqual(await js('window.taskPollingQA.reads'), { faces: 1, lora: 1 });
    await js('window.taskPollingQA.finish=true');
    await until("document.querySelector('#face-dataset').textContent.includes('Finished faces') && document.querySelector('.face-run-history').textContent.includes('Named run history (1)')");
    await until("document.querySelector('.lora-complete-output')?.textContent.includes('completed.safetensors')");
    await sleep(2500);
    assert.deepEqual(await js('window.taskPollingQA.maximum'), { faces: 1, lora: 1 });
    assert.deepEqual(await js('window.taskPollingQA.reads'), { faces: 1, lora: 1 });
    assert.deepEqual(await js('window.workspaceControlsQA.errors'), []);
    checks.push('Slow Face and LoRA status requests never overlap; completion refreshes datasets/history/adapters and stops polling');
    console.log(JSON.stringify({ ok: true, checks, artifacts: work }));
  }).catch(async error => { console.error(error, { checks, artifacts: work }); if (win) console.error(await win.webContents.executeJavaScript('JSON.stringify(window.workspaceControlsQA?.errors)')); process.exitCode = 1; })
    .finally(() => { clearTimeout(timer); win?.destroy(); app.exit(process.exitCode || 0); });
}
