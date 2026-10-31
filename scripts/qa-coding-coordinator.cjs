const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename], { env, windowsHide: true, stdio: 'inherit' });
  child.on('error', error => { console.error(error); process.exitCode = 1; }); child.on('exit', code => { process.exitCode = code; });
} else {
  const { app, BrowserWindow, protocol } = require('electron');
  const { appAsset, APP_HEADERS } = require('../electron/security');
  const root = path.resolve(__dirname, '..'), work = fs.mkdtempSync(path.join(os.tmpdir(), 'law-coding-ui-'));
  app.setPath('userData', path.join(work, 'profile')); app.disableHardwareAcceleration();
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
  const timer = setTimeout(() => app.exit(1), 120000);
  app.whenReady().then(async () => {
    const { build } = await import('vite'), react = (await import('@vitejs/plugin-react')).default;
    await build({ configFile: false, root, base: './', plugins: [react()], logLevel: 'error',
      build: { outDir: path.join(work, 'dist'), rollupOptions: { input: path.join(root, 'tests/fixtures/codingCoordinator.html') } } });
    protocol.handle('app', request => { const file = appAsset(path.join(work, 'dist'), request.url); return new Response(fs.readFileSync(file), { headers: { ...APP_HEADERS,
      'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream') } }); });
    const win = new BrowserWindow({ show: false, width: 1400, height: 1050, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const errors = []; win.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
    const js = code => win.webContents.executeJavaScript(code), sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const until = async code => { for (let i = 0; i < 100; i++) { if (await js(code)) return; await sleep(50); } throw Error('Timed out: ' + code); };
    const button = label => js(`[...document.querySelectorAll('button')].find(button=>button.textContent===${JSON.stringify(label)}).click()`);
    await win.loadURL('app://local/tests/fixtures/codingCoordinator.html');
    await until("document.querySelector('select')?.options.length===3");
    assert(await js("[...document.querySelectorAll('button')].find(b=>b.textContent==='Start coding task').disabled"));
    await button('Choose project…'); await until("document.querySelector('.verification-environment')?.textContent.includes('Python')");
    assert.equal(await js("window.codingCalls.filter(c=>c.action==='start').length"), 0);
    assert.equal(await js("document.querySelectorAll('.verification-check').length"), 4);
    assert(await js("document.querySelector('.coding-verification').textContent.includes('no database execution') && document.querySelector('.coding-verification').textContent.includes('javac -proc:none')"));
    assert(await js("!document.querySelector('.verification-custom').open"));
    await js(`(()=>{const e=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Fix add so it returns the sum, preserving user notes.');e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.coding-consent input').click();const p=document.querySelector('input[placeholder="For example: frontend changes"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(p,'Daily checks');p.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await button('Save profile'); await until("document.querySelector('[aria-label=\"Saved verification profile\"]').options.length===2");
    await button('Approve selected detected checks'); await until("document.querySelector('.verification-check-title').textContent.includes('approved definition')");
    await button('Forget saved approvals'); await until("document.querySelector('.verification-check-title').textContent.includes('approval needed')");
    await js("document.querySelector('[aria-label=\"Saved verification profile\"]').value='Daily checks';document.querySelector('[aria-label=\"Saved verification profile\"]').dispatchEvent(new Event('change',{bubbles:true}))");
    await js("document.querySelector('.coding-workspace').scrollTop=0");
    win.setSize(1401, 1050); await sleep(100); win.setSize(1400, 1050); win.webContents.invalidate(); await sleep(350);
    fs.writeFileSync(path.join(work, 'desktop.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    await until("![...document.querySelectorAll('button')].find(b=>b.textContent==='Start coding task').disabled");
    await button('Start coding task'); await until("!!document.querySelector('.verification-approval')");
    assert.equal(await js("window.codingCalls.filter(c=>c.action==='start').length"), 1);
    assert.equal(await js("window.codingCalls.find(c=>c.action==='start').model"), 'gpt-oss:20b');
    assert(await js("document.querySelector('.verification-history').textContent.includes('No checks have run')"));
    await button('Approve for this task'); await until("document.querySelector('.coding-status')?.textContent.includes('completed')");
    assert(await js("document.querySelector('.coding-result').textContent.includes('arithmetic.py')"));
    assert(await js("document.querySelector('.verification-history').textContent.includes('Python tests') && !!document.querySelector('.verification-badge.passed')"));
    assert(await js("!!document.querySelector('.verification-badge.not_run')"));
    assert(await js("document.querySelector('.coding-result').textContent.includes('user-notes.txt')"));
    win.setSize(1401, 1050); await sleep(100); win.setSize(1400, 1050); win.webContents.invalidate(); await sleep(350);
    fs.writeFileSync(path.join(work, 'history.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    win.setSize(620, 1000); await sleep(250);
    assert(await js('document.documentElement.scrollWidth <= innerWidth + 1'));
    fs.writeFileSync(path.join(work, 'narrow.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    await js("document.querySelector('.coding-output').scrollIntoView({block:'start'})");
    win.setSize(621, 1000); await sleep(100); win.setSize(620, 1000); win.webContents.invalidate(); await sleep(350);
    fs.writeFileSync(path.join(work, 'narrow-results.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    await js("document.querySelector('.coding-verification select:not([aria-label])').value='manual';document.querySelector('.coding-verification select:not([aria-label])').dispatchEvent(new Event('change',{bubbles:true}))");
    await button('Start coding task'); await until("document.querySelector('.verification-approval')?.textContent.includes('Run verification now')");
    await button('Finish without verification'); await until("document.querySelector('.coding-status')?.textContent.includes('needs review')");
    assert(await js("!document.querySelector('.verification-badge.passed')"));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ['read-only project inspection', 'detected checks and advanced section', 'profile save/load', 'approve/revoke definitions', 'execution approval before results', 'manual mode stays unverified when declined', 'explicit execution history', 'preserved files', 'narrow layout'], output: work }));
    clearTimeout(timer); win.destroy(); app.exit(0);
  }).catch(error => { console.error(error); clearTimeout(timer); app.exit(1); });
}
