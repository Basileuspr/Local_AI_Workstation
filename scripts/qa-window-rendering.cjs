// Exercise the production desktop and real Windows compositor in a separate
// profile/data folder. No model inference or access to normal saved chats.
const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
if (!process.env.LAW_USER_DATA_DIR || !process.env.LAW_DATA_DIR || !process.env.LAW_QA_RESULT)
    throw new Error('Isolated QA profile, data and result paths are required.');
let finished = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function finish(result) {
    if (finished) return;
    finished = true; fs.writeFileSync(process.env.LAW_QA_RESULT, JSON.stringify(result, null, 2)); app.quit();
}
setTimeout(() => finish({ error: 'Window rendering QA timed out.' }), 55000).unref();
require('../electron/main');
app.whenReady().then(async () => {
  try {
    let win;
    for (let attempt = 0; attempt < 100; attempt++) {
      win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().startsWith('app://local/index.html?'));
      if (win && !win.webContents.isLoading()
        && await win.webContents.executeJavaScript('!!document.querySelector("[aria-label=\\"Workspace options\\"]")')) {
        // The shell helper is launched hidden. Windows may apply its initial
        // SW_HIDE to Electron's first show, so explicitly present this QA window.
        if (!win.isVisible()) win.showInactive();
        if (win.isVisible() && !win.isMinimized() && !win.webContents.getBackgroundThrottling()) break;
      }
      await pause(200);
    }
    assert(win, 'Production window loaded');
    assert(win.isVisible() && !win.isMinimized(), 'Production window finished showing');
    const js = code => win.webContents.executeJavaScript(code);
    const result = { electron: process.versions.electron, chromium: process.versions.chrome, visible: win.isVisible(), offscreen: win.webContents.isOffscreen(),
      display: { scale: screen.getDisplayMatching(win.getBounds()).scaleFactor }, features: app.getGPUFeatureStatus() };
    result.initial = await js('window.workstationDesktop.renderingStatus()');
    assert.equal(result.initial.activeMode, process.env.LAW_QA_EXPECT_MODE || 'compatible');
    assert.equal(win.webContents.getBackgroundThrottling(), false);
    if (result.initial.activeMode === 'compatible') {
      assert.notEqual(result.features.rasterization, 'enabled', 'Compatibility paints text/page tiles on the CPU');
      assert.notEqual(result.features.gpu_compositing, 'disabled_software', 'Compatibility retains GPU composition');
    }
    await js(`window.layoutNotifications = 0; window.addEventListener('workstation:window-layout', () => window.layoutNotifications++);
      window.originalRoot = document.querySelector('#root');
      document.querySelector('[aria-label="Workspace options"]').click();`);
    await pause(200);
    assert(await js('!document.querySelector(".workspace-options .disclosure-panel").hidden'));
    const menu = await win.webContents.capturePage();
    fs.writeFileSync(path.join(path.dirname(process.env.LAW_QA_RESULT), 'menu-open.png'), menu.toPNG());
    await js(`document.querySelector('.workspace-appearance').click()`); await pause(250);
    assert(await js('document.querySelector(".appearance-dialog").open'));
    await js(`window.draftField = document.createElement('textarea'); draftField.value = 'Keep this unsaved draft';
      document.querySelector('.appearance-preview').append(draftField); draftField.focus(); draftField.setSelectionRange(5,9);`);
    const beforeBounds = win.getBounds();
    // Exercise a real native select without moving/resizing the window.
    const rect = await js(`(()=>{const r=document.querySelector('.window-rendering-settings select').getBoundingClientRect();return {x:r.x+15,y:r.y+r.height/2}})()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: Math.round(rect.x), y: Math.round(rect.y) });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: Math.round(rect.x), y: Math.round(rect.y) });
    await pause(150); win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ESC' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ESC' }); await pause(150);
    assert.deepEqual(win.getBounds(), beforeBounds, 'Dropdown needs no window movement');
    // A changed text node alone must reach native repaint recovery. The old
    // test changed a colored block and used capturePage, which could not prove
    // that Windows presented ordinary text-only updates without capture/resize.
    const beforeText = await js('window.workstationDesktop.renderingStatus()');
    await js(`window.textProbe = document.createElement('div'); textProbe.id='qa-text-repaint';
      textProbe.style.cssText='position:fixed;top:160px;left:300px;width:580px;height:180px;overflow:hidden;background:#fff;color:#111;border:2px solid #222;z-index:2147483647;padding:14px;box-sizing:border-box;font:20px/1.5 Consolas,monospace;pointer-events:none';
      textProbe.innerHTML='<p style="margin:0">Text update 0</p><p style="margin:0">Previous text must disappear.</p><p style="margin:0">Only text changes. Window stays still.</p>';
      document.querySelector('.appearance-dialog').append(textProbe); window.qaTextFrame=0;`);
    for (let frame = 0; frame < 30; frame++) {
      await js(`textProbe.firstElementChild.firstChild.data='Text update ${frame}'; textProbe.children[1].firstChild.data=${JSON.stringify(frame % 2 ? 'Short line.' : 'A much longer previous line should clear completely.')}`);
      await pause(25);
    }
    await pause(300);
    const afterText = await js('window.workstationDesktop.renderingStatus()');
    assert(afterText.repaintCount > beforeText.repaintCount, 'Text-only updates caused actual native window invalidation');
    assert(afterText.repaintCount - beforeText.repaintCount < 20, 'Streaming changes are coalesced');
    assert.deepEqual(win.getBounds(), beforeBounds, 'Text repaint never moves or resizes the window');
    result.textOnlyRepaints = afterText.repaintCount - beforeText.repaintCount;
    const hold = Math.min(40000, Math.max(0, Number(process.env.LAW_QA_HOLD_MS) || 0));
    if (hold) {
      win.setTitle('Rendering test — Local AI Workstation');
      await js(`window.qaTextInterval=setInterval(()=>{qaTextFrame++;textProbe.firstElementChild.firstChild.data='Live text update '+qaTextFrame;
        textProbe.children[1].firstChild.data=qaTextFrame%2?'Short line.':'A much longer previous line should clear completely.';},200)`);
      if (process.env.LAW_QA_READY) fs.writeFileSync(process.env.LAW_QA_READY, JSON.stringify({title:win.getTitle(),phase:'text-only updates',mode:result.initial.activeMode,bounds:win.getBounds()}));
      await pause(hold); await js('clearInterval(qaTextInterval)');
      result.liveTextFrames = await js('qaTextFrame');
    }
    await js('textProbe.remove()');
    await js(`window.paintProbe = document.createElement('span'); paintProbe.style.cssText = 'display:block;width:64px;height:32px;flex:0 0 64px'; document.querySelector('.appearance-dialog header').append(paintProbe);`);
    const probe = await js(`(()=>{const r=paintProbe.getBoundingClientRect();return {x:Math.round(r.x+8),y:Math.round(r.y+8),width:16,height:16}})()`);
    result.updatedFrames = [];
    for (const color of ['rgb(255,0,0)', 'rgb(0,255,0)', 'rgb(255,0,0)', 'rgb(0,255,0)']) {
      await js(`paintProbe.style.background = ${JSON.stringify(color)}`); await pause(100);
      const pixels = (await win.webContents.capturePage(probe)).toBitmap();
      assert(pixels.length >= 4, 'Visible compositor supplied pixels');
      const green = color.includes('0,255,0');
      assert(green ? pixels[1] > 220 && pixels[0] < 30 && pixels[2] < 30 : Math.max(pixels[0],pixels[2]) > 220 && pixels[1] < 30, 'New pixels painted without a window resize');
      result.updatedFrames.push(color);
    }
    await js('paintProbe.remove()');
    const initialNotifications = await js('window.layoutNotifications');
    win.hide(); await pause(120); assert.equal(win.webContents.getBackgroundThrottling(), true);
    win.show(); await pause(250); assert.equal(win.webContents.getBackgroundThrottling(), false);
    assert(await js(`window.layoutNotifications > ${initialNotifications}`));
    win.minimize(); await pause(150); assert.equal(win.webContents.getBackgroundThrottling(), true);
    win.restore(); await pause(200); assert.equal(win.webContents.getBackgroundThrottling(), false);
    // Exercise the real renderer's response to display notifications and zoom.
    const display = screen.getDisplayMatching(win.getBounds());
    screen.emit('display-metrics-changed', {}, display, ['scaleFactor']); await pause(200);
    const beforeZoom = await js('window.layoutNotifications');
    win.webContents.setZoomFactor(1.25); await pause(250);
    assert(await js(`window.layoutNotifications > ${beforeZoom}`), 'DPI/zoom re-measure reached the renderer');
    win.webContents.setZoomFactor(1); await pause(200);
    win.setSize(800, 900); await pause(200); win.setSize(1200, 800); await pause(200);
    result.preserved = await js(`({ root: originalRoot === document.querySelector('#root'), draft: draftField.value, selection: [draftField.selectionStart,draftField.selectionEnd] })`);
    assert.deepEqual(result.preserved, { root: true, draft: 'Keep this unsaved draft', selection: [5,9] });
    // Manual recovery also preserves the renderer, drafts, and window bounds.
    const beforeManual = win.getBounds();
    await js(`document.querySelector('.appearance-dialog [aria-label="Close appearance settings"]').click(); document.querySelector('[aria-label="Workspace options"]').click()`);
    await pause(150);
    await js("document.querySelector('.workspace-redraw').click()"); await pause(250);
    assert.deepEqual(win.getBounds(), beforeManual);
    assert(await js('originalRoot === document.querySelector("#root")'));
    await js("document.querySelector('[aria-label=\"Workspace options\"]').click(); document.querySelector('.workspace-appearance').click()"); await pause(250);
    // Use the actual settings UI, so the preload, sender guard and persistence
    // are checked together. Saving never reloads/restarts the current session.
    await js(`(()=>{const e=document.querySelector('.window-rendering-settings select');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'software');e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await pause(200);
    result.saved = await js('window.workstationDesktop.renderingStatus()');
    assert.equal(result.saved.savedMode, 'software');
    assert.equal(result.saved.activeMode, result.initial.activeMode);
    result.notificationCount = await js('window.layoutNotifications');
    result.renderingText = await js('document.querySelector(".window-rendering-settings").innerText');
    assert(result.renderingText.includes('Quit from the system tray') || result.initial.activeMode === 'software');
    const image = await win.webContents.capturePage(); assert(!image.isEmpty());
    fs.writeFileSync(path.join(path.dirname(process.env.LAW_QA_RESULT), 'settings-restored.png'), image.toPNG());
    finish({ ...result, passed: true });
  } catch (error) { finish({ error: error.stack }); }
});
