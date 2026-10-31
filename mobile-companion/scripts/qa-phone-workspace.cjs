// Full renderer, synthetic desktop APIs and a disposable profile. No live phone access.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
if (!process.versions.electron) {
  const { spawn } = require('node:child_process'), env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename], { env, windowsHide: true, stdio: 'inherit' });
  child.on('error', error => { console.error(error); process.exitCode = 1; }); child.on('exit', code => { process.exitCode = code; });
} else {
  const { app, BrowserWindow, protocol } = require('electron');
  const { appAsset, APP_HEADERS } = require('../../electron/security');
  const root = path.resolve(__dirname, '../..'), work = fs.mkdtempSync(path.join(os.tmpdir(), 'law-phone-workspace-'));
  app.setPath('userData', path.join(work, 'profile')); app.disableHardwareAcceleration();
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
  let win; const checks = [], sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const timeout = setTimeout(() => { console.error('Phone QA timed out', work); app.exit(1); }, 180000);
  app.whenReady().then(async () => {
    const { build } = await import('vite'), react = (await import('@vitejs/plugin-react')).default;
    await build({ configFile: false, root, base: './', plugins: [react()], logLevel: 'error', worker: { format: 'es' }, assetsInclude: ['**/*.bin'],
      define: { __LAW_BUILD_INFO__: JSON.stringify({ build_id: 'phone-diagnostic' }) },
      build: { outDir: path.join(work, 'dist'), emptyOutDir: true, rollupOptions: { input: path.join(root, 'tests/fixtures/workspaceControls.html') } } });
    protocol.handle('app', request => { const file = appAsset(path.join(work, 'dist'), request.url); return new Response(fs.readFileSync(file), { headers: { ...APP_HEADERS,
      'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' }[path.extname(file)] || 'application/octet-stream') } }); });
    win = new BrowserWindow({ show: false, width: 1440, height: 1080, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const external = []; win.webContents.setWindowOpenHandler(({ url }) => { external.push(url); return { action: 'deny' }; });
    const js = code => win.webContents.executeJavaScript(code);
    const until = async (code, label) => { for (let i = 0; i < 240; i++) { if (await js(code)) return; await sleep(40); } throw Error(`Timed out: ${label}`); };
    const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const route = async id => { await click(`[data-sidebar-route="${id}"]`); await until(`!!document.querySelector('[data-capture-tab="${id}"]:not([hidden])')`, id); };
    const section = async label => { await js(`[...document.querySelectorAll('.phone-sections button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`); await sleep(80); };
    const capture = async name => { const [width, height] = win.getSize(); win.setSize(width + 1, height); await sleep(100); win.setSize(width, height); win.webContents.invalidate(); await sleep(220); fs.writeFileSync(path.join(work, name), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); };
    await win.loadURL('app://local/tests/fixtures/workspaceControls.html');
    await until("!!document.querySelector('[data-sidebar-route=\"phone\"]')", 'Phone navigation');
    await route('phone'); await until("!!document.querySelector('.phone-workspace')", 'Phone workspace');
    assert(await js("document.querySelector('.phone-refresh').disabled"));
    assert.equal(await js("document.querySelectorAll('.phone-tool').length"), 2);
    checks.push('Browser view opens Phone with native actions disabled and setup guides available');
    await js(`window.phoneQA={status:0,choose:0,reset:0,cancel:false,failure:'',mobile:[]};
      window.phoneReport={supported:true,checkedAt:new Date().toISOString(),tools:{
        kdeconnect:{status:'found',directory:'C:/Phone Tools/KDE Connect/bin',selectedDirectory:null,missing:[]},
        scrcpy:{status:'found',directory:'C:/Phone Tools/scrcpy-win64-v3.3.4',selectedDirectory:null,missing:[]}}};
      window.workstationDesktop.phoneToolsStatus=async()=>{phoneQA.status++;return phoneQA.failure?{error:phoneQA.failure}:structuredClone(phoneReport)};
      window.workstationDesktop.choosePhoneToolFolder=async id=>{phoneQA.choose++;await new Promise(r=>setTimeout(r,100));if(phoneQA.cancel)return {canceled:true};phoneReport.tools[id].selectedDirectory='C:/Chosen Tools';return structuredClone(phoneReport)};
      window.workstationDesktop.resetPhoneToolFolder=async id=>{phoneQA.reset++;phoneReport.tools[id].selectedDirectory=null;return structuredClone(phoneReport)};
      const fixtureFetch=window.fetch;window.fetch=(url,options={})=>{if(new URL(url).pathname.startsWith('/mobile')){phoneQA.mobile.push({path:new URL(url).pathname,method:options.method||'GET'});return Promise.resolve(new Response(JSON.stringify({running:false,build_ready:true,devices:[],connections:[],listen:{origin:'https://desktop.example.ts.net',address:'127.0.0.1',port:8766}}),{headers:{'Content-Type':'application/json'}}))}return fixtureFetch(url,options)};void 0;`);
    await route('chats'); await route('phone');
    await until("document.querySelectorAll('.phone-found').length===2", 'detection results');
    assert.equal(await js('phoneQA.status'), 1);
    assert.deepEqual(await js('phoneQA.mobile'), []);
    await capture('phone-desktop.png');
    await js("const b=document.querySelector('[aria-label=\"Choose folder for scrcpy\"]');b.click();b.click()");
    await until("!!document.querySelector('[aria-label=\"Use automatic detection for scrcpy\"]')", 'folder choice');
    assert.equal(await js('phoneQA.choose'), 1);
    await js('phoneQA.cancel=true'); await click('[aria-label="Choose folder for scrcpy"]');
    await until("!document.querySelector('.phone-refresh').disabled", 'picker cancellation');
    assert(await js("!!document.querySelector('[aria-label=\"Use automatic detection for scrcpy\"]')"));
    await click('[aria-label="Use automatic detection for scrcpy"]');
    await until("!document.querySelector('[aria-label=\"Use automatic detection for scrcpy\"]')", 'reset');
    assert.equal(await js('phoneQA.reset'), 1);
    await js("phoneQA.failure='Detection unavailable'"); await click('.phone-refresh');
    await until("document.querySelector('.phone-error')?.textContent.includes('Detection unavailable')", 'error');
    assert.equal(await js("document.querySelectorAll('.phone-found').length"), 2);
    await js("phoneQA.failure=''"); await click('.phone-refresh'); await until("!document.querySelector('.phone-error')", 'recovery');
    checks.push('Detection, duplicate-click protection, native picker cancellation, reset and error recovery preserve valid results');
    await section('Screen'); assert(await js("document.querySelector('.phone-section-intro').textContent.includes('later phase')"));
    await section('Notifications'); assert(await js("document.querySelector('.phone-guide').textContent.includes('does not request, read, or test notifications')"));
    await section('Messages'); await section('Files & photos');
    assert.deepEqual(await js('phoneQA.mobile'), []);
    await section('Companion');
    await click('.phone-companion .mobile-control button[aria-expanded]');
    await until("document.querySelector('.phone-companion input')?.value==='https://desktop.example.ts.net'", 'existing Companion setup');
    assert(await js('phoneQA.mobile.length>0 && phoneQA.mobile.every(r=>r.method===\'GET\')'));
    await section('Overview'); await section('Companion');
    await until("document.querySelector('.phone-companion input')?.value==='https://desktop.example.ts.net'", 'retained Companion form');
    await route('dashboard');
    assert(await js("!!document.querySelector('[data-capture-tab=\"dashboard\"] .mobile-control')"));
    checks.push('Setup sections perform no phone actions; original Companion controls remain on Dashboard and Phone with existing setup preserved');
    await route('phone'); await section('Overview');
    await click('[data-phone-tool="kdeconnect"] a'); await sleep(80);
    assert.deepEqual(external, ['https://kdeconnect.kde.org/download.html']);
    win.setSize(420, 980); await sleep(150); await js("document.querySelector('.phone-workspace').scrollTop=0");
    await capture('phone-narrow.png');
    assert(await js("(()=>{const p=document.querySelector('.phone-workspace');return p.scrollWidth<=p.clientWidth+1})()"));
    assert(await js('document.documentElement.scrollWidth<=innerWidth'));
    await js("document.querySelector('.phone-next').scrollIntoView({block:'end'})"); await capture('phone-narrow-bottom.png');
    checks.push('Official links open the expected URL and the workspace fits a 420 px window');
    assert.deepEqual(await js('window.workspaceControlsQA.errors'), []);
    fs.writeFileSync(path.join(work, 'report.json'), JSON.stringify({ ok: true, checks }, null, 2));
    console.log(JSON.stringify({ ok: true, checks, artifacts: work }, null, 2));
  }).catch(async error => {
    console.error(error); if (win) { fs.writeFileSync(path.join(work, 'failure.txt'), await win.webContents.executeJavaScript('document.body.innerText')); fs.writeFileSync(path.join(work, 'failure.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); }
    console.error('Artifacts:', work); process.exitCode = 1;
  }).finally(() => { clearTimeout(timeout); win?.destroy(); app.exit(process.exitCode || 0); });
}
