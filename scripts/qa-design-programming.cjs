// Actual app renderer, synthetic API responses, a disposable build and profile.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
if (!process.versions.electron) {
  const { spawn } = require('node:child_process'), env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename], { env, windowsHide: true, stdio: 'inherit' });
  child.on('error', error => { console.error(error); process.exitCode = 1; }); child.on('exit', code => { process.exitCode = code; });
} else {
  const { app, BrowserWindow, protocol } = require('electron');
  const { appAsset, APP_HEADERS } = require('../electron/security');
  const root = path.resolve(__dirname, '..'), work = fs.mkdtempSync(path.join(os.tmpdir(), 'law-design-programming-'));
  app.setPath('userData', path.join(work, 'profile')); app.disableHardwareAcceleration();
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
  let win; const checks = [], sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const timeout = setTimeout(() => { console.error('Design QA timed out', work); app.exit(1); }, 180000);
  app.whenReady().then(async () => {
    const { build } = await import('vite'), react = (await import('@vitejs/plugin-react')).default;
    await build({ configFile: false, root, base: './', plugins: [react()], logLevel: 'error', worker: { format: 'es' }, assetsInclude: ['**/*.bin'],
      define: { __LAW_BUILD_INFO__: JSON.stringify({ build_id: 'design-programming-diagnostic' }) },
      build: { outDir: path.join(work, 'dist'), emptyOutDir: true, rollupOptions: { input: path.join(root, 'tests/fixtures/workspaceControls.html') } } });
    protocol.handle('app', request => { const file = appAsset(path.join(work, 'dist'), request.url); return new Response(fs.readFileSync(file), { headers: { ...APP_HEADERS,
      'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' }[path.extname(file)] || 'application/octet-stream') } }); });
    win = new BrowserWindow({ show: false, width: 1440, height: 1080, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const js = code => win.webContents.executeJavaScript(code);
    const until = async (code, label) => { for (let i = 0; i < 240; i++) { if (await js(code)) return; await sleep(40); } throw Error(`Timed out: ${label}`); };
    const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const button = label => js(`(()=>{const b=[...document.querySelectorAll('[data-capture-tab="design-programming"] button')].find(b=>b.textContent===${JSON.stringify(label)});if(!b)throw Error('Missing button');b.click();})()`);
    const select = (label, value) => js(`(()=>{const e=[...document.querySelectorAll('[data-capture-tab="design-programming"] label')].find(e=>e.firstChild.textContent===${JSON.stringify(label)}).querySelector('select');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const input = (selector, value) => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const route = async id => { await click(`[data-sidebar-route="${id}"]`); await until(`!!document.querySelector('[data-capture-tab="${id}"]:not([hidden])')`, id); };
    const tool = async id => { await click(`.pane:not([hidden]) [data-design-route="${id}"]`); await until(`!!document.querySelector('[data-capture-tab="${id}"]:not([hidden])') && document.activeElement?.dataset.designRoute===${JSON.stringify(id)}`, id); };
    const capture = async name => { const [width, height] = win.getSize(); win.setSize(width + 1, height); await sleep(100); win.setSize(width, height); win.webContents.invalidate(); await sleep(240); fs.writeFileSync(path.join(work, name), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); };
    await win.loadURL('app://local/tests/fixtures/workspaceControls.html');
    await until("!!document.querySelector('[data-sidebar-route=\"design-programming\"]')", 'main design tab'); await route('design-programming');
    await until("!!document.querySelector('.dp-template')", 'playground');
    assert.equal(await js("document.querySelectorAll('#sidebar-group-viewers [data-sidebar-route]').length"), 3);
    assert.equal(await js("document.querySelectorAll('[data-capture-tab=\"design-programming\"] [data-design-route]').length"), 6);
    assert.equal(await js("document.querySelectorAll('.dp-template').length"), 6);
    checks.push('Main Design & Programming tab owns the playground and all five existing source/library destinations');

    const original = await js("document.documentElement.style.getPropertyValue('--accent')");
    await click('.dp-template'); await select('Corner treatment', 'sharp'); await select('Information density', 'compact');
    assert.equal(await js("document.documentElement.style.getPropertyValue('--accent')"), original);
    await button('Apply to app');
    await until("document.documentElement.dataset.uiCorners==='sharp'", 'apply appearance');
    assert.equal(await js('document.documentElement.dataset.uiDensity'), 'compact');
    assert.equal(await js("getComputedStyle(document.querySelector('[data-sidebar-route=\"design-programming\"]')).borderRadius"), '0px');
    assert.equal(await js("getComputedStyle(document.querySelector('[data-sidebar-route=\"design-programming\"]')).paddingTop"), '5px');
    await button('Undo application');
    await until(`document.documentElement.style.getPropertyValue('--accent')===${JSON.stringify(original)}`, 'undo appearance');
    assert.equal(await js('document.documentElement.dataset.uiCorners'), 'default');
    checks.push('Draft controls are isolated; Apply updates shared tokens and real navigation geometry; Undo restores the prior appearance');

    await click('.dp-template');
    await click('.dp-saved summary'); await input('.dp-save-row input', 'QA mixed design'); await button('Save preset');
    await select('Color theme', 'paper'); await button('Load design');
    assert.equal(await js("JSON.parse(localStorage.getItem('local-ai-workstation-design-draft-v1')).appearance.theme"), 'slate');
    await select('Sample layout', 'chat'); await select('Preview width', 'phone');
    await tool('css-viewer'); await input('[data-capture-tab="css-viewer"] textarea[aria-label="CSS source"]', '/* Keep my CSS draft */\nbody { color: red; }');
    await tool('js-viewer'); await input('[data-capture-tab="js-viewer"] textarea', 'const kept = true;');
    await tool('html-viewer'); await input('[data-capture-tab="html-viewer"] textarea', '<h1>Kept HTML</h1>');
    await tool('markdown'); await tool('css-viewer');
    assert((await js("document.querySelector('[data-capture-tab=\"css-viewer\"] textarea').value")).includes('Keep my CSS draft'));
    assert.equal(await js("document.querySelector('[data-sidebar-route=\"design-programming\"]').getAttribute('aria-current')"), 'page');
    await tool('design-programming');
    assert.equal(await js("JSON.parse(localStorage.getItem('local-ai-workstation-design-draft-v1')).layout"), 'chat');
    await tool('styling-library'); await until("!!document.querySelector('[aria-label=\"Add Glass panel to playground\"]')", 'library');
    await click('[aria-label="Add Glass panel to playground"]'); await until("!!document.querySelector('[data-capture-tab=\"design-programming\"]:not([hidden])')", 'library handoff');
    assert((await js("JSON.parse(localStorage.getItem('local-ai-workstation-design-draft-v1')).pieces")).includes('glass-card'));
    await click('[aria-label="Move Glass panel earlier"]'); await click('[aria-label="Remove Glass panel"]');
    assert(!(await js("JSON.parse(localStorage.getItem('local-ai-workstation-design-draft-v1')).pieces")).includes('glass-card'));
    checks.push('Preset save/load, independent code drafts, library-to-playground handoff, and component reordering/removal work in the full app');

    await button('Open preview CSS'); await until("!!document.querySelector('[data-capture-tab=\"css-viewer\"]:not([hidden])')", 'generated CSS');
    assert((await js("document.querySelector('[data-capture-tab=\"css-viewer\"] textarea').value")).includes('--ui-radius: 18px'));
    assert((await js("document.querySelector('[aria-label=\"HTML to style\"]').value")).includes('A conversation starts here'));
    await tool('design-programming'); await select('Sample layout', 'studio'); await select('Preview width', 'fluid');
    await js("document.querySelector('.design-playground').scrollTop=0"); await capture('design-desktop.png');
    await js("document.querySelector('.dp-preview-panel').scrollIntoView({block:'start'})"); await capture('design-preview.png');
    await until("[...document.querySelectorAll('.dp-preview-stage iframe')].every(f=>f.getAttribute('sandbox')==='')", 'sandbox');
    const preview = win.webContents.mainFrame.frames.find(frame => frame.name === 'design-preview');
    assert(preview, 'preview frame exists');
    // An opaque sandbox deliberately refuses executeJavaScript. Inspect its
    // source from the host and review captured pixels instead of enabling scripts.
    assert(await js("document.querySelector('[name=\"design-preview\"]').srcdoc.includes('--accent: #b599ff')"));
    assert.equal(await js("new DOMParser().parseFromString(document.querySelector('[name=\"design-preview\"]').srcdoc,'text/html').querySelectorAll('script,link,[src]').length"), 0);
    await click('.dp-component-picker summary');
    await js("document.querySelectorAll('.dp-piece-options input:not(:checked)').forEach(input=>input.click())");
    await until("document.querySelectorAll('.dp-piece').length===20", 'all library components');
    await select('Motion', 'reduced');
    assert(await js("[...document.querySelectorAll('.dp-piece iframe')].every(frame=>frame.srcdoc.includes('* { animation: none !important'))"));
    await js("document.querySelector('.dp-components').scrollIntoView({block:'start'})"); await capture('design-components.png');
    checks.push('Generated CSS carries the chosen design and sample HTML; opaque sandbox preview renders the intended palette without scripts or remote assets');

    await win.reload(); await until("!!document.querySelector('[data-sidebar-route=\"design-programming\"]')", 'reload'); await route('design-programming');
    await until("!!document.querySelector('.dp-template')", 'restored playground');
    assert.equal(await js("JSON.parse(localStorage.getItem('local-ai-workstation-design-draft-v1')).appearance.theme"), 'slate');
    assert.equal(await js("JSON.parse(localStorage.getItem('local-ai-workstation-design-presets-v1'))[0].name"), 'QA mixed design');
    assert.equal(await js("document.querySelectorAll('.dp-piece').length"), 20);
    await select('Color theme', 'paper'); await capture('design-light.png');
    win.setSize(420, 980); await sleep(200);
    await js("document.querySelector('.design-playground').scrollTop=0"); await capture('design-narrow.png');
    assert(await js('document.documentElement.scrollWidth<=innerWidth'));
    assert(await js("(()=>{const p=document.querySelector('.design-playground');return p.scrollWidth<=p.clientWidth+1})()"));
    await js("document.querySelector('.dp-preview-panel').scrollIntoView({block:'start'})"); await capture('design-narrow-preview.png');
    await js("document.querySelector('.dp-controls').scrollIntoView({block:'start'})"); await capture('design-narrow-controls.png');
    assert(await js("(()=>{const p=document.querySelector('.design-playground');return p.scrollWidth<=p.clientWidth+1})()"));
    checks.push('Design drafts and presets survive reload; light and dark previews and controls fit desktop and 420 px layouts');
    assert.deepEqual(await js('window.workspaceControlsQA.errors'), []);
    fs.writeFileSync(path.join(work, 'report.json'), JSON.stringify({ ok: true, checks }, null, 2));
    console.log(JSON.stringify({ ok: true, checks, artifacts: work }, null, 2));
  }).catch(async error => {
    console.error(error); if (win) { fs.writeFileSync(path.join(work, 'failure.txt'), await win.webContents.executeJavaScript('document.body.innerText')); fs.writeFileSync(path.join(work, 'failure.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); }
    console.error('Artifacts:', work); process.exitCode = 1;
  }).finally(() => { clearTimeout(timeout); win?.destroy(); app.exit(process.exitCode || 0); });
}
