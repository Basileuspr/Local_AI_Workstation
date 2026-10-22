// Real Chromium + HTTPS + isolated desktop routes. Inference is synthetic.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const { createHash, X509Certificate } = require('node:crypto'), { spawn } = require('node:child_process'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), work = fs.mkdtempSync(path.join(os.tmpdir(), 'law-mobile-qa-'));
app.setPath('userData', path.join(work, 'profile'));
let win, backend, exitCode = 0;
const errors = [], pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
const updateQA = process.env.LAW_MOBILE_UPDATE_QA === '1';
const guard = setTimeout(() => { backend?.kill(); app.exit(1); }, updateQA ? 240000 : 150000);
app.whenReady().then(async () => {
  let updateProject;
  if (updateQA) {
    updateProject = path.join(work, 'project');
    fs.mkdirSync(path.join(updateProject, 'scripts'), {recursive: true});
    for (const name of ['src', 'mobile']) fs.cpSync(path.join(root, name), path.join(updateProject, name), {recursive: true});
    for (const name of ['package.json', 'package-lock.json', 'scripts/mobile-build.cjs']) fs.copyFileSync(path.join(root, name), path.join(updateProject, name));
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(updateProject, 'node_modules'), 'junction');
    await new Promise((resolve, reject) => {
      const build = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', path.join(updateProject, 'mobile/vite.config.mjs')],
        {cwd: updateProject, windowsHide: true, env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}});
      let output = ''; build.stdout.on('data', data => output += data); build.stderr.on('data', data => output += data);
      build.on('error', reject); build.on('exit', code => code ? reject(Error(output)) : resolve());
    });
  }
  const localPort = await freePort(), mobilePort = await freePort();
  backend = spawn(path.join(root, 'venv/Scripts/python.exe'), ['-B', 'tests/fixtures/mobile_backend.py'], { cwd: root, windowsHide: true,
    env: { ...process.env, ...(updateQA ? {LAW_MOBILE_QA_PROJECT: updateProject, LAW_MOBILE_BUILD_DIR: path.join(updateProject, 'dist/mobile')} : {}), PYTHONPATH: path.join(root, 'backend'), LAW_DATA_DIR: path.join(work, 'data'), LAW_MODELS_DIR: path.join(work, 'models'), LAW_LOG_DIR: path.join(work, 'logs'), LAW_PORT: String(localPort), LAW_SESSION_TOKEN: 'isolated-mobile-qa', LAW_MOBILE_QA_DIR: work, LAW_MOBILE_QA_PORT: String(mobilePort), LAW_MOBILE_QA_HOLD_IMAGES: '1' } });
  let log = ''; backend.stderr.on('data', data => log += data); backend.stdout.on('data', data => log += data);
  for (let i = 0; !fs.existsSync(path.join(work, 'ready.json')); i++) { if (i > 400 || backend.exitCode !== null) throw Error(log); await pause(50); }
  const fixture = JSON.parse(fs.readFileSync(path.join(work, 'ready.json')));
  win = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  // Trust only this run's exact ephemeral fixture certificate. Never alter OS
  // trust, ignore certificate errors globally, or connect to the live desktop.
  win.webContents.session.setCertificateVerifyProc((request, callback) => {
    const fingerprint = new X509Certificate(request.certificate.data).fingerprint256.replaceAll(':', '').toLowerCase();
    callback(request.hostname === '127.0.0.1' && fingerprint === fixture.fingerprint ? 0 : -3);
  });
  win.webContents.on('console-message', event => { if (event.level === 'error' || event.level === 3) errors.push(event.message); });
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(fixture.origin + '/')) event.preventDefault(); });
  const js = async code => {
    try { return await win.webContents.executeJavaScript(code); }
    catch (error) { throw Error(`Browser check failed: ${code}\n${error.message}`); }
  };
  const until = async (code, label) => { for (let i = 0; i < 300; i++) { if (await js(code)) return; await pause(50); } throw Error(label + '\n' + await js('document.body.innerText')); };
  const click = async text => { const find = `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`; await until(`!!(${find}) && !(${find}).disabled`, text); await js(`(${find}).click()`); };
  const set = async (selector, value) => { await until(`!!document.querySelector(${JSON.stringify(selector)})`, selector); await js(`(()=>{const field=document.querySelector(${JSON.stringify(selector)});const prototype=field instanceof HTMLSelectElement?HTMLSelectElement.prototype:field instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event(field instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`); };
  const capture = async name => { await pause(200); fs.writeFileSync(path.join(work, name), (await win.webContents.capturePage()).toPNG()); };
  const checkImageGestures = async () => {
    await until("document.querySelector('.image-zoom-viewport img')?.naturalWidth>0", 'zoomable original loaded');
    const center = await js("(()=>{const r=document.querySelector('.image-zoom-viewport').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
    const point = (id, offset) => ({ id, x: center.x + offset, y: center.y, radiusX: 8, radiusY: 8, force: 1 });
    const touch = (type, touchPoints) => win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type, touchPoints });
    const transform = () => js("(()=>{const m=new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.image-zoom-viewport img')).transform);return {scale:m.a,x:m.e}})()");
    assert.equal(await js("getComputedStyle(document.querySelector('.image-zoom-viewport')).touchAction"), 'none');
    await touch('touchStart', [point(1, -30), point(2, 30)]);
    for (const distance of [40, 50, 60, 75]) { await touch('touchMove', [point(1, -distance), point(2, distance)]); await pause(30); }
    await touch('touchEnd', []);
    const enlarged = await transform();
    assert(enlarged.scale > 2, 'two fingers enlarge the image');
    assert.equal(await js('visualViewport.scale'), 1, 'pinch transforms the image without enlarging the controls');
    await touch('touchStart', [point(3, 0)]);
    await touch('touchMove', [point(3, 20)]); await pause(30);
    await touch('touchMove', [point(3, 40)]); await touch('touchEnd', []);
    assert((await transform()).x > enlarged.x + 15, 'one finger pans the enlarged image');
    assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true, 'zoom stays inside the viewer');
    await capture('image-viewer-zoomed.png');
    await click('Fit');
    assert.deepEqual(await transform(), { scale: 1, x: 0 }, 'Fit restores the image');
  };
  await win.loadURL(fixture.origin + '/#pair=' + fixture.code);
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  console.log('Fixture loaded over HTTPS');
  await until(`document.querySelector('input[placeholder="Paste the invitation from your desktop"]')?.value===${JSON.stringify(fixture.code)}`, 'QR invitation prefilled');
  assert.equal(await js('location.hash'), '', 'invitation removed from browser history');
  assert((await js("document.querySelector('.pair a')?.href")).includes('package=com.localai.workstation.companion'), 'explicit Android app handoff');
  await click('Connect to desktop');
  await until("document.querySelector('nav')", 'paired');
  console.log('Phone paired');
  await set('.session-picker select', fixture.session_id);
  await until("document.querySelector('.messages')?.textContent.includes('What would you like')", 'history');
  await js("document.querySelector('.message .image-preview').click()");
  await checkImageGestures();
  await js("document.querySelector('[aria-label=\"Close image\"]').click()");
  await js("document.querySelector('.mobile-response-options').open=true");
  await set('[aria-label="Maximum output tokens"]', '1537');
  await set('#chat-prompt', 'Plan a short creative afternoon');
  await click('Send ↗');
  await until("document.querySelector('.messages')?.textContent.includes('WORKSTATION · running')", 'live stream');
  assert.equal(JSON.parse(fs.readFileSync(path.join(work, 'chat-request.json'))).options.num_predict, 1537);
  assert(await js("[...document.querySelectorAll('button')].some(n=>n.textContent==='Stop reply')"), 'Stop reply is reachable from chat');
  await capture('chat-stream.png');
  // Closing/reloading an observer must not cancel its server-owned job.
  await win.reload();
  await until("document.querySelector('nav')", 'paired after reload');
  await set('.session-picker select', fixture.session_id);
  await until("[...document.querySelectorAll('.message.assistant')].some(e=>e.querySelector('.eyebrow')?.textContent==='WORKSTATION' && e.textContent.includes('A response streamed from your desktop.'))", 'persisted reply after stream completion');
  assert.equal(await js("document.querySelector('[aria-label=\"Maximum output tokens\"]').value"), '1537', 'phone output limit survives reload');
  await until("document.querySelector('.messages [aria-label=\"Copy code\"]')", 'persisted code blackboard');
  assert((await js("document.querySelector('.response-usage').textContent")).includes('1,537'), 'applied budget survives saved history');
  await click('✧Create');
  await set('[aria-label="Image prompt"]', 'A calm watercolor landscape');
  await set('[aria-label="Negative prompt"]', 'Blur and noise');
  await set('[aria-label="Image LoRA adapter"]', 'fixture-adapter');
  await set('[aria-label="LoRA strength"]', '0.75');
  await set('[aria-label="Steps"]', '200');
  await set('[aria-label="Guidance"]', '5.6');
  await set('[aria-label="Seed"]', '0');
  assert.equal(await js('document.querySelector("[aria-label=Steps]").max'), '200');
  assert.equal(await js('document.querySelector("[aria-label=Width]").value'), '1024');
  assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true, 'generation phone horizontal overflow');
  await capture('generate-controls.png');
  await click('Generate image ✧');
  await until("document.querySelector('.generation')?.textContent.includes('1 image pending')", 'Create stays open after submission');
  assert.equal(await js("document.querySelector('.session-picker select').value"), fixture.session_id);
  await set('[aria-label="Image prompt"]', 'Second watercolor landscape');
  await click('Queue another image ✧');
  await until("document.querySelector('.generation')?.textContent.includes('2 images pending')", 'second image queued in same chat');
  await capture('same-chat-image-queue.png');
  await click('View jobs');
  await until("[...document.querySelectorAll('.job')].filter(job=>job.querySelector('.eyebrow').textContent==='IMAGE').length===2", 'both image jobs visible');
  assert.equal(await js("[...document.querySelectorAll('.job')].filter(job=>job.querySelector('.eyebrow').textContent==='IMAGE').every(job=>!job.querySelector('.badge').textContent.includes('completed'))"), true);
  fs.writeFileSync(path.join(work, 'release-image-jobs'), 'ready');
  await until("[...document.querySelectorAll('.job .badge')].every(badge=>badge.textContent==='completed')", 'both image jobs complete');
  const generated = JSON.parse(fs.readFileSync(path.join(work, 'image-request.json')));
  assert.deepEqual([generated.width, generated.height, generated.steps, generated.guidance_scale, generated.seed, generated.lora_id, generated.lora_scale], [1024, 1024, 200, 5.6, 0, 'fixture-adapter', 0.75]);
  const desktopTasks = await fetch(`http://127.0.0.1:${localPort}/mobile/image-tasks`, { headers: { 'X-LAW-Session': 'isolated-mobile-qa' } }).then(response => response.json());
  assert.equal(desktopTasks.tasks.length, 2);
  assert(desktopTasks.tasks.every(task => task.status === 'completed' && task.session_id === fixture.session_id));
  assert.deepEqual(desktopTasks.tasks.map(task => task.prompt), ['A calm watercolor landscape', 'Second watercolor landscape']);
  assert(desktopTasks.tasks[0].result.url.startsWith('/sessions/'), 'phone output is available to desktop Generate');
  await click('✧Create');
  assert.equal(await js(`document.querySelector('[aria-label="Image prompt"]').value`), 'Second watercolor landscape');
  assert.equal(await js(`document.querySelector('[aria-label="Negative prompt"]').value`), 'Blur and noise');
  assert.equal(await js('document.querySelector("[aria-label=Steps]").value'), '200');
  await click('▧Gallery');
  await until("document.querySelectorAll('.image-tile').length===8", 'gallery includes both queued results');
  assert.equal(await js("document.querySelector('.image-tile span').textContent"), 'Mobile creation.png', 'new generation is first');
  await capture('gallery.png');
  assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true, 'phone horizontal overflow');
  await set('[aria-label="Sort images"]', 'oldest');
  await until("document.querySelector('.image-tile span')?.textContent==='Color study 1.png'", 'oldest image first');
  await js("document.querySelector('.gallery-filters').open=true");
  await set('[aria-label="Image source"]', 'library');
  await until("document.querySelector('.empty')?.textContent.includes('No images match')", 'source filter empty result');
  await set('[aria-label="Image source"]', 'session');
  await set('[aria-label="Gallery conversation"]', fixture.session_id);
  await set('[aria-label="Image date range"]', '7');
  await until("document.querySelectorAll('.image-tile').length===8", 'combined filters');
  await capture('gallery-filters.png');
  assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true, 'filters fit phone viewport');
  await click('◌Chat'); await click('▧Gallery');
  assert.equal(await js(`document.querySelector('[aria-label="Sort images"]').value`), 'oldest');
  assert.equal(await js(`document.querySelector('[aria-label="Image date range"]').value`), '7');
  await click('Clear filters');
  await until("document.querySelector('.image-tile span')?.textContent==='Mobile creation.png'", 'clear restores newest');
  await set('input[type="search"]', 'Color study 6');
  await until("document.querySelectorAll('.image-tile').length===1", 'search filtered across gallery');
  await click('Clear filters');
  await until("document.querySelectorAll('.image-tile').length===8", 'search cleared');
  await click('Refresh images');
  await until("!document.querySelector('.gallery-section[aria-busy=true]')", 'gallery refreshed');
  assert.equal(await js(`document.querySelector('[aria-label="Sort images"]').value`), 'newest');
  await js("[...document.querySelectorAll('.image-tile')].find(b=>b.textContent.includes('Color study 6')).click()");
  await until("document.querySelector('.image-zoom-viewport img')?.naturalWidth===1200", 'full-resolution viewer');
  assert.equal(await js("document.querySelector('[aria-label=\"Image zoom\"]').textContent"), '100%', 'new image opens fitted');
  await checkImageGestures();
  let download;
  win.webContents.session.on('will-download', (_event, item) => { item.setSavePath(path.join(work, 'original.png')); item.once('done', (_event, state) => download = state); });
  await js("document.querySelector('.viewer a[download]').click()");
  for (let i = 0; !download && i < 200; i++) await pause(50);
  assert.equal(download, 'completed');
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(work, 'original.png'))).digest('hex'), fixture.download_sha256);
  await capture('image-viewer.png');
  await js("document.querySelector('[aria-label=\"Close image\"]').click()");
  if (updateQA) {
    const desktop = async (route = '', method = 'GET') => {
      const response = await fetch(`http://127.0.0.1:${localPort}/mobile${route}`, {method,
        headers: {'Origin': 'app://local', 'x-law-session': 'isolated-mobile-qa'}});
      assert.equal(response.status, 200); return response.json();
    };
    const before = (await desktop()).client_update.version;
    await click('◌Chat'); await set('#chat-prompt', 'Keep this draft until I choose to update');
    const cookieBefore = (await win.webContents.session.cookies.get({url: fixture.origin})).find(item => item.name === '__Host-law-mobile').value;
    fs.appendFileSync(path.join(updateProject, 'mobile/src/main.jsx'), '\n// Isolated second release for update QA.\n');
    assert.equal((await desktop('/client-update', 'POST')).client_update.phase, 'building');
    let status;
    for (let i = 0; i < 600; i++) {
      status = await desktop();
      if (status.client_update.phase !== 'building') break;
      await pause(50);
    }
    assert.equal(status.client_update.phase, 'ready', status.client_update.message);
    const after = status.client_update.version;
    assert.notEqual(after, before);
    await until("document.querySelector('[aria-label=\"Phone app update\"]')", 'update notification');
    assert.equal(await js("document.querySelector('#chat-prompt').value"), 'Keep this draft until I choose to update');
    await click('Update phone app');
    assert.equal(await js("document.querySelector('#chat-prompt').value"), 'Keep this draft until I choose to update');
    await js("document.querySelector('.client-update').scrollIntoView({block:'start'})");
    assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true, 'update controls fit the phone');
    await capture('phone-update-ready.png');
    await click('Keep editing'); await click('Update phone app'); await click('Update and clear drafts');
    await until("document.querySelector('nav') && !document.querySelector('[aria-label=\"Phone app update\"]') && !location.search", 'new phone shell reconnects');
    for (let i = 0; i < 100; i++) {
      status = await desktop();
      if (status.devices.some(device => device.client_version === after)) break;
      await pause(50);
    }
    assert(status.devices.some(device => device.client_version === after), 'desktop receives new phone version');
    const cookieAfter = (await win.webContents.session.cookies.get({url: fixture.origin})).find(item => item.name === '__Host-law-mobile').value;
    assert.equal(cookieAfter, cookieBefore, 'update retains pairing');
    assert.equal(await js(`fetch('/releases/${before}/index.html').then(response=>response.status)`), 200, 'previous release remains available');
    await until(`caches.keys().then(keys=>keys.includes('law-mobile-${after}'))`, 'new offline shell cached');
    fs.appendFileSync(path.join(updateProject, 'mobile/src/main.jsx'), '\nsyntax error !!!\n');
    await desktop('/client-update', 'POST');
    for (let i = 0; i < 200; i++) { status = await desktop(); if (status.client_update.phase !== 'building') break; await pause(50); }
    assert.equal(status.client_update.phase, 'error');
    assert.equal(status.client_update.version, after, 'failed build preserves last published version');
    console.log('Live phone update, draft confirmation, pairing, version acknowledgment and failed-build recovery passed');
  }
  const cacheKeys = await js("caches.keys().then(async keys=>(await Promise.all(keys.map(key=>caches.open(key).then(cache=>cache.keys())))).flat().map(request=>request.url))");
  assert(cacheKeys.length > 0, 'shell worker cached assets');
  assert(cacheKeys.every(url => !new URL(url).pathname.startsWith('/api/')), 'private data must never enter CacheStorage');
  const cookies = await win.webContents.session.cookies.get({ url: fixture.origin });
  assert(cookies.some(cookie => cookie.name === '__Host-law-mobile' && cookie.secure && cookie.httpOnly));
  assert.deepEqual(await js('Object.keys(localStorage)'), ['law-mobile-output-tokens'], 'only the non-private output-size preference is persisted');
  assert.equal(await js('sessionStorage.length'), 0);
  await win.webContents.session.enableNetworkEmulation({ offline: true });
  await win.reload();
  await until("document.querySelector('h1')?.textContent.includes('Workstation')", 'offline shell');
  await win.webContents.session.disableNetworkEmulation();
  await until("document.querySelector('nav')", 'automatic reconnect');
  await js("document.querySelector('[aria-label=\"Connection details\"]').click()");
  await click('Disconnect this phone');
  await until("document.querySelector('.pair')", 'logout');
  assert.equal(await js("fetch('/api/state').then(response=>response.status)"), 401);
  const actualErrors = errors.filter(error => !/ERR_INTERNET_DISCONNECTED|401|favicon|network error/i.test(error));
  assert.deepEqual(actualErrors, []);
  fs.writeFileSync(path.join(work, 'result.json'), JSON.stringify({ passed: true, viewport: '390x844', inference: 'synthetic', checked: ['HTTPS pairing', 'secure HttpOnly cookie', 'streaming chat', 'reload during job', 'conversation persistence', 'shared generation controls and forwarded values', 'positive and negative prompt retention', 'desktop Generate task results', 'multiple images queued in the same chat', 'image queue and gallery', 'newest/oldest image order', 'source/conversation/date/search filters', 'filter retention and reset', 'chat and gallery pinch zoom', 'touch pan and Fit reset', 'original download hash', 'private-cache exclusion', 'offline shell and reconnect', 'logout revocation'] }, null, 2));
  console.log('Mobile Chromium QA passed: ' + work);
}).catch(error => { console.error(error); exitCode = 1; }).finally(() => { clearTimeout(guard); win?.destroy(); backend?.kill(); app.exit(exitCode); });
