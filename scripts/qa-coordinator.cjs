const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename], { env, windowsHide: true, stdio: 'inherit' });
  child.on('error', error => { console.error(error); process.exitCode = 1; }); child.on('exit', code => { process.exitCode = code; });
} else {
  const { app, BrowserWindow, protocol } = require('electron');
  const { appAsset, APP_HEADERS } = require('../electron/security');
  const root = path.resolve(__dirname, '..'), work = fs.mkdtempSync(path.join(os.tmpdir(), 'law-coordinator-ui-'));
  app.setPath('userData', path.join(work, 'profile')); app.disableHardwareAcceleration();
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
  const timer = setTimeout(() => app.exit(1), 120000);
  app.whenReady().then(async () => {
    const { build } = await import('vite'), react = (await import('@vitejs/plugin-react')).default;
    await build({ configFile: false, root, base: './', plugins: [react()], logLevel: 'error', build: { outDir: path.join(work, 'dist'), rollupOptions: { input: path.join(root, 'tests/fixtures/coordinator.html') } } });
    protocol.handle('app', request => { const file = appAsset(path.join(work, 'dist'), request.url); return new Response(fs.readFileSync(file), { headers: { ...APP_HEADERS, 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream') } }); });
    const win = new BrowserWindow({ show: false, width: 1400, height: 1050, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const errors = []; win.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
    const js = code => win.webContents.executeJavaScript(code), sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const until = async code => { for (let i = 0; i < 120; i++) { if (await js(code)) return; await sleep(50); } throw Error('Timed out: ' + code); };
    const button = label => js(`[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)} && b.getClientRects().length).click()`);
    const change = (selector, value) => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
    async function screenshot(name) {
      const [width, height] = win.getSize(); win.setSize(width + 1, height); await sleep(100); win.setSize(width, height); win.webContents.invalidate(); await sleep(300);
      fs.writeFileSync(path.join(work, name), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    }
    await win.loadURL('app://local/tests/fixtures/coordinator.html');
    await until("document.querySelector('[aria-label=\"Coordinator task history\"]').options.length>1");
    await change('[aria-label="Coordinator harness"]', 'research');
    await until("document.querySelector('[aria-label=\"Research & Knowledge harness\"] select').options.length>1");
    await change('[aria-label="Research & Knowledge task"]', 'Research this public evidence.');
    await change('[aria-label="Research & Knowledge harness"] select', 'fixture-model');
    await button('Start research'); await until("document.querySelector('.coordinator-research-result')");
    assert.equal(await js("window.coordinatorCalls.filter(c=>c.path.endsWith('/knowledge')).length"), 0);
    await button('Save S1 to Knowledge'); await until("document.querySelector('.coordinator-research-result button').disabled");
    await screenshot('research.png');
    await change('[aria-label="Coordinator harness"]', 'media');
    await change('[aria-label="Media Librarian task"]', 'Organize these reference images.');
    await until("document.querySelector('[aria-label=\"Media Librarian harness\"] select').options.length>1");
    await change('[aria-label="Media Librarian harness"] select', 'fixture-model');
    await button('Browse registered media'); await until("document.querySelector('.coordinator-media-list input')");
    await js("document.querySelector('.coordinator-media-list input').click()"); await button('Plan media organization');
    await until("document.querySelector('.coordinator-proposal')");
    assert.equal(await js("window.coordinatorCalls.filter(c=>c.path.endsWith('/metadata')).length"), 0);
    await js("document.querySelector('.coordinator-proposal input').click()"); await button('Apply selected metadata');
    await until("document.querySelector('.coordinator-proposal input').disabled");
    await js("document.querySelector('.coordinator-media-result+details').open=true;document.querySelector('.coordinator-check input').click()");
    // Choose the destination by its option, independent of the action selector.
    await js("(()=>{const s=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.textContent.includes('C:\\\\Fixture')));s.value='0';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await button('Prepare transfer plan'); await until("document.querySelector('.coordinator-transfer')");
    assert.equal(await js("window.coordinatorCalls.filter(c=>c.path.endsWith('/transfer')).length"), 0);
    await screenshot('media.png');
    await button('Confirm displayed copy plan'); await until("document.querySelector('dialog.action-confirmation[open]')");
    await button('Cancel');
    assert.equal(await js("window.coordinatorCalls.filter(c=>c.path.endsWith('/transfer')).length"), 0);
    await button('Confirm displayed copy plan'); await until("document.querySelector('dialog.action-confirmation[open]')");
    await button('Confirm'); await until("document.querySelector('.coordinator-transfer h4').textContent.includes('complete')");
    assert.equal(await js("window.coordinatorCalls.filter(c=>c.path.endsWith('/transfer')).length"), 1);
    await change('[aria-label="Coordinator harness"]', 'research');
    assert.equal(await js("document.querySelector('[aria-label=\"Research & Knowledge task\"]').value"), 'Research this public evidence.');
    await change('[aria-label="Coordinator task history"]', 'coding:' + 'c'.repeat(32));
    await until("document.querySelector('[aria-label=\"Coordinator harness\"]').value==='coding'");
    await until("document.querySelector('.coding-status')?.textContent.includes('completed')");
    await change('[aria-label="Coordinator harness"]', 'media'); win.setSize(620, 1000); await sleep(200);
    assert(await js('document.documentElement.scrollWidth <= innerWidth + 1'));
    await screenshot('narrow.png');
    await js("document.querySelector('[aria-label=\"Media Librarian harness\"] .coordinator-output').scrollIntoView({block:'start'})"); await screenshot('narrow-results.png');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ['harness switching and drafts', 'combined coding history', 'explicit Knowledge save', 'reviewed metadata', 'transfer preview without execution', 'narrow layout'], output: work }));
    clearTimeout(timer); win.destroy(); app.exit(0);
  }).catch(error => { console.error(error); clearTimeout(timer); app.exit(1); });
}
