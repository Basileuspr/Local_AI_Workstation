// Real Chromium UI, worker and PNG checks in a hidden profile; no backend or user data.
const { app, BrowserWindow, protocol, net } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { appAsset, APP_HEADERS } = require('../electron/security');
const root = path.resolve(__dirname, '..'), work = fs.mkdtempSync(path.join(os.tmpdir(), 'law-editor-crop-qa-'));
const result = process.env.LAW_IMAGE_CROP_QA_RESULT || path.join(work, 'result.json');
const checks = [], downloads = [];
let win;
app.setPath('userData', path.join(work, 'profile'));
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await predicate()) return; await pause(100); }
  throw Error(`Timed out: ${label}`);
}
app.whenReady().then(async () => {
  protocol.handle('app', async request => {
    const response = await net.fetch(pathToFileURL(appAsset(path.join(root, 'tmp/image-editor-crop-qa'), request.url)).toString());
    return new Response(response.body, { headers: { ...Object.fromEntries(response.headers), ...APP_HEADERS } });
  });
  win = new BrowserWindow({ show: false, width: 1500, height: 1000, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
  win.webContents.on('console-message', event => { if (event.level >= 2) process.stderr.write(`${event.message}\n`); });
  const js = async source => {
    try { return await win.webContents.executeJavaScript(source); }
    catch (error) { throw Error(`${source.slice(0, 220)}: ${error.message}`); }
  };
  const click = label => js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Missing or disabled: '+${JSON.stringify(label)});b.click();})()`);
  const ready = () => until(() => js("!!document.querySelector('.ie-stage img')?.naturalWidth && document.querySelector('.ie-stage img').complete && !document.querySelector('.ie-import input')?.disabled && !document.querySelector('.ie-toolbar').textContent.includes('Updating')"), 'edited preview');
  const field = (label, value) => js(`(()=>{const e=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event(e instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`);
  const cropFields = async (x, y, width, height) => {
    for (const [label, value] of [['left', x], ['top', y], ['width', width], ['height', height]]) await field(`Crop ${label}`, value);
  };
  const exported = async name => {
    const count = downloads.length;
    await click('Export edited PNG'); await until(() => downloads.length > count, name);
    assert.equal(downloads.at(-1).state, 'completed');
    fs.renameSync(downloads.at(-1).file, path.join(work, name));
  };
  win.webContents.session.on('will-download', (_event, item) => {
    const file = path.join(work, item.getFilename()); item.setSavePath(file);
    item.once('done', (_event, state) => downloads.push({ file, state }));
  });
  await win.loadURL('app://local/tests/fixtures/imageEditor.html');
  await until(() => js("!!document.querySelector('[aria-label=\"Open image for editing\"]')"), 'editor');
  const createFile = `(width,height)=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');const pixels=context.createImageData(width,height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;pixels.data.set([x%256,y%256,(x+y)%256,(x<20?0:x<40?128:255)],i);}context.putImageData(pixels,0,0);return new File([Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0))],'source.png',{type:'image/png'});}`;
  async function open(width = 640, height = 400) {
    await js(`(()=>{const transfer=new DataTransfer();transfer.items.add((${createFile})(${width},${height}));const input=document.querySelector('[aria-label="Open image for editing"]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await ready();
  }
  async function drag(from, to, target = 'svg') {
    const positions = await js(`(()=>{const svg=document.querySelector('.ie-crop-overlay'),r=svg.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};})()`);
    const start = { x: Math.round(positions.x + positions.w * from[0]), y: Math.round(positions.y + positions.h * from[1]) };
    const end = { x: Math.round(positions.x + positions.w * to[0]), y: Math.round(positions.y + positions.h * to[1]) };
    if (target === 'svg') {
      // Start outside the selection so the gesture draws a new rectangle.
      assert.ok(await js(`document.elementFromPoint(${start.x},${start.y})?.closest('.ie-crop-overlay') !== null`));
    }
    win.webContents.sendInputEvent({ type: 'mouseDown', ...start, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseMove', ...end, button: 'left' });
    win.webContents.sendInputEvent({ type: 'mouseUp', ...end, button: 'left', clickCount: 1 });
    await pause(150);
  }
  await open(); await exported('baseline.png');
  await click('Crop');
  await until(() => js("document.querySelector('.ie-crop-overlay')?.getBoundingClientRect().width > 100"), 'crop overlay');
  await drag([.95,.95], [.2,.25]);
  assert.ok(await js("Number(document.querySelector('[aria-label=\"Crop width\"]').value)>400"));
  await cropFields(20, 40, 200, 150);
  await drag([120/640, 115/400], [160/640, 135/400], 'move');
  assert.ok(await js("Math.abs(Number(document.querySelector('[aria-label=\"Crop left\"]').value)-60)<=1"));
  assert.equal(await js("document.querySelector('[aria-label=\"Crop width\"]').value"), '200');
  await cropFields(20, 40, 200, 150);
  await drag([220/640, 40/400], [250/640, 30/400], 'corner');
  assert.ok(await js("Math.abs(Number(document.querySelector('[aria-label=\"Crop width\"]').value)-230)<=1 && Math.abs(Number(document.querySelector('[aria-label=\"Crop top\"]').value)-30)<=1"));
  await cropFields(20, 40, 200, 150);
  await js("document.querySelector('.ie-crop-tools').scrollIntoView({block:'start'})"); await pause(100);
  fs.writeFileSync(path.join(work, 'crop-desktop.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
  await click('Apply crop'); await ready(); await exported('crop.png');
  assert.equal(await js("document.querySelector('.ie-stage img').naturalWidth"), 200);
  await click('Show original'); await ready();
  assert.equal(await js("document.querySelector('.ie-stage img').naturalWidth"), 640);
  await click('Show edited'); await ready();
  await click('Undo'); await ready(); await exported('undo.png');
  await click('Redo'); await ready(); await exported('redo.png');
  await click('Crop'); await cropFields(10, 10, 100, 80); await click('Apply crop'); await ready(); await exported('second-crop.png');
  await click('Remove last crop'); await ready(); await exported('removed-crop.png');
  await click('Increase contrast'); await ready(); await exported('crop-contrast.png'); await click('Reset'); await ready();
  await field('Reference color application', 'brush'); await field('Reference color', '#cc4422');
  await ready();
  await click('Apply color to image');
  await js("(()=>{const img=document.querySelector('.ie-stage img'),r=img.getBoundingClientRect();img.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}));})()");
  await ready(); await exported('crop-color.png'); await click('Reset'); await ready();
  checks.push('Fit pointer drawing in reverse, moving selection, exact fields, successive crops, Undo/Redo and Remove last crop');
  checks.push('Original comparison remains uncropped; contrast and brush color edits operate on the cropped pixels');
  await click('Crop'); await cropFields(0, 0, 50, 50); await click('Cancel crop');
  await exported('cancel.png');
  await click('Crop'); await js("document.querySelector('.image-editor').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  assert.equal(await js("!!document.querySelector('.ie-crop-overlay')"), false);
  await click('Start from original'); await ready(); await click('Rotate right'); await ready();
  await click('Crop'); await cropFields(20, 40, 200, 300); await click('Apply crop'); await ready(); await exported('rotated-crop.png');
  await click('Rotate right'); await ready(); await exported('crop-then-rotate.png');
  checks.push('Cancel and Escape discard selection; crops after rotation and rotation after cropping preserve geometry');
  await click('Start from original'); await ready();
  await open(3200, 900); await exported('large-baseline.png');
  await click('Crop'); await cropFields(180, 90, 900, 450); await click('Apply crop'); await ready(); await exported('large-fit-crop.png');
  await click('Undo'); await ready(); await field('Preview size', '200'); await ready();
  await click('Crop'); await cropFields(3199, 899, 1, 1); await click('Apply crop'); await ready(); await exported('one-pixel.png');
  await click('Undo'); await ready(); await field('Preview size', 'fit'); await ready();
  await click('Crop'); await cropFields(0, 20, 3200, 1); await click('Apply crop'); await ready(); await exported('thin-crop.png');
  checks.push('Fit crops use full-resolution pixels above the preview limit; 200% supports a one-pixel edge crop');
  await js(`window.editorCropQA.openInline((${createFile})(640,400))`); await ready();
  await click('Crop'); await cropFields(20, 40, 200, 150); await click('Apply crop'); await ready();
  await click('Send edited image to chat'); await until(() => js('!!window.editorCropSaved'), 'chat save callback');
  const saved = await js('window.editorCropSaved');
  assert.equal(saved.name, 'source-edited.png'); assert.equal(saved.recipe.stages.length, 1);
  assert.ok(saved.recipe.stages[0].crop); fs.writeFileSync(path.join(work, 'chat.png'), Buffer.from(saved.bytes));
  checks.push('Inline chat editor saves cropped PNG and crop recipe through its existing callback');
  win.setSize(420, 850); await pause(250); await click('Crop');
  assert.ok(await js("document.querySelector('.image-editor').scrollWidth <= document.querySelector('.image-editor').clientWidth+1"));
  await js("document.querySelector('.ie-crop-tools').scrollIntoView({block:'start'})"); await pause(100);
  fs.writeFileSync(path.join(work, 'crop-mobile.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
  checks.push('420px crop controls fit without horizontal overflow');
  const verified = spawnSync(path.join(root, 'venv/Scripts/python.exe'), ['-c', `from pathlib import Path
from PIL import Image, ImageChops
import sys
p=Path(sys.argv[1]); load=lambda n:Image.open(p/n).convert('RGBA')
a=load('baseline.png'); expected=a.crop((20,40,220,190))
def same(actual,expected):
 assert actual.size==expected.size,(actual.size,expected.size)
 assert actual.getchannel('A').tobytes()==expected.getchannel('A').tobytes()
 assert max(max(pair) for pair in ImageChops.difference(actual,expected).getextrema())<=1
for n in ['crop.png','redo.png','removed-crop.png','cancel.png','chat.png']:same(load(n),expected)
same(load('undo.png'),a);same(load('second-crop.png'),expected.crop((10,10,110,90)))
contrast=load('crop-contrast.png');color=load('crop-color.png')
for edited in [contrast,color]:
 assert edited.size==expected.size
 assert edited.getchannel('A').tobytes()==expected.getchannel('A').tobytes()
 assert edited.tobytes()!=expected.tobytes()
assert color.getpixel((100,75))!=expected.getpixel((100,75));assert color.getpixel((150,100))==expected.getpixel((150,100))
r=a.transpose(Image.Transpose.ROTATE_270).crop((20,40,220,340))
same(load('rotated-crop.png'),r);same(load('crop-then-rotate.png'),r.transpose(Image.Transpose.ROTATE_270))
large=load('large-baseline.png');same(load('large-fit-crop.png'),large.crop((180,90,1080,540)));same(load('one-pixel.png'),large.crop((3199,899,3200,900)));same(load('thin-crop.png'),large.crop((0,20,3200,21)))
print('PNG dimensions, retained pixels and alpha match expected crops in all exported results')`, work], { windowsHide: true, encoding: 'utf8' });
  assert.equal(verified.status, 0, verified.stderr); checks.push(verified.stdout.trim());
  fs.writeFileSync(result, JSON.stringify({ ok: true, checks, work }, null, 2));
}).catch(error => { fs.writeFileSync(result, JSON.stringify({ error: error.stack, checks, work }, null, 2)); process.exitCode = 1; }).finally(() => { win?.destroy(); app.exit(process.exitCode || 0); });
