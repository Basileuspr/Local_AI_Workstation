// Production renderer smoke checks with synthetic data and a disposable profile.
// No real backend, models, user files, clipboard, or desktop actions are used.
const { app, BrowserWindow, ipcMain, protocol, net } = require("electron");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const { appAsset, APP_HEADERS, trustedUrl } = require("../electron/security");
const root = path.resolve(__dirname, ".."), work = fs.mkdtempSync(path.join(os.tmpdir(), "law-workspaces-qa-"));
app.setPath("userData", path.join(work, "profile"));
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
let win, backend;
const checked = [], failures = [];
const resultFile = process.env.LAW_WORKSPACES_QA_RESULT || path.join(work, "result.json");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { const end = Date.now() + 15000; while (Date.now() < end) { if (await fn()) return; await pause(100); } throw new Error("Timed out: " + label); }
app.whenReady().then(async () => {
    const chat = { id: "fixture-chat", title: "Workspace fixture", messages: [] };
    backend = http.createServer(async (request, response) => {
        const route = new URL(request.url, "http://fixture").pathname;
        if (request.method === "OPTIONS") {
            response.writeHead(204, { "Access-Control-Allow-Origin": "app://local", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" }); response.end(); return;
        }
        let value;
        if (route === "/status") value = { backend: { ok: true }, ollama: { reachable: true }, models: { chat_count: 2 }, knowledge_base: { ok: true, documents: 2 } };
        else if (route === "/models") value = { models: [{ name: "fixture-a", context_length: 8192 }, { name: "fixture-b", context_length: 8192 }] };
        else if (route === "/sessions/list") value = { sessions: [chat] };
        else if (route === "/sessions/fixture-chat") value = chat;
        else if (route === "/files/knowledge-base/list") value = { documents: [{ doc_id: "selected", filename: "selected.txt" }, { doc_id: "excluded", filename: "excluded.txt" }] };
        else if (route === "/sessions/fixture-chat/messages/append") { let raw = ""; for await (const chunk of request) raw += chunk; chat.messages.push(...JSON.parse(raw).messages); value = chat; }
        response.writeHead(value ? 200 : 404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "app://local" });
        response.end(JSON.stringify(value || { detail: "Synthetic backend" }));
    });
    await new Promise(resolve => backend.listen(0, "127.0.0.1", resolve));
    protocol.handle("app", async request => {
        const result = await net.fetch(pathToFileURL(appAsset(path.join(root, "dist"), request.url)).toString());
        return new Response(result.body, { headers: { ...Object.fromEntries(result.headers), ...APP_HEADERS } });
    });
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { preload: path.join(root, "electron/preload.js"), contextIsolation: true, nodeIntegration: false } });
    // Match the real application's subframe navigation boundary.
    win.webContents.on("will-frame-navigate", event => { if (!trustedUrl(event.url, null)) event.preventDefault(); });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("console-message", (_event, level, message) => { if (level === 3 && /Uncaught/.test(message)) failures.push(message); });
    ipcMain.on("app:connection", event => { event.returnValue = { base: `http://127.0.0.1:${backend.address().port}`, token: "fixture" }; });
    ipcMain.handle("app:startup-status", () => ({ phase: "ready" }));
    ipcMain.handle("media-manager:place", () => ({}));
    ipcMain.handle("app:capabilities", () => ({ features: {} }));
    ipcMain.handle("maintenance:import-status", () => ({ pending: false }));
    await win.loadURL("app://local/index.html"); win.showInactive();
    const host = code => win.webContents.executeJavaScript(`{ ${code} }`).catch(error => { throw new Error(`Renderer check failed: ${code}: ${String(error)}`); });
    const go = async tab => { await host(`document.querySelector('[data-sidebar-route="${tab}"]').click()`); await until(() => host(`!document.querySelector('[data-capture-tab="${tab}"]').hidden`), tab); };
    const click = (tab, label) => host(`[...document.querySelector('[data-capture-tab="${tab}"]').querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
    const fill = (selector, value) => host(`const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))`);
    await until(() => host("document.querySelector('#session-title')?.textContent==='Workspace fixture'"), "fixture chat");
    await go("markdown"); await fill("#markdown-source", "# Workspace fixture\n\n**Readable** text"); await click("markdown", "Show Markdown");
    assert.equal(await host("document.querySelector('#markdown-preview h1').textContent"), "Workspace fixture");
    await go("html-viewer");
    await fill('textarea[aria-label="HTML source"]', '<h1 id="fixture">Preview fixture</h1><script>document.body.dataset.executed="yes"</script><img src="https://example.invalid/private-resource">');
    await click("html-viewer", "Preview");
    await until(() => Promise.resolve(win.webContents.mainFrame.frames.some(frame => frame.url === "about:srcdoc")), "sandbox preview frame");
    win.webContents.debugger.attach("1.3");
    const cdp = (method, params = {}, sessionId) => win.webContents.debugger.sendCommand(method, params, sessionId);
    function nodes(node) { return [node,...(node.children || []).flatMap(nodes),...(node.contentDocument ? nodes(node.contentDocument) : [])]; }
    const attached = new Set();
    const previewBody = async () => {
        const {targetInfos} = await cdp("Target.getTargets");
        const target = targetInfos.find(item => item.type === "iframe" && item.url === "about:srcdoc" && !attached.has(item.targetId));
        assert(target, "Isolated sandbox target exists"); attached.add(target.targetId);
        const {sessionId} = await cdp("Target.attachToTarget", {targetId:target.targetId, flatten:true});
        await cdp("DOM.enable", {}, sessionId); await cdp("CSS.enable", {}, sessionId);
        const tree = nodes((await cdp("DOM.getDocument", {depth:-1,pierce:true}, sessionId)).root);
        return {body:tree.find(node => node.nodeName === "BODY"), sessionId};
    };
    const {body:htmlBody} = await previewBody();
    const rendered = nodes(htmlBody);
    assert(rendered.some(node => node.nodeName === "#text" && node.nodeValue === "Preview fixture"));
    assert(!htmlBody.attributes.includes("data-executed"));
    assert.equal(await host("document.querySelector('iframe[title=\"HTML preview\"]').getAttribute('sandbox')"), "");
    await go("css-viewer"); await fill('textarea[aria-label="CSS source"]', "body { color: rgb(12, 34, 56) }"); await click("css-viewer", "Preview");
    await until(() => Promise.resolve(win.webContents.mainFrame.frames.filter(item => item.url === "about:srcdoc").length === 2), "CSS preview frame");
    const {body:cssBody, sessionId} = await previewBody();
    const style = await cdp("CSS.getComputedStyleForNode", { nodeId:cssBody.nodeId }, sessionId);
    assert.equal(style.computedStyle.find(item => item.name === "color").value, "rgb(12, 34, 56)");
    win.webContents.debugger.detach();
    await go("markdown"); assert.equal(await host("document.querySelector('#markdown-preview h1').textContent"), "Workspace fixture");
    checked.push("Markdown persistence and native HTML/CSS sandbox rendering, blocked scripts");
    await go("spreadsheets");
    await host("const dt=new DataTransfer();dt.items.add(new File(['Name,Private\\nOne,exclude-me\\nTwo,other'],'fixture.csv',{type:'text/csv'}));document.querySelector('[data-capture-tab=spreadsheets] section').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}))");
    await until(() => host("document.querySelectorAll('.csv-table tbody tr').length===2"), "CSV import");
    await host("document.querySelectorAll('.csv-columns input')[1].click();document.querySelector('input[aria-label=\"Select row 1\"]').click()");
    await click("spreadsheets", "Use selected rows");
    await until(() => Promise.resolve(chat.messages.length === 1), "scoped CSV attachment");
    assert(chat.messages[0].content.includes('"One"')); assert(!chat.messages[0].content.includes("exclude-me")); assert(!chat.messages[0].content.includes('"Two"'));
    checked.push("CSV import and selected row/column scope excludes other data from chat");
    await go("canvas"); await click("canvas", "Rectangle");
    const rect = await host("const r=document.querySelector('canvas[aria-label=\"Whiteboard canvas\"]').getBoundingClientRect();({x:Math.round(r.x),y:Math.round(r.y)})");
    for (const [type, x, y] of [["mouseDown",30,40],["mouseMove",180,150],["mouseUp",180,150]]) {
        win.webContents.sendInputEvent({ type, x:rect.x+x, y:rect.y+y, button:"left", clickCount:1 }); await pause(100);
    }
    await until(() => host("JSON.parse(localStorage.getItem('local-ai-workstation-canvas-v1')).objects.length===1"), "canvas rectangle");
    await click("canvas", "Undo"); assert.equal(await host("JSON.parse(localStorage.getItem('local-ai-workstation-canvas-v1')).objects.length"), 0);
    await click("canvas", "Redo"); assert.equal(await host("JSON.parse(localStorage.getItem('local-ai-workstation-canvas-v1')).objects.length"), 1);
    await go("chats");
    await host("[...document.querySelectorAll('button')].find(b=>b.textContent==='Select / order models').click()");
    await host("document.querySelector('input[aria-label=\"Select fixture-b\"]').click();document.querySelector('button[aria-label=\"Move fixture-b up\"]').click()");
    assert.equal(await host("document.querySelector('#model-select').value"), "fixture-b");
    await host("document.querySelector('[aria-label=\"Select and order models\"] > button:last-child').click();[...document.querySelectorAll('button')].find(b=>b.textContent==='Knowledge: Off').click()");
    await until(() => host("document.querySelector('[aria-label=\"Knowledge scope\"]')!==null"), "Knowledge chooser");
    await host("const e=document.querySelector('[aria-label=\"Knowledge scope\"]');e.value='selected';e.dispatchEvent(new Event('change',{bubbles:true}))");
    await until(() => host("document.querySelectorAll('.knowledge-context-files input').length===2"), "Knowledge documents");
    await host("document.querySelector('.knowledge-context-files input').click()");
    await pause(350);
    const reload = new Promise(resolve => win.webContents.once("did-finish-load", resolve)); win.webContents.reload(); await reload;
    await until(() => host("document.querySelector('#model-select')?.value==='fixture-b'"), "model reload");
    await until(() => host("[...document.querySelectorAll('button')].some(b=>b.textContent==='Knowledge: 1 selected')"), "Knowledge reload");
    assert.equal(await host("JSON.parse(localStorage.getItem('local-ai-workstation-canvas-v1')).objects.length"), 1);
    checked.push("Canvas draw/undo/redo and reload persistence; model selection/order and Knowledge scope survive reload");
    assert.deepEqual(failures, []);
    fs.writeFileSync(resultFile, JSON.stringify({ ok: true, checked, storage: "temporary synthetic data only" }, null, 2));
}).catch(error => { fs.writeFileSync(resultFile, JSON.stringify({ error: error.stack || String(error), checked, failures }, null, 2)); process.exitCode = 1; }).finally(() => { backend?.close(); win?.destroy(); app.quit(); });
