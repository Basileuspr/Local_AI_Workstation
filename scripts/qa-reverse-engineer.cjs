// Full renderer with synthetic APIs and launcher results in a disposable profile.
// No real tool installations, target programs, files or analysis are opened.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
if (!process.versions.electron) {
  const { spawn } = require('node:child_process'), env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename], { env, windowsHide: true, stdio: 'inherit' });
  child.on('error', error => { console.error(error); process.exitCode = 1; }); child.on('exit', code => { process.exitCode = code; });
} else {
  const { app, BrowserWindow, protocol } = require('electron');
  const { appAsset, APP_HEADERS } = require('../electron/security');
  const root = path.resolve(__dirname, '..'), work = fs.mkdtempSync(path.join(os.tmpdir(), 'law-reverse-engineer-'));
  app.setPath('userData', path.join(work, 'profile')); app.disableHardwareAcceleration();
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
  let win; const checks = [], sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const timeout = setTimeout(() => { console.error('Reverse Engineer QA timed out', work); app.exit(1); }, 180000);
  app.whenReady().then(async () => {
    const { build } = await import('vite'), react = (await import('@vitejs/plugin-react')).default;
    await build({ configFile: false, root, base: './', plugins: [react()], logLevel: 'error', worker: { format: 'es' }, assetsInclude: ['**/*.bin'],
      define: { __LAW_BUILD_INFO__: JSON.stringify({ build_id: 'reverse-engineer-diagnostic' }) },
      build: { outDir: path.join(work, 'dist'), emptyOutDir: true, rollupOptions: { input: path.join(root, 'tests/fixtures/workspaceControls.html') } } });
    protocol.handle('app', request => { const file = appAsset(path.join(work, 'dist'), request.url); return new Response(fs.readFileSync(file), { headers: { ...APP_HEADERS,
      'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' }[path.extname(file)] || 'application/octet-stream') } }); });
    win = new BrowserWindow({ show: false, width: 1440, height: 1080, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const external = []; win.webContents.setWindowOpenHandler(({ url }) => { external.push(url); return { action: 'deny' }; });
    const js = code => win.webContents.executeJavaScript(code);
    const until = async (code, label) => { for (let i = 0; i < 240; i++) { if (await js(code)) return; await sleep(40); } throw Error(`Timed out: ${label}`); };
    const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const input = (selector, value) => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const route = async id => { await click(`[data-sidebar-route="${id}"]`); await until(`!!document.querySelector('[data-capture-tab="${id}"]:not([hidden])')`, id); };
    const capture = async name => { const [width, height] = win.getSize(); win.setSize(width + 1, height); await sleep(100); win.setSize(width, height); win.webContents.invalidate(); await sleep(240); fs.writeFileSync(path.join(work, name), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); };
    const key = 'local-ai-workstation-reverse-engineer-v1', id = '12345678-1234-1234-1234-123456789abc';
    await win.loadURL('app://local/tests/fixtures/workspaceControls.html');
    await until("!!document.querySelector('[data-sidebar-route=\"reverse-engineer\"]')", 'main tab');
    await js(`window.reQA={chooses:0,opens:[],next:{id:${JSON.stringify(id)},name:'Ghidra.lnk'},failure:''};
      window.workstationDesktop.chooseProgram=async()=>{window.reQA.chooses++;await new Promise(r=>setTimeout(r,80));return window.reQA.next};
      window.workstationDesktop.openProgram=async id=>{window.reQA.opens.push(id);return window.reQA.failure?{error:window.reQA.failure}:{ok:true}};void 0;`);
    await route('reverse-engineer');
    await until("document.querySelectorAll('[data-re-tool]').length===5", 'all five tools');
    assert(await js("!!document.querySelector('.sidebar-utilities [data-sidebar-route=\"reverse-engineer\"]')"));
    assert.equal(await js('window.reQA.chooses'), 0); assert.deepEqual(await js('window.reQA.opens'), []);
    assert(await js("document.querySelector('[aria-label=\"Launch Ghidra\"]').disabled"));
    checks.push('Main-bar tab renders five distinct tools without selecting programs or launching anything');

    await input('.re-filters input[type=search]', 'android');
    assert.deepEqual(await js("[...document.querySelectorAll('[data-re-tool]')].map(e=>e.dataset.reTool)"), ['jadx', 'frida']);
    await input('.re-filters input[type=search]', 'unmatched-tool');
    assert(await js("!!document.querySelector('.re-empty')")); await click('.re-empty button');
    await js("document.querySelector('.re-filters select').value='.NET';document.querySelector('.re-filters select').dispatchEvent(new Event('change',{bubbles:true}))");
    assert.deepEqual(await js("[...document.querySelectorAll('[data-re-tool]')].map(e=>e.dataset.reTool)"), ['dnspyex']);
    await click('.re-filters button');
    checks.push('Search, category filtering, empty state and reset work');

    await js("const b=document.querySelector('[aria-label=\"Choose program for Ghidra\"]');b.click();b.click()");
    await until("document.querySelector('.re-status').textContent.includes('launcher saved')", 'saved launcher');
    assert.equal(await js('window.reQA.chooses'), 1); assert.deepEqual(await js('window.reQA.opens'), []);
    assert.equal(await js(`JSON.parse(localStorage.getItem(${JSON.stringify(key)})).ghidra.id`), id);
    await click('[aria-label="Launch Ghidra"]'); await until('window.reQA.opens.length===1', 'launch');
    assert.deepEqual(await js('window.reQA.opens'), [id]);
    await js("window.reQA.failure='Program was moved'"); await click('[aria-label="Launch Ghidra"]');
    await until("document.querySelector('.re-error')?.textContent.includes('Program was moved')", 'launch error');
    await js('window.reQA.next=null'); await click('[aria-label="Choose program for Ghidra"]');
    await until("!document.querySelector('[aria-label=\"Choose program for Ghidra\"]').disabled", 'cancel picker');
    assert.equal(await js(`JSON.parse(localStorage.getItem(${JSON.stringify(key)})).ghidra.id`), id);
    checks.push('Native picker requests are serialized; selection saves without launch; launch passes only its ID; errors and picker cancellation preserve settings');

    await click('.re-linked-filter input'); assert.equal(await js("document.querySelectorAll('[data-re-tool]').length"), 1);
    await click('.re-linked-filter input');
    await click('[data-re-tool="ghidra"] summary');
    await capture('reverse-engineer-desktop.png');
    await click('[aria-label="Documentation for Ghidra"]');
    await sleep(100);
    assert.deepEqual(external, ['https://github.com/NationalSecurityAgency/ghidra']);
    await win.reload(); await until("!!document.querySelector('[data-sidebar-route=\"reverse-engineer\"]')", 'reload'); await route('reverse-engineer');
    await until("document.querySelector('[data-re-tool=\"ghidra\"]')?.textContent.includes('Ghidra.lnk')", 'persisted choice');
    assert(await js("document.querySelector('[aria-label=\"Launch Ghidra\"]').disabled"));
    checks.push('Saved launcher survives reload; browser-only view disables native actions; official documentation opens the expected URL');

    await js(`window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===${JSON.stringify(key)})throw Error('Storage full');return window.originalSetItem.call(this,k,v)};void 0;`);
    await click('[aria-label="Unlink Ghidra"]');
    await until("document.querySelector('.re-error')?.textContent.includes('Storage full')", 'storage error');
    assert.equal(await js(`JSON.parse(localStorage.getItem(${JSON.stringify(key)})).ghidra.id`), id);
    await js('Storage.prototype.setItem=window.originalSetItem;void 0;');
    await click('[aria-label="Unlink Ghidra"]');
    await until("!document.querySelector('[aria-label=\"Unlink Ghidra\"]')", 'unlink');
    assert.deepEqual(await js(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`), {});
    checks.push('Storage write failures preserve the old association; Unlink removes only the saved association');

    await js(`localStorage.setItem(${JSON.stringify(key)},'{damaged');window.dispatchEvent(new StorageEvent('storage',{key:${JSON.stringify(key)}}))`);
    await until("document.querySelector('.re-error')?.textContent.includes('preserved')", 'damaged storage');
    assert.equal(await js(`localStorage.getItem(${JSON.stringify(key)})`), '{damaged');
    await js(`localStorage.setItem(${JSON.stringify(key)},'{}');window.dispatchEvent(new StorageEvent('storage',{key:${JSON.stringify(key)}}))`);
    await until("!document.querySelector('.re-error')?.textContent.includes('preserved')", 'repaired storage');
    const installedId = '87654321-1234-1234-1234-123456789abc';
    await js(`window.reQA={opens:[],missing:false};
      window.workstationDesktop.chooseProgram=async()=>({id:${JSON.stringify(id)},name:'Custom Ghidra.lnk'});
      window.workstationDesktop.openProgram=async id=>{window.reQA.opens.push(id);return {ok:true}};
      window.workstationDesktop.reverseEngineerInstallations=async()=>({tools:Object.fromEntries(['ghidra','dnspyex','jadx','x64dbg','frida'].map(key=>[key,{id:${JSON.stringify(installedId)},name:key,version:'test',available:!window.reQA.missing,detail:'Installation files are missing.'}]))});void 0;`);
    await route('dashboard'); await route('reverse-engineer');
    await until("document.querySelectorAll('.re-is-linked').length===5", 'installed defaults');
    assert.deepEqual(await js('window.reQA.opens'), []);
    assert.equal(await js("document.querySelectorAll('[data-re-tool] .re-guide li').length"), 15);
    await click('.re-tasks button');
    assert.equal(await js("document.querySelectorAll('[data-re-tool]').length"), 1);
    assert(await js("document.querySelector('.re-guide').open"));
    await click('[aria-label="Launch Ghidra"]'); await until('window.reQA.opens.length===1', 'installed launch');
    assert.deepEqual(await js('window.reQA.opens'), [installedId]);
    await js('window.reQA.missing=true'); await click('[aria-label="Launch Ghidra"]');
    await until("document.querySelector('.re-error')?.textContent.includes('missing')", 'missing installation at launch');
    assert.equal(await js('window.reQA.opens.length'), 1);
    assert(await js("document.querySelector('[aria-label=\"Launch Ghidra\"]').disabled"));
    await js('window.reQA.missing=false');
    await click('[aria-label="Choose program for Ghidra"]');
    await until("document.querySelector('.re-status').textContent.includes('launcher saved')", 'override installed default');
    await click('[aria-label="Launch Ghidra"]'); await until('window.reQA.opens.length===2', 'custom launch');
    assert.equal(await js('window.reQA.opens[1]'), id);
    await click('.re-install-status button'); await until("document.querySelector('[aria-label=\"Unlink Ghidra\"]').textContent==='Use installed version'", 'restore default control');
    await click('[aria-label="Unlink Ghidra"]');
    await until("document.querySelector('.re-status').textContent.includes('installed version')", 'restored default');
    await click('[aria-label="Launch Ghidra"]'); await until('window.reQA.opens.length===3', 'default launch after override');
    assert.equal(await js('window.reQA.opens[2]'), installedId);
    await capture('reverse-engineer-guided.png');
    await click('.re-filters button');
    await click('.re-linked-filter input'); assert.equal(await js("document.querySelectorAll('[data-re-tool]').length"), 5);
    await click('.re-linked-filter input');
    await capture('reverse-engineer-installed.png');
    checks.push('Installed defaults are passive; task selector expands first steps; launch rechecks missing files; custom choice overrides default; reset restores default; linked filter includes installations');
    win.setSize(420, 980); await sleep(200); await js("document.querySelector('.reverse-engineer').scrollTop=0");
    await capture('reverse-engineer-narrow.png');
    assert(await js('document.documentElement.scrollWidth<=innerWidth'));
    assert(await js("(()=>{const p=document.querySelector('.reverse-engineer');return p.scrollWidth<=p.clientWidth+1})()"));
    await js("document.querySelector('[data-re-tool=\"frida\"]').scrollIntoView({block:'end'})");
    await capture('reverse-engineer-narrow-bottom.png');
    assert(await js("(()=>{const p=document.querySelector('.reverse-engineer');return p.scrollWidth<=p.clientWidth+1})()"));
    checks.push('Damaged storage is preserved; cards and controls fit and scroll at 420 px');
    assert.deepEqual(await js('window.workspaceControlsQA.errors'), []);
    fs.writeFileSync(path.join(work, 'report.json'), JSON.stringify({ ok: true, checks }, null, 2));
    console.log(JSON.stringify({ ok: true, checks, artifacts: work }, null, 2));
  }).catch(async error => {
    console.error(error); if (win) { fs.writeFileSync(path.join(work, 'failure.txt'), await win.webContents.executeJavaScript('document.body.innerText')); fs.writeFileSync(path.join(work, 'failure.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); }
    console.error('Artifacts:', work); process.exitCode = 1;
  }).finally(() => { clearTimeout(timeout); win?.destroy(); app.exit(process.exitCode || 0); });
}
