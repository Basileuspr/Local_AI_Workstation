// Full production renderer, synthetic APIs, disposable profile. No live models or data.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
if (!process.versions.electron) {
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename], {env, windowsHide: true, stdio: 'inherit'});
  child.on('error', error => {console.error(error); process.exitCode = 1;}); child.on('exit', code => {process.exitCode = code;});
} else {
  const {app, BrowserWindow, protocol} = require('electron'), {appAsset, APP_HEADERS} = require('../electron/security');
  const root = path.resolve(__dirname, '..'), work = fs.mkdtempSync(path.join(os.tmpdir(), 'law-gallery-live-'));
  app.setPath('userData', path.join(work, 'profile')); app.disableHardwareAcceleration();
  protocol.registerSchemesAsPrivileged([{scheme: 'app', privileges: {standard: true, secure: true, supportFetchAPI: true}}]);
  let win; const checks = [], sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const timer = setTimeout(() => {console.error('Gallery QA timed out', work); app.exit(1);}, 180000);
  app.whenReady().then(async () => {
    const {build} = await import('vite'), react = (await import('@vitejs/plugin-react')).default;
    await build({configFile: false, root, base: './', plugins: [react()], logLevel: 'error', worker: {format: 'es'}, assetsInclude: ['**/*.bin'],
      define: {__LAW_BUILD_INFO__: JSON.stringify({build_id: 'gallery-diagnostic'})},
      build: {outDir: path.join(work, 'dist'), rollupOptions: {input: path.join(root, 'tests/fixtures/galleryLive.html')}}});
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    protocol.handle('app', request => {
      if (new URL(request.url).pathname === '/fixture.png') return new Response(png, {headers: {'Content-Type': 'image/png'}});
      const file = appAsset(path.join(work, 'dist'), request.url);
      return new Response(fs.readFileSync(file), {headers: {...APP_HEADERS, 'Content-Type': ({'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm'}[path.extname(file)] || 'application/octet-stream')}});
    });
    win = new BrowserWindow({show: false, width: 1440, height: 1000, webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false}});
    win.webContents.session.webRequest.onBeforeRequest({urls: ['http://*/*', 'https://*/*']}, (details, callback) => {
      const url = new URL(details.url);
      callback(url.origin === 'http://127.0.0.1:1' && /\/images\//.test(url.pathname) ? {redirectURL: 'app://local/fixture.png'} : {cancel: true});
    });
    const js = code => win.webContents.executeJavaScript(code, true);
    const until = async code => {for (let i = 0; i < 200; i++) {if (await js(code)) return; await sleep(50);} throw Error('Timed out: ' + code);};
    const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const field = (selector, value) => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
    const count = number => until(`[...document.querySelectorAll('.image-library-workspace .gallery-item')].filter(node=>node.getClientRects().length).length===${number}`);
    const pickerVisible = () => js(`(()=>{const picker=document.querySelector('[aria-label="Image collection"]'),rect=picker.getBoundingClientRect(),pane=picker.closest('.image-library-workspace').getBoundingClientRect();return picker.getClientRects().length>0&&rect.top>=pane.top&&rect.bottom<=pane.bottom&&rect.left>=pane.left&&rect.right<=pane.right;})()`);
    await win.loadURL('app://local/tests/fixtures/galleryLive.html?coexistence');
    await until('!!document.querySelector("[data-sidebar-route=generate]")');
    assert.equal(await js('galleryQA.sessionReads'), 0);
    await click('[data-sidebar-route="generate"]'); await until('!!document.querySelector("#image-studio textarea")');
    await field('#image-studio textarea', 'Preserve my generation draft');
    await field('[aria-label="Side pane workspace"]', 'images'); await count(1);
    assert(await pickerVisible());
    assert(await js(`document.querySelector('[data-capture-tab="images"]').firstElementChild.classList.contains('pinned-pane-heading')`));
    await js('galleryQA.completeSession()'); await count(2);
    assert.equal(await js('document.querySelector("#image-studio textarea").value'), 'Preserve my generation draft');
    checks.push('First pin loads Gallery; completed generation appears beside Generate without switching tabs or losing its draft');
    await field('[aria-label="Image collection"]', 'folder:fixture-folder'); await until('document.querySelector(".image-library-header h1").textContent==="My collection"');
    await field('[aria-label="Image collection"]', 'general'); await count(2);
    checks.push('Wide pinned Gallery can switch custom folders and collections');
    await click('[data-sidebar-route="chats"]'); await click('[aria-label="Workspace options"]');
    await field('[aria-label="Pin tool beside chat"]', 'images'); await click('[aria-label="Workspace options"]'); await count(2);
    await js('galleryQA.completeSession()'); await count(3);
    await js('galleryQA.completeQwen()'); await count(4);
    assert(await pickerVisible());
    await field('[aria-label="Image collection"]', 'saved'); await count(1);
    assert(await js('document.querySelector(".image-library-workspace").textContent.includes("Qwen completed image")'));
    await field('[aria-label="Image collection"]', 'general'); await count(4);
    checks.push('Chat side pane receives new chat images and Qwen completion while Generate is hidden; Qwen is also in Saved Images');
    await js('galleryQA.failSessions=true; window.dispatchEvent(new Event("focus"));');
    await until('document.querySelector(".image-library-workspace").textContent.includes("last loaded images")'); await count(4);
    await js('galleryQA.failSessions=false; window.dispatchEvent(new Event("focus"));');
    await until('!document.querySelector(".image-library-workspace").textContent.includes("last loaded images")');
    checks.push('Disconnection retains images and reports recovery');
    win.setSize(1441, 1000); await sleep(100); win.setSize(1440, 1000); win.webContents.invalidate(); await sleep(300);
    fs.writeFileSync(path.join(work, 'chat-gallery-wide.png'), (await win.webContents.capturePage(undefined, {stayHidden: true, stayAwake: true})).toPNG());
    win.setSize(430, 900); await sleep(250); assert(await pickerVisible());
    assert(await js('document.documentElement.scrollWidth<=innerWidth'));
    fs.writeFileSync(path.join(work, 'chat-gallery-narrow.png'), (await win.webContents.capturePage(undefined, {stayHidden: true, stayAwake: true})).toPNG());
    win.setSize(1440, 1000); await sleep(100);
    await click('[aria-label="Close side pane"]');
    await click('[data-sidebar-route="generate"]'); await count(4);
    assert.equal(await js('document.querySelector("#image-studio textarea").value'), 'Preserve my generation draft');
    assert.deepEqual(await js('workspaceCoexistenceQA.stopped'), []);
    assert.deepEqual(await js('workspaceControlsQA.errors'), []);
    checks.push('Narrow layout, unpin/repin, independent pair persistence and generation draft preservation');
    fs.writeFileSync(path.join(work, 'result.json'), JSON.stringify({ok: true, checks}, null, 2));
    console.log(JSON.stringify({ok: true, checks, artifacts: work}));
  }).catch(async error => {console.error(error, {checks, artifacts: work}); if (win) console.error(await win.webContents.executeJavaScript('JSON.stringify({errors:window.workspaceControlsQA?.errors,text:document.body.innerText.slice(-2500)})')); process.exitCode = 1;})
    .finally(() => {clearTimeout(timer); win?.destroy(); app.exit(process.exitCode || 0);});
}
