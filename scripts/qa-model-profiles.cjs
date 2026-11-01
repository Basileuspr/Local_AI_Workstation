// Full renderer, synthetic API and isolated storage; never loads a real model.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename], { env, windowsHide: true, stdio: 'inherit' });
  child.on('error', error => { console.error(error); process.exitCode = 1; }); child.on('exit', code => { process.exitCode = code; });
} else {
  const { app, BrowserWindow, protocol } = require('electron');
  const { appAsset, APP_HEADERS } = require('../electron/security');
  const root = path.resolve(__dirname, '..'), work = fs.mkdtempSync(path.join(os.tmpdir(), 'law-profiles-qa-'));
  app.setPath('userData', path.join(work, 'profile')); app.disableHardwareAcceleration();
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
  let win; const checks = [], sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const timer = setTimeout(() => { console.error('Profile QA timed out', work); app.exit(1); }, 180000);
  app.whenReady().then(async () => {
    const { build } = await import('vite'), react = (await import('@vitejs/plugin-react')).default;
    await build({ configFile: false, root, base: './', plugins: [react()], logLevel: 'error', worker: { format: 'es' }, assetsInclude: ['**/*.bin'],
      define: { __LAW_BUILD_INFO__: JSON.stringify({ build_id: 'profile-diagnostic' }) },
      build: { outDir: path.join(work, 'dist'), rollupOptions: { input: path.join(root, 'tests/fixtures/modelProfiles.html') } } });
    protocol.handle('app', request => { const file = appAsset(path.join(work, 'dist'), request.url); return new Response(fs.readFileSync(file), { headers: { ...APP_HEADERS,
      'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' }[path.extname(file)] || 'application/octet-stream') } }); });
    win = new BrowserWindow({ show: false, width: 1500, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    const js = code => win.webContents.executeJavaScript(code, true);
    const until = async code => { for (let i = 0; i < 180; i++) { if (await js(code)) return; await sleep(40); } throw Error('Timed out: ' + code); };
    const field = (selector, value) => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
    const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const status = pane => js(`document.querySelector('#header${pane === 'secondary' ? '-secondary' : ''} .model-status-text').innerText`);
    const capture = async name => { const [width, height] = win.getSize(); win.setSize(width + 1, height); await sleep(100); win.setSize(width, height); win.webContents.invalidate(); await sleep(240); fs.writeFileSync(path.join(work, name), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); };
    await win.loadURL('app://local/tests/fixtures/modelProfiles.html');
    await until("document.querySelector('#model-select option[value=\"Reasoning model\"]')");
    await field('#model-select', 'Reasoning model');
    await until("document.querySelector('#header .model-status-text')?.textContent.includes('131,072')");
    assert((await status()).includes('12.8 GB'));
    await click('#header [aria-label="Chat options"]');
    await field('#header [aria-label="Session context"]', 16384);
    await field('#header [aria-label="Thinking mode"]', '"high"');
    await field('#header [aria-label="Maximum output tokens"]', 3072);
    await click('#header [aria-label="Chat options"]');
    await field('#model-select', 'Small model');
    assert((await status()).includes('4,096 context tokens'));
    assert((await status()).includes('1,024 output tokens'));
    await field('#model-select', 'Reasoning model');
    assert((await status()).includes('16,384 context tokens'));
    assert((await status()).includes('3,072 output tokens'));
    assert((await status()).includes('High (requested)'));
    checks.push('Model switching restores context, thinking and output; installed size and native limit are visible');
    await field('#chat-input', 'Check model settings'); await click('#send-btn');
    await until('window.modelProfileQA.requests.length===1');
    const request = await js('window.modelProfileQA.requests[0]');
    assert.equal(request.options.num_ctx, 16384); assert.equal(request.options.num_predict, 3072); assert.equal(request.think, 'high');
    await until("document.querySelector('#header .model-status-text').textContent.includes('420 prompt tokens')");
    assert((await status()).includes('25.0 tokens/s'));
    await field('#model-select', 'Small model'); assert(!(await status()).includes('420 prompt tokens'));
    await field('#model-select', 'Reasoning model');
    checks.push('Submitted request carries the selected profile and matching-model provider counts appear in plain text');
    await click('[aria-label="Workspace options"]'); await field('[aria-label="Pin tool beside chat"]', 'chat'); await click('[aria-label="Workspace options"]');
    await until("!document.querySelector('[data-capture-tab=second-chat]').hidden");
    await field('#model-select-secondary', 'Reasoning model');
    await click('#header-secondary [aria-label="Chat options"]');
    await field('#header-secondary [aria-label="Session context"]', 32768);
    await field('#header-secondary [aria-label="Thinking mode"]', '"low"');
    await click('#header-secondary [aria-label="Chat options"]');
    assert((await status('secondary')).includes('32,768 context tokens'));
    assert((await status()).includes('16,384 context tokens'));
    assert((await status()).includes('High (requested)'));
    await capture('model-profiles-desktop.png');
    checks.push('Two chat panes retain independent settings for the same installed model');
    await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.reload(); });
    await until("document.querySelector('#model-select option[value=\"Reasoning model\"]')");
    await field('#model-select', 'Reasoning model');
    assert((await status()).includes('16,384 context tokens'));
    if (await js("!document.querySelector('#model-select-secondary')")) {
      await click('[aria-label="Workspace options"]'); await field('[aria-label="Pin tool beside chat"]', 'chat'); await click('[aria-label="Workspace options"]');
    }
    await until("document.querySelector('#model-select-secondary option[value=\"Reasoning model\"]')");
    await field('#model-select-secondary', 'Reasoning model');
    assert((await status('secondary')).includes('32,768 context tokens'));
    checks.push('Both pane profiles survive an application reload');
    win.setSize(650, 900); await sleep(250);
    assert(await js("[...document.querySelectorAll('.model-status-text')].every(e=>e.scrollWidth<=e.clientWidth+1)"));
    await capture('model-profiles-narrow.png');
    assert.deepEqual(await js('window.workspaceControlsQA.errors'), []);
    checks.push('Plain status wraps in narrow panes without overflow or renderer errors');
    console.log(JSON.stringify({ ok: true, checks, artifacts: work }));
  }).catch(async error => { console.error(error, { checks, artifacts: work }); if (win) console.error(await win.webContents.executeJavaScript("JSON.stringify({errors:window.workspaceControlsQA?.errors,status:document.querySelector('#header')?.innerText,requests:window.modelProfileQA?.requests})")); process.exitCode = 1; }).finally(() => { clearTimeout(timer); win?.destroy(); app.exit(process.exitCode || 0); });
}
