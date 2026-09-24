// Hidden, isolated integration check: real built React UI + real Media Manager,
// disposable reports and synthetic MP4 only; no Workstation backend is started.
const { app, BrowserWindow, WebContentsView, session, ipcMain, protocol, net } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const { createMediaManager } = require("../electron/mediaManager");
const { appAsset, APP_HEADERS, trustedUrl } = require("../electron/security");
const root = path.resolve(__dirname, "..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "law-media-manager-qa-"));
app.setPath("userData", path.join(work, "profile"));
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
let manager, win, backend;
let sessionRestoreFixture = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await predicate()) return; await pause(100); }
    throw new Error(`Timed out: ${label}`);
}
const checked = [];
const resultFile = process.env.LAW_MEDIA_MANAGER_QA_RESULT || path.join(work, "result.json");
console.log(`Media Manager QA result: ${resultFile}`);
app.whenReady().then(async () => {
    backend = http.createServer((_request, response) => {
        const route = new URL(_request.url, 'http://fixture').pathname;
        const sessions = [{ id: 'newest-chat', title: 'Newest fixture chat' }, { id: 'selected-chat', title: 'Selected fixture chat' }];
        const payload = sessionRestoreFixture ? (route === '/status' ? { backend: { ok: true }, ollama: { reachable: true }, models: { chat_count: 0 }, knowledge_base: { ok: true, documents: 0 } }
            : route === '/sessions/list' ? { sessions }
            : route === '/models' ? { models: [] }
            : sessions.some(item => route === '/sessions/' + item.id) ? { ...sessions.find(item => route === '/sessions/' + item.id), messages: [] } : null) : null;
        if (payload) { response.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'app://local' }); response.end(JSON.stringify(payload)); return; }
        response.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "app://local" });
        response.end('{"detail":"Isolated UI fixture: no host backend"}');
    });
    await new Promise(resolve => backend.listen(0, "127.0.0.1", resolve));
    protocol.handle("app", async request => {
        const result = await net.fetch(pathToFileURL(appAsset(path.join(root, "dist"), request.url)).toString());
        return new Response(result.body, { headers: { ...Object.fromEntries(result.headers), ...APP_HEADERS } });
    });
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { preload: path.join(root, "electron", "preload.js"), contextIsolation: true, nodeIntegration: false } });
    const trusted = event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && trustedUrl(event.senderFrame.url);
    ipcMain.on("app:connection", event => { event.returnValue = trusted(event) ? { base: `http://127.0.0.1:${backend.address().port}`, token: "fixture-host-secret" } : null; });
    manager = createMediaManager({ WebContentsView, session, getWindow: () => win,
        python: process.env.LAW_MEDIA_MANAGER_PYTHON || path.join(root, "venv", "Scripts", "python.exe"),
        directory: process.env.LAW_MEDIA_MANAGER_DIR || path.join(app.getPath("desktop"), "Media Organizer"), reports: path.join(work, "runs") });
    for (const [name, action] of Object.entries({ start: () => manager.start(), status: () => manager.status(), place: value => manager.place(value), focus: () => manager.focus(), refresh: () => manager.refresh() })) {
        ipcMain.handle(`media-manager:${name}`, (event, value) => trusted(event) ? action(value) : { error: "Denied" });
    }
    ipcMain.handle("maintenance:import-status", () => ({ pending: false }));
    await win.loadURL("app://local/index.html");
    const host = source => win.webContents.executeJavaScript(source);
    await until(() => host("!!document.querySelector('[data-media-manager-tab]')"), "React tab");
    assert.equal(win.contentView.children.length, 0, "Lazy launch");
    await host("localStorage.setItem('host-only-sentinel','private'); document.querySelector('[data-media-manager-tab]').click()");
    await until(() => manager.status().ready, "Media Manager ready");
    const view = win.contentView.children[0], media = source => view.webContents.executeJavaScript(`{ ${source} }`).catch(error => { throw new Error(`Media QA failed: ${source}: ${error.message}`); });
    await until(() => view.getVisible(), "visible embedded panel");
    assert.notEqual(view.webContents.session, win.webContents.session);
    const preferences = view.webContents.getLastWebPreferences();
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.nodeIntegration, false);
    assert.ok(!preferences.preload);
    assert.deepEqual(await media("({bridge:typeof window.workstationDesktop,node:typeof require,hostStorage:localStorage.getItem('host-only-sentinel'),title:document.title})"),
        { bridge: "undefined", node: "undefined", hostStorage: null, title: "Media Manager" });
    assert.equal(await media(`fetch('http://127.0.0.1:${backend.address().port}/').then(()=>false,()=>true)`), true);
    checked.push("separate session, no host bridge or storage, host network blocked");
    await host("[...document.querySelectorAll('button')].find(b=>b.textContent==='Enter Media Manager').click()");
    await until(()=>media("document.activeElement?.id==='mo-source'"), 'Enter Media Manager focuses source field');
    await until(()=>host("document.querySelector('.media-manager-access').textContent.includes('Media Manager focused')"), 'entry confirmation');
    checked.push('Enter Media Manager performs visible input focus and reports success');

    const source = path.join(work, "source"); fs.mkdirSync(source);
    const video = path.join(source, "VID_20200615_120000.mp4");
    const generated = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=teal:s=320x240:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", video], { windowsHide: true });
    assert.equal(generated.status, 0, generated.stderr?.toString());
    await media(`document.querySelector('#mo-source').value=${JSON.stringify(source)}; document.querySelector('#mo-destination').value=${JSON.stringify(path.join(work, "archive"))}; document.querySelector('#mo-scan').click()`);
    await until(() => media("document.querySelectorAll('.mo-media-grid .mo-media-card').length === 1"), "scanned media", 25000);
    await until(() => media("[...document.querySelectorAll('#mo-results img')].some(img=>img.naturalWidth > 0)"), "thumbnail");
    checked.push("real synthetic MP4 scan and thumbnail through unchanged module UI");
    await media("document.querySelector('#mo-add-custom-folder').click();document.querySelector('#mo-custom-name').value='Desktop QA folder';document.querySelector('#mo-custom-save').click()");
    await until(()=>media("!document.querySelector('#mo-custom-dialog').open"),'managed folder created');
    assert.ok(fs.statSync(path.join(work,'runs','managed-media','Custom Folders','Desktop QA folder')).isDirectory());
    await media(`document.querySelector('#mo-add-custom-folder').click();const mode=document.querySelector('#mo-custom-mode');mode.value='external';mode.dispatchEvent(new Event('change'));document.querySelector('#mo-custom-path').value=${JSON.stringify(work)};document.querySelector('#mo-custom-browse').click()`);
    await until(()=>media("!!document.querySelector('.mo-folder-picker [data-select]') && !document.querySelector('.mo-folder-picker [data-select]').disabled"),'in-app folder browser');
    await media("document.querySelector('.mo-folder-picker [aria-label=\"New subfolder name\"]').value='Browser QA';document.querySelector('.mo-folder-picker [data-create]').click()");
    await until(()=>media("document.querySelector('.mo-folder-picker [aria-label=\"Folder address\"]').value.endsWith('Browser QA') && !document.querySelector('.mo-folder-picker [data-select]').disabled"),'new subfolder browsable');
    await media("document.querySelector('.mo-folder-picker [data-select]').click()");
    await until(()=>media("document.querySelector('#mo-custom-path').value.endsWith('Browser QA')"),'chosen parent returned to form');
    await media("document.querySelector('#mo-custom-name').value='External QA';document.querySelector('#mo-custom-save').click()");
    await until(()=>media("!document.querySelector('#mo-custom-dialog').open"),'external folder saved');
    assert.ok(fs.statSync(path.join(work,'Browser QA','External QA')).isDirectory());
    checked.push('embedded in-app folder browser and managed/external folder creation use real isolated storage without a host bridge');
    await media("document.querySelector('#mo-duplicates-tab').click()");
    const contentsId = view.webContents.id;
    await host("[...document.querySelectorAll('button')].find(b=>b.textContent==='Dashboard').click()");
    await until(() => !view.getVisible(), "hidden when switching tabs");
    await host("document.querySelector('[data-media-manager-tab]').click()");
    await until(() => view.getVisible(), "return to media tab");
    assert.equal(win.contentView.children.length, 1);
    assert.equal(view.webContents.id, contentsId);
    assert.equal(await media("document.querySelector('#mo-duplicates-tab').getAttribute('aria-selected')"), "true");
    checked.push("tab switching preserves separate viewer state without duplicate processes");
    win.setSize(800, 850);
    await until(() => host("document.querySelector('.sidebar-shell').getAttribute('role') === 'dialog'"), "compact React layout");
    await host("document.querySelector('.compact-menu-button').click()");
    await until(() => host("document.querySelector('#app').classList.contains('navigation-open')"), "drawer opened");
    await until(() => !view.getVisible(), "navigation drawer hides native view");
    await host("document.querySelector('.navigation-close').click()");
    await until(() => view.getVisible(), "drawer close restores view");
    view.webContents.sendInputEvent({ type: "keyDown", keyCode: "F6" });
    await until(() => host("document.activeElement===document.querySelector('.compact-menu-button')"), "F6 navigation return");
    checked.push("compact navigation, resize and keyboard escape to host");


    // The parser must be visible without opening More actions in either viewer.
    await media("const ui=document.querySelector('media-organizer');ui.showDetail(ui.data.records[0].RecordId)");
    assert.equal(await media("document.querySelectorAll('#mo-detail .mo-item-actions > [data-tool=frames]').length"), 1);
    assert.equal(await media("document.querySelector('#mo-detail .mo-item-more').open"), false);
    await media("document.querySelector('#mo-detail .mo-item-actions > [data-tool=frames]').click()");
    await until(()=>media("!!document.querySelector('#mo-frame-interval')"), 'parser opens from enlarged library preview');
    assert.equal(await media("document.querySelector('#mo-frame-end').value"), '25');
    await media("document.querySelector('[data-tool-close]').click();const ui=document.querySelector('media-organizer');window.qaPreviewData=ui.data;const row=ui.data.records[0];ui.data={...ui.data,records:[{...row,DuplicateGroup:'qa-group',DuplicatePrimary:'yes'},{...row,RecordId:'qa-copy',DuplicateGroup:'qa-group',DuplicatePrimary:'no'}]};ui.showDuplicate(row.RecordId)");
    assert.equal(await media("document.querySelectorAll('#mo-duplicate-viewer .mo-item-actions > [data-tool=frames]').length"), 1);
    assert.equal(await media("document.querySelector('#mo-duplicate-viewer .mo-item-more').open"), false);
    await media("document.querySelector('#mo-duplicate-viewer .mo-item-actions > [data-tool=frames]').click()");
    await until(()=>media("!!document.querySelector('#mo-frame-interval')"), 'parser opens from enlarged duplicate preview');
    assert.equal(await media("document.querySelector('#mo-frame-end').value"), '25');
    await media("document.querySelector('[data-tool-close]').click();const ui=document.querySelector('media-organizer');ui.data=window.qaPreviewData;ui.renderLibrary()");
    checked.push('Parse frames is directly visible in enlarged library and duplicate previews; both count the selected real synthetic video');

    // Exercise the display limit against in-memory copies of synthetic media only.
    await media("document.querySelector('media-organizer').switchTab('library'); const ui=document.querySelector('media-organizer'); window.qaOriginalData=ui.data; ui.data={...ui.data,records:Array.from({length:205},(_,i)=>({...ui.data.records[0],RecordId:'qa-'+i,OriginalFilename:'QA '+i+'.mp4'}))}; ui.filters={query:'',year:'',category:'',review:false,order:'newest'}; ui.renderLibrary()");
    assert.deepEqual(await media("[...document.querySelector('#mo-page-size').options].map(o=>o.value)"), ['5','10','20','40','50','80','100','200','ALL']);
    for (const size of ['5','10','20','40','50','80','100','200','ALL']) {
        await media(`const select=document.querySelector('#mo-page-size');select.value='${size}';select.dispatchEvent(new Event('change'))`);
        assert.equal(await media("document.querySelectorAll('#mo-results .mo-media-card').length"), size === 'ALL' ? 205 : Number(size));
    }
    await media("window.scrollTo(0,1200)");
    await pause(100);
    assert.ok(await media("Math.abs(document.querySelector('.mo-display-toolbar').getBoundingClientRect().top)<2"), 'Selector floats at top during scrolling');
    await media("document.querySelector('#mo-page-size').value='5';document.querySelector('#mo-page-size').dispatchEvent(new Event('change'));document.querySelector('#mo-more').click()");
    assert.equal(await media("document.querySelectorAll('#mo-results .mo-media-card').length"), 10);
    await media("document.querySelector('#mo-search').value='QA';document.querySelector('#mo-search').dispatchEvent(new Event('input'))");
    assert.equal(await media("document.querySelectorAll('#mo-results .mo-media-card').length"), 5);
    await media("const ui=document.querySelector('media-organizer');ui.data=window.qaOriginalData;ui.filters={query:'',year:'',category:'',review:false,order:'newest'};ui.renderLibrary();ui.switchTab('duplicates')");
    const mediaReload = new Promise(resolve => view.webContents.once('did-finish-load', resolve));
    view.webContents.reload(); await mediaReload;
    await until(()=>media("document.querySelector('media-organizer')?.data?.records?.length===1"), 'media reload restores saved scan');
    assert.equal(await media("document.querySelector('#mo-page-size').value"), '5');
    assert.equal(await media("document.querySelector('media-organizer').tab"), 'duplicates');
    checked.push('all nine batch options, ALL beyond 200, selected-size load more, filters, sticky toolbar, saved preference and embedded tab reload');

    win.setSize(1440, 1000);
    const routes = ['dashboard','queue','chats','library','knowledge','images','generate','review','image-editor','workflows','faces','character-parts','lora','media-manager'];
    for (const route of routes) {
        await host(`document.querySelector('[data-sidebar-route="${route}"]').click()`);
        await until(()=>host(`document.querySelector('[data-sidebar-route="${route}"]').getAttribute('aria-current')==='page'`), `navigate ${route}`);
        const reloaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
        await host("document.querySelector('.workspace-refresh').click()");
        await reloaded;
        await until(()=>host(`document.querySelector('[data-sidebar-route="${route}"]')?.getAttribute('aria-current')==='page'`), `restore ${route}`);
    }
    await until(()=>view.getVisible(), 'embedded workspace visible after host refresh');
    assert.equal(view.webContents.id, contentsId);
    assert.equal(await media("document.querySelector('media-organizer').tab"), 'duplicates');
    checked.push('Refresh button reloads all 14 routes in place; embedded refresh keeps existing isolated view and selected inner tab');

    sessionRestoreFixture = true;
    await host("localStorage.setItem('local-ai-workstation-navigation-v1', JSON.stringify({tab:'faces',sessionId:'selected-chat'}))");
    const chatReload = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    win.webContents.reload(); await chatReload;
    await until(()=>host("document.querySelector('#session-title')?.textContent==='Selected fixture chat'"), 'restore selected chat instead of newest');
    assert.equal(await host("document.querySelector('[data-sidebar-route=faces]').getAttribute('aria-current')"), 'page');
    checked.push('Full renderer reload restores an older selected chat without navigating away from Faces');
    const url = view.webContents.getURL();
    manager.dispose();
    await until(async () => { try { await fetch(url); return false; } catch { return true; } }, "child server exits after parent pipe closes");
    assert.ok(fs.existsSync(video), "Scan preserves source");
    fs.writeFileSync(resultFile, JSON.stringify({ ok: true, checked, reports: "temporary only" }, null, 2));
}).catch(error => { fs.writeFileSync(resultFile, JSON.stringify({ error: error.stack, checked }, null, 2)); console.error(error.stack); process.exitCode = 1; }).finally(() => {
    manager?.dispose(); backend?.close(); win?.destroy(); app.quit();
});
