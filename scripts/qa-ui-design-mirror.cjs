// Real Electron child/preload/sandbox, disposable profile and synthetic UI.
// Pass --app to also compile and capture the actual React app with fixture APIs.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
if (!process.versions.electron) {
    const { spawn } = require('node:child_process'), env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require('electron'), [__filename, ...process.argv.slice(2)], { env, windowsHide: true, stdio: 'inherit' });
    child.on('error', error => { console.error(error); process.exitCode = 1; }); child.on('exit', code => { process.exitCode = code; });
} else {
    const { app, BrowserWindow, ipcMain, Menu, protocol } = require('electron');
    const { createUIDesignMirror } = require('../electron/uiDesignMirror');
    const { applicationMenu } = require('../electron/appShutdown');
    const { captureDesignSnapshot } = require('../electron/uiDesignSnapshot');
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'law-ui-mirror-'));
    const root = path.resolve(__dirname, '..');
    app.setPath('userData', path.join(work, 'profile')); app.disableHardwareAcceleration();
    protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
    const checks = [], errors = [], handlers = new Map();
    let main, mirror, manager;
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const js = code => mirror.webContents.executeJavaScript(code).catch(error => { error.message += `\nMirror check: ${code}`; throw error; });
    const until = async (code, label) => { for (let i = 0; i < 180; i++) { if (await js(code)) return; await sleep(50); } throw Error(`Timed out: ${label}`); };
    const click = id => js(`document.getElementById(${JSON.stringify(id)}).click()`);
    const set = (id, value, event = 'input') => js(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
    const choose = selector => js(`(()=>{const d=document.getElementById('after').contentDocument; const e=d.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing target');e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));})()`);
    const value = (frame, selector, property) => js(`(()=>{const d=document.getElementById(${JSON.stringify(frame)}).contentDocument;return d.defaultView.getComputedStyle(d.querySelector(${JSON.stringify(selector)})).getPropertyValue(${JSON.stringify(property)});})()`);
    const saved = () => until("document.getElementById('status').textContent.startsWith('Draft saved')", 'saved draft');
    const screenshot = async name => { const [w, h] = mirror.getSize(); mirror.setSize(w + 1, h); await sleep(100); mirror.setSize(w, h); mirror.webContents.invalidate(); await sleep(300); fs.writeFileSync(path.join(work, name), (await mirror.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); };
    const timer = setTimeout(() => { console.error('Mirror QA timed out:', work); app.exit(1); }, 180000);
    class HiddenWindow extends BrowserWindow {
        constructor(options) { super(options); mirror = this; this.webContents.on('console-message', event => { if (event.level === 'error' && !/Content Security Policy|Blocked script|Refused to/.test(event.message)) errors.push(event.message); }); }
        show() {} focus() {}
    }
    function create() {
        manager = createUIDesignMirror({ BrowserWindow: HiddenWindow,
            ipcMain: { handle(name, handler) { handlers.set(name, handler); ipcMain.handle(name, handler); } },
            dialog: { showSaveDialog: async () => ({ filePath: path.join(work, 'requests.json'), canceled: false }) },
            directory: path.join(work, 'profile'), getWindow: () => main, getMenu: () => Menu.getApplicationMenu() });
        manager.attach(main);
        Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenu(() => { throw Error('Must not exit'); }, () => manager.open())));
    }
    app.whenReady().then(async () => {
        main = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
        const source = `<!doctype html><html style="--accent:#83aaff"><head><style>
            *{box-sizing:border-box}body{margin:0;background:#0d1320;color:#dce5f3;font:15px 'Segoe UI',sans-serif}#app{height:100vh;display:flex}
            nav{width:210px;background:#171f31;padding:24px}button{font:inherit;color:#e3ebfb;background:#2d3b57;border:1px solid #526487;border-radius:6px;padding:10px 14px;margin:4px}
            main{flex:1;min-width:0;padding:28px}.workspace-navigation{border-bottom:1px solid #526487;padding-bottom:18px}.pane{padding-top:18px;height:90%;overflow:auto}h2{font-size:24px;color:#dce5f3;margin-top:12px}
            input,textarea{background:#1b263b;border:1px solid #526487;color:#dce5f3;padding:12px;border-radius:6px}textarea{display:block;width:100%;margin-top:20px}.card{border:1px solid #526487;padding:22px;border-radius:14px;margin-top:20px}dialog{background:#25304a;color:white;border:1px solid #526487;padding:24px;border-radius:12px}[hidden]{display:none!important}
            </style></head><body><div id="app"><nav><h3>WORKSTATION</h3><button data-sidebar-route="dashboard">Dashboard</button><button data-sidebar-route="generate">Generate</button></nav><main><div class="workspace-navigation"><span>Dashboard</span></div>
            <section class="pane" data-capture-tab="dashboard"><h2 id="target">Your creative workspace</h2><h2 id="neighbor">Recent activity</h2><button id="action" onclick="window.actions++">Start generation</button><button disabled id="disabled">Unavailable action</button>
            <div class="card"><h3>Quick settings</h3><input id="field" placeholder="Describe an idea"><input type="password" value="private-password"><textarea>Private draft text, keep out of exports.</textarea><details><summary>Advanced options</summary><button id="nested">Nested action</button></details><button id="popover-trigger" aria-controls="popup" popovertarget="popup">More actions</button><div id="popup" popover><button>Popover action</button></div></div><div style="height:900px"></div><h3 id="bottom">Bottom heading</h3></section>
            <section class="pane" data-capture-tab="generate" hidden><h2 id="other-heading">Generate images</h2><button>Generate now</button></section><section data-capture-tab="lazy" hidden></section></main></div>
            <dialog id="portal"><h2>Portal dialog</h2><button>Close dialog</button></dialog><script>window.actions=0;localStorage?.getItem;</script></body></html>`;
        await main.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(source));
        create(); await manager.open();
        await until("!!document.getElementById('after').contentDocument?.querySelector('#target')", 'captured mirror');
        assert.equal(await js('typeof window.workstationDesktop'), 'undefined');
        assert.deepEqual(await js('Object.keys(window.designMirror).sort()'), ['applyToApp', 'capture', 'exportReview', 'load', 'prepareApplication', 'save', 'undoApplication']);
        assert.equal(await js("document.getElementById('review').disabled"), true);
        assert.equal(await js("document.getElementById('after').contentDocument.querySelector('input[type=password]').value"), '');
        assert.equal(await js("document.getElementById('after').contentDocument.querySelector('#action').getAttribute('onclick')"), null);
        assert.equal(await js("document.getElementById('after').contentDocument.querySelectorAll('script').length"), 0);
        assert.equal(await js("document.getElementById('after').contentDocument.querySelector('#portal h2').textContent"), 'Portal dialog');
        assert.equal(await js("document.getElementById('after').contentDocument.querySelector('#popup').getClientRects().length"), 0);
        const request = { sender: main.webContents, senderFrame: main.webContents.mainFrame };
        for (const name of handlers.keys()) assert.match((await handlers.get(name)(request, {})).error, /Mirror access/);
        checks.push('Separate preload, blank passwords, inert handlers, portal capture, and IPC rejection for the main app');

        await choose('#target'); await set('edit-font-size', '36'); await set('edit-font-family', 'Georgia, serif', 'change'); await set('edit-color', '#f4b35f', 'change'); await saved();
        assert.equal(await value('after', '#target', 'font-size'), '36px');
        assert.equal(await value('after', '#target', 'color'), 'rgb(244, 179, 95)');
        assert.equal(await value('after', '#neighbor', 'font-size'), '24px');
        assert.equal(await value('before', '#target', 'font-size'), '24px');
        assert.equal(await main.webContents.executeJavaScript("getComputedStyle(document.getElementById('target')).fontSize"), '24px');
        assert.equal(await js("document.getElementById('review').classList.contains('ready')"), true);
        assert.equal(await js("document.getElementById('count').textContent"), '3');
        await screenshot('mirror-editor.png');
        await click('review');
        assert.equal(await js("document.getElementById('before-panel').hidden"), false);
        assert.equal(await js("document.querySelectorAll('#changes tbody tr').length"), 3);
        await screenshot('mirror-comparison.png');
        await click('export'); await until("document.getElementById('status').textContent.includes('exported')", 'export');
        const report = JSON.parse(fs.readFileSync(path.join(work, 'requests.json'), 'utf8'));
        assert.equal(report.exportAppliesChanges, false); assert.equal(report.captures[0].edits.length, 1);
        assert.equal(report.captures[0].edits[0].changes.find(c => c.property === 'font-size').before, '24px');
        assert(!JSON.stringify(report).includes('Private draft text'));
        checks.push('Exact heading-only font/size/color changes, unchanged source and neighbor, bright review button, paired views, request-only JSON');

        await click('back'); await click('reset-element'); await saved();
        assert.equal(await js("document.getElementById('review').disabled"), true);
        await click('undo'); await saved(); assert.equal(await js("document.getElementById('count').textContent"), '3');
        await choose('#disabled'); assert.equal(await js("document.getElementById('selected-label').textContent"), 'Unavailable action');
        await choose('#action'); await js("document.getElementById('after').contentDocument.querySelector('#action').click()");
        assert.equal(await main.webContents.executeJavaScript('window.actions'), 0);
        await choose('#field'); await set('edit-placeholder', 'Try this prompt'); await saved();
        assert.equal(await js("document.getElementById('after').contentDocument.querySelector('#field').placeholder"), 'Try this prompt');
        await choose('#popover-trigger'); await click('reveal');
        assert.equal(await js("document.getElementById('after').contentDocument.querySelector('#popup').matches(':popover-open')"), true);
        await set('workspace', 'generate', 'change'); await until("document.getElementById('after').contentDocument.querySelector('[data-capture-tab=generate]')?.hidden===false", 'workspace navigation');
        await choose('#other-heading'); await set('edit-text', 'Create an image'); await saved();
        await choose('[data-mirror-menu]'); await click('reveal');
        assert.equal(await js("document.getElementById('after').contentDocument.querySelector('.mirror-menu-popup').hidden"), false);
        checks.push('Reset/undo, disabled controls, inert action clicks, field placeholders, other mounted workspaces and native-menu proposals');

        await main.webContents.executeJavaScript("document.querySelector('#portal').showModal()");
        await click('capture'); await until("document.getElementById('captures').options.length===2", 'second capture');
        await until("document.getElementById('after').contentDocument.querySelector('#portal')?.matches(':modal')", 'portal modal');
        await choose('#portal h2'); await set('edit-text', 'New dialog title'); await saved();
        assert.equal(await js("document.getElementById('after').contentDocument.querySelector('#portal h2').textContent"), 'New dialog title');
        await main.webContents.executeJavaScript("document.querySelector('#portal').close()");
        const count = await js("document.getElementById('count').textContent");
        await manager.dispose(); for (const name of handlers.keys()) ipcMain.removeHandler(name); handlers.clear();
        create(); await manager.open(); await until(`document.getElementById('count').textContent===${JSON.stringify(count)}`, 'disk restoration');
        await until("document.getElementById('after').contentDocument.querySelector('#portal h2')?.textContent==='New dialog title'", 'restored proposal');
        assert.equal(await js("document.getElementById('captures').options.length"), 2);
        checks.push('New captures retain earlier requests, top-layer portal dialogs are editable, drafts survive a fresh manager/window');

        await choose('[data-mirror-menu]'); await set('edit-text', 'Files'); await set('note', 'Rearrange the native menu'); await saved();
        await main.webContents.executeJavaScript("document.querySelector('#field').value='Keep my typed prompt';document.querySelector('#field').focus()");
        await click('review'); await until("!document.getElementById('apply').disabled", 'application plan');
        assert.equal(await js("document.querySelectorAll('.application-blocked').length"), 2);
        assert.match(await js("document.getElementById('apply').textContent"), /Apply 6 changes/);
        assert.match((await js("window.designMirror.applyToApp({ticket:'invented'})")).error, /out of date/);
        await click('apply'); await until("document.getElementById('status').textContent.startsWith('6 changes applied')", 'apply live');
        assert.equal(await main.webContents.executeJavaScript("getComputedStyle(document.querySelector('#target')).fontSize"), '36px');
        assert.equal(await main.webContents.executeJavaScript("getComputedStyle(document.querySelector('#neighbor')).fontSize"), '24px');
        assert.equal(await main.webContents.executeJavaScript("document.querySelector('#field').placeholder"), 'Try this prompt');
        assert.equal(await main.webContents.executeJavaScript("document.querySelector('#field').value"), 'Keep my typed prompt');
        assert.equal(await main.webContents.executeJavaScript("document.activeElement.id"), 'field');
        assert.equal(await main.webContents.executeJavaScript("document.querySelector('#other-heading').textContent"), 'Create an image');
        assert.equal(await main.webContents.executeJavaScript("document.querySelector('#portal h2').textContent"), 'New dialog title');
        assert.equal(await value('before', '#target', 'font-size'), '24px');
        assert.equal(await js("document.getElementById('apply').disabled"), true);
        await main.webContents.executeJavaScript("document.querySelector('#action').click()");
        assert.equal(await main.webContents.executeJavaScript('window.actions'), 1);
        await main.webContents.executeJavaScript("(()=>{const h=document.createElement('h2');h.id='target';h.textContent='Your creative workspace';document.querySelector('#target').replaceWith(h)})()");
        await sleep(150);
        assert.equal(await main.webContents.executeJavaScript("getComputedStyle(document.querySelector('#target')).fontSize"), '36px');
        await screenshot('mirror-applied.png');
        checks.push('Explicit Apply updates exactly six ready changes; native menus/UX notes remain request-only; input, focus, actions, original comparison and remount replay are retained');

        await manager.dispose(); for (const name of handlers.keys()) ipcMain.removeHandler(name); handlers.clear();
        create(); await main.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(source));
        await manager.open(); await until("!document.getElementById('undo-application').disabled", 'persistent undo');
        assert.equal(await main.webContents.executeJavaScript("getComputedStyle(document.querySelector('#target')).fontSize"), '36px');
        assert.equal(await main.webContents.executeJavaScript("document.querySelector('#other-heading').textContent"), 'Create an image');
        await click('undo-application'); await until("document.getElementById('status').textContent.startsWith('Last application undone')", 'undo applied design');
        assert.equal(await main.webContents.executeJavaScript("getComputedStyle(document.querySelector('#target')).fontSize"), '24px');
        assert.equal(await main.webContents.executeJavaScript("document.querySelector('#other-heading').textContent"), 'Generate images');
        assert.equal(await main.webContents.executeJavaScript("document.querySelector('#field').placeholder"), 'Describe an idea');
        await click('review'); await until("!document.getElementById('apply').disabled", 'review before stale check');
        await main.webContents.executeJavaScript("document.querySelector('#target').firstChild.nodeValue='A different heading'");
        await click('apply'); await until("document.getElementById('status').textContent.includes('changed since review')", 'stale review rejected');
        assert.equal(await main.webContents.executeJavaScript("getComputedStyle(document.querySelector('#target')).fontSize"), '24px');
        assert.equal(await main.webContents.executeJavaScript("document.querySelector('#field').placeholder"), 'Describe an idea');
        await main.webContents.executeJavaScript("document.querySelector('#target').firstChild.nodeValue='Your creative workspace';document.querySelector('#target').after(document.querySelector('#target').cloneNode(true))");
        await click('refresh-application'); await until("document.querySelectorAll('.application-blocked').length===5", 'ambiguous targets blocked');
        await main.webContents.executeJavaScript("document.querySelectorAll('#target')[1].remove()");
        checks.push('Applied design and Undo survive a fresh host and renderer; stale review aborts the entire batch and ambiguous targets are rejected');

        assert.equal(await js("fetch('http://127.0.0.1:9/no-backend').then(()=>false,()=>true)"), true);
        assert.equal(await js("window.open('https://example.com')===null"), true);
        await js("(()=>{const d=document.getElementById('after').contentDocument;const s=d.createElement('script');s.textContent='window.parent.injectionRan=true';d.body.append(s);})()");
        assert.equal(await js('window.injectionRan===undefined'), true);
        checks.push('Network fetches, popups and scripts injected into the snapshot are blocked');

        mirror.setSize(900, 740); await sleep(100); await screenshot('mirror-narrow.png');
        assert(await js('document.documentElement.scrollWidth<=innerWidth'));
        if (process.argv.includes('--app')) {
            const { build } = await import('vite'), react = (await import('@vitejs/plugin-react')).default;
            const { appAsset, APP_HEADERS } = require('../electron/security');
            await build({ configFile: false, root, base: './', plugins: [react()], logLevel: 'error', worker: { format: 'es' }, assetsInclude: ['**/*.bin'],
                define: { __LAW_BUILD_INFO__: JSON.stringify({ build_id: 'ui-mirror-diagnostic' }) },
                build: { outDir: path.join(work, 'dist'), emptyOutDir: true, rollupOptions: { input: path.join(root, 'tests/fixtures/workspaceControls.html') } } });
            protocol.handle('app', request => { const file = appAsset(path.join(work, 'dist'), request.url); return new Response(fs.readFileSync(file), { headers: { ...APP_HEADERS,
                'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' }[path.extname(file)] || 'application/octet-stream') } }); });
            await main.loadURL('app://local/tests/fixtures/workspaceControls.html');
            for (let i = 0; i < 180; i++) { if (await main.webContents.executeJavaScript("!!document.querySelector('.workspace-navigation')")) break; await sleep(50); }
            await main.webContents.executeJavaScript("document.querySelector('[data-sidebar-route=dashboard]').click()");
            await sleep(300); await click('capture'); await until("document.getElementById('captures').options.length===3", 'real app capture');
            await until("document.getElementById('after').contentDocument.readyState==='complete' && !!document.getElementById('after').contentDocument.querySelector('[data-capture-tab=design-programming]')", 'real app copy');
            await click('back');
            assert((await js("document.getElementById('workspace').options.length")) > 30);
            await choose('.workspace-navigation > span'); await set('edit-font-size', '25'); await set('edit-text', 'My dashboard'); await saved();
            await click('review'); mirror.setSize(1480, 980); await sleep(100); await screenshot('mirror-actual-app.png');
            assert.equal(await value('after', '.workspace-navigation > span', 'font-size'), '25px');
            assert.notEqual(await main.webContents.executeJavaScript("getComputedStyle(document.querySelector('.workspace-navigation > span')).fontSize"), '25px');
            await until("!document.getElementById('apply').disabled", 'real app ready');
            await click('apply'); await until("document.getElementById('status').textContent.includes('applied and saved')", 'real app apply');
            assert.equal(await main.webContents.executeJavaScript("getComputedStyle(document.querySelector('.workspace-navigation > span')).fontSize"), '25px');
            assert.equal(await main.webContents.executeJavaScript("document.querySelector('.workspace-navigation > span').textContent"), 'My dashboard');
            await main.webContents.executeJavaScript("document.querySelector('[data-sidebar-route=chats]').click()"); await sleep(150);
            assert.notEqual(await main.webContents.executeJavaScript("document.querySelector('.workspace-navigation > span').textContent"), 'Dashboard');
            assert.notEqual(await main.webContents.executeJavaScript("getComputedStyle(document.querySelector('.workspace-navigation > span')).fontSize"), '25px');
            await main.webContents.executeJavaScript("document.querySelector('[data-sidebar-route=dashboard]').click()"); await sleep(150);
            assert.equal(await main.webContents.executeJavaScript("getComputedStyle(document.querySelector('.workspace-navigation > span')).fontSize"), '25px');
            assert.equal(await main.webContents.executeJavaScript("document.querySelector('.workspace-navigation > span').textContent"), 'My dashboard');
            await click('undo-application'); await until("document.getElementById('status').textContent.startsWith('Last application undone')", 'real app undo');
            assert.notEqual(await main.webContents.executeJavaScript("getComputedStyle(document.querySelector('.workspace-navigation > span')).fontSize"), '25px');
            assert.equal(await main.webContents.executeJavaScript("document.querySelector('.workspace-navigation > span').textContent"), 'Dashboard');
            assert.deepEqual(await main.webContents.executeJavaScript('window.workspaceControlsQA.errors'), []);
            const snap = await main.webContents.executeJavaScript(`(${captureDesignSnapshot.toString()})()`);
            checks.push(`Actual React build captured ${snap.nodes.length} editable elements across ${snap.workspaces.length} workspace slots; preview isolation, Apply, route-aware replay and Undo passed`);
        }
        assert.deepEqual(errors, []);
        fs.writeFileSync(path.join(work, 'report.json'), JSON.stringify({ ok: true, checks }, null, 2));
        console.log(JSON.stringify({ ok: true, checks, artifacts: work }, null, 2));
    }).catch(async error => {
        console.error(error);
        if (mirror && !mirror.isDestroyed()) {
            fs.writeFileSync(path.join(work, 'failure.txt'), await js('document.body.innerText').catch(() => 'unavailable'));
            await screenshot('failure.png').catch(() => {});
        }
        console.error('Artifacts:', work); process.exitCode = 1;
    }).finally(async () => { clearTimeout(timer); await manager?.dispose(); main?.destroy(); app.exit(process.exitCode || 0); });
}
