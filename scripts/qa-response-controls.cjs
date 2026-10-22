// Synthetic, isolated Chromium checks. Start workspaceControls.config.mjs first.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'law-response-controls-')));
const output = path.resolve(process.env.LAW_CONTROL_AUDIT_DIR || 'artifacts/response-controls');
fs.mkdirSync(output, { recursive: true });
let win; const checks = [], errors = [], watchdog = setTimeout(() => app.exit(1), 90000);
app.whenReady().then(async () => {
  win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.on('console-message', event => { if (event.level === 'error' || event.level === 3) errors.push(event.message); });
  const js = code => win.webContents.executeJavaScript(code, true);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (code, label) => { for (let i = 0; i < 150; i++) { if (await js(code)) return; await pause(50); } throw Error('Timed out: ' + label); };
  const verify = async (code, label) => { assert(await js(code), label); checks.push(label); };
  const click = async label => { await js(`[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===${JSON.stringify(label)}&&n.checkVisibility()).click()`); await pause(80); };
  const fill = async (selector, value) => { await js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));})()`); await pause(80); };
  await win.loadURL('http://127.0.0.1:5298/tests/fixtures/responseControls.html');
  await wait("document.querySelector('.code-blackboard')", 'code block');
  await js("document.querySelector('[aria-label=\"Chat options\"]').click()"); await pause(80);
  await fill('.chat-options [aria-label="Maximum output tokens"]', '1537');
  await verify('responseControlQA.state.responseLength===1537&&responseControlQA.state.numPredict===1537', 'custom token count stays exact in both desktop settings');
  await click('Model / roleplay settings');
  await js("document.querySelector('.sliders-toggle').focus()");
  win.webContents.focus();
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' }); await pause(80);
  await verify("document.querySelector('.sliders-toggle').getAttribute('aria-expanded')==='true'", 'Advanced parameters opens with the keyboard');
  await verify("[...document.querySelectorAll('.sliders-grid input,.sliders-grid textarea,.sliders-grid select')].every(n=>n.getAttribute('aria-label')||n.labels?.length)", 'advanced controls have accessible names');
  await fill('.sliders-grid [aria-label="Maximum output tokens"]', '3001');
  await verify('responseControlQA.state.responseLength===3001', 'advanced settings updates the same exact output cap');
  await fill('.sliders-grid [aria-label="Maximum output tokens"]', '0');
  await verify("responseControlQA.state.responseLength===3001&&document.querySelector('.sliders-grid [aria-invalid=true]')", 'invalid values retain the applied cap and show an error');
  await click('Close settings');
  for (const [width, height] of [[1200,800], [390,844]]) {
    win.setContentSize(width, height); await pause(100);
    if (width === 390) await click('Phone renderer');
    await js("(()=>{const block=document.querySelector('.code-blackboard');block.scrollIntoView({block:'start'});block.scrollTop=500;block.querySelector('pre').scrollLeft=300;})()"); await pause(80);
    fs.writeFileSync(path.join(output, `layout-${width}.json`),JSON.stringify(await js("(()=>{const b=document.querySelector('.code-blackboard'),c=b.querySelector('button');return {board:b.getBoundingClientRect().toJSON(),button:c.getBoundingClientRect().toJSON(),height:getComputedStyle(c).minHeight}})()")));
    await verify("(()=>{const board=document.querySelector('.code-blackboard').getBoundingClientRect(), button=document.querySelector('[aria-label=\"Copy code\"]').getBoundingClientRect();return button.height>=44&&button.top>=board.top&&button.bottom<=board.bottom&&button.left>=board.left&&button.right<=board.right;})()", `copy button stays visible after both scroll directions at ${width}px`);
    await click('Copy code');
    await verify("responseControlQA.copied.at(-1)===document.querySelector('.code-blackboard code').textContent", `copy preserves exact code at ${width}px`);
    await verify('document.documentElement.scrollWidth<=innerWidth', `no page overflow at ${width}px`);
    fs.writeFileSync(path.join(output, `blackboard-${width}.png`), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'response-controls.json'), JSON.stringify({ passed: true, checks, limitations: 'Synthetic fixtures and intercepted clipboard; physical phone and real model quality are not tested.' }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length }));
  clearTimeout(watchdog); win.destroy(); app.quit();
}).catch(error => { console.error(error); clearTimeout(watchdog); win?.destroy(); app.exit(1); });
