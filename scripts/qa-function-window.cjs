// A disposable WPF window verifies real UI Automation, pointer paste and
// screenshot plumbing. It never opens or sends requests to a user application.
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { execFile } = require('node:child_process');
const assert = require('node:assert/strict');
const { automateWindows } = require('../electron/functionAutomation');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'law-window-qa-'));
  const title = 'LAW Function QA ' + path.basename(work);
  const executable = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const child = execFile(executable, ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'qa-function-window.ps1'), '-FixtureDirectory', work], { windowsHide: true, timeout: 65000 });
  let stderr = ''; child.stderr.on('data', data => { stderr += data; });
  const closed = new Promise(resolve => child.once('exit', resolve));
  async function received(test) {
    const end = Date.now() + 3000;
    while (Date.now() < end) { try { const text = await fs.readFile(path.join(work, 'received.txt'), 'utf8'); if (test(text)) return text; } catch {} await delay(25); }
    throw Error('Fixture did not record the expected input.');
  }
  try {
    const end = Date.now() + 15000;
    while (Date.now() < end) { try { await fs.stat(path.join(work, 'ready.flag')); break; } catch { await delay(100); } }
    assert(await fs.stat(path.join(work, 'ready.flag')), stderr || 'Fixture did not open');
    const window = (await automateWindows({ action: 'windows' })).windows.find(window => window.title === title);
    assert(window, 'Window picker must return real process/title');
    const inspected = await automateWindows({ action: 'controls', window, diagnostics: true });
    const controls = inspected.controls;
    const field = controls.find(control => control.name === 'QA request field'), button = controls.find(control => control.name === 'Record QA request');
    assert(field?.canSet, JSON.stringify(inspected)); assert(button?.canInvoke, JSON.stringify(inspected));
    await automateWindows({ action: 'set', window, control: field, text: 'Inspection QA' });
    await assert.rejects(() => automateWindows({ action: 'set', window, control: field, text: 'Overwrite' }), /draft/);
    await automateWindows({ action: 'invoke', window, control: button });
    assert.equal(await received(text => text === 'Inspection QA'), 'Inspection QA');
    const capture = await automateWindows({ action: 'capture', window });
    assert(capture.image.startsWith('data:image/png;base64,')); assert(capture.width > 100); assert(capture.height > 100);
    const point = { x: 100, y: 85, width: capture.width, height: capture.height };
    await assert.rejects(() => automateWindows({ action: 'pointer-click', window, point: { ...point, width: point.width + 20 } }), /size changed/);
    await automateWindows({ action: 'pointer-paste', window, point, text: ' POINT_QA ' });
    await automateWindows({ action: 'invoke', window, control: button });
    const pasted = await received(text => text.includes('POINT_QA'));
    assert(pasted.includes('POINT_QA'), 'Pointed paste must reach the field');
    assert.equal(pasted.replace(' POINT_QA ', ''), 'Inspection QA', 'Pointed paste must preserve existing characters');
    const picked = await automateWindows({ action: 'pick-pointer' });
    assert.equal(picked.window.title, title); assert.equal(picked.point.width, capture.width);
    await automateWindows({ action: 'pointer-click', window, point: { ...point, x: 100, y: 140 } });
    console.log(JSON.stringify({ ok: true, checks: ['real window/control selection', 'verified field fill', 'existing draft refused', 'exact button invocation', 'real PNG capture', 'resized window refused', 'pointed paste preserved draft', 'pointed button click'], width: capture.width, height: capture.height }));
  } finally {
    await fs.writeFile(path.join(work, 'close.flag'), 'close');
    await Promise.race([closed, delay(3000)]);
    if (child.exitCode === null) child.kill();
    // Remove only this freshly created temporary fixture directory.
    const target = path.resolve(work);
    if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('law-window-qa-')) throw Error('Unexpected fixture cleanup path.');
    await fs.rm(target, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
