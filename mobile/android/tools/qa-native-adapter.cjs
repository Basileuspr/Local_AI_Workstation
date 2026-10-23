// Real Chromium clicks against an isolated synthetic viewer. This does not test
// Android APIs, real pairing, the private VPN or the physical phone.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'law-apk-adapter-'));
app.setPath('userData', path.join(work, 'profile'));
let win, server;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = setTimeout(() => { console.error('QA timeout'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><html><body><dialog class="viewer"><h2>Original image</h2><div class="row"><a id="save" href="/api/media/library/test-image?download=true" download="test.png">Download original</a><button id="share">Prepare to share</button><button id="close">Close</button></div></dialog><script>window.messages=[];window.originalClicks=0;window.LawAndroid={postMessage:value=>messages.push(JSON.parse(value))};document.querySelector("dialog").showModal();document.querySelector("#share").addEventListener("click",()=>originalClicks++);</script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  win = new BrowserWindow({ show: false, width: 440, height: 800, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
  win.webContents.focus();
  await delay(500);
  win.webContents.debugger.attach('1.3');
  const js = code => win.webContents.executeJavaScript(code);
  const adapter = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/native-companion.js'), 'utf8');
  await js(adapter); await js(adapter); // Idempotent after repeated page callbacks.
  const click = async id => {
    const rect = await js(`(()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...rect });
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...rect });
    await delay(100);
  };
  await js('document.getElementById("share").click()');
  assert.deepEqual(await js('messages'), [], 'Script clicks cannot request native transfers');
  await click('share');
  assert.deepEqual(await js('messages'), [{ action: 'share', path: '/api/media/library/test-image?download=true' }]);
  assert.equal(await js('originalClicks'), 1, 'Native share suppresses only the real browser-share handler');
  await click('save');
  assert.equal((await js('messages')).at(-1).action, 'save');
  await js('document.getElementById("save").href="https://outside.example/api/media/library/test-image?download=true"');
  await click('share');
  assert.equal((await js('messages')).length, 2, 'Foreign origins cannot request image transfer');
  await js('document.getElementById("save").href="/api/media/library/test-image?token=secret"');
  await click('share');
  assert.equal((await js('messages')).length, 2, 'Extra query parameters are rejected');
  await js('document.getElementById("save").href="/api/media/session/s/m/i?download=true";document.getElementById("share").textContent="Share image"');
  await click('share');
  assert.deepEqual((await js('messages')).at(-1), { action: 'share', path: '/api/media/session/s/m/i?download=true' });
  await click('close');
  assert.equal((await js('messages')).length, 3, 'Close remains a normal viewer action');
  const result = { passed: true, checks: 8, runtime: process.versions.chrome, scope: 'Synthetic Chromium adapter only; Android/phone acceptance remains pending.' };
  fs.mkdirSync(path.join(__dirname, '../output'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '../output/adapter-qa.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}).then(() => { clearTimeout(timeout); win?.destroy(); server?.close(); app.exit(0); }).catch(error => { console.error(error); clearTimeout(timeout); win?.destroy(); server?.close(); app.exit(1); });
