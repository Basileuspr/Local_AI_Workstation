// Real React controls and production routes against disposable image fixtures.
// No user folders, existing catalogs, live models, or file modifications.
const { app, BrowserWindow, ipcMain, protocol, net } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { appAsset, APP_HEADERS, trustedUrl } = require('../electron/security');
const root = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'law-image-tagging-'));
const build = path.resolve(process.env.LAW_QA_TAG_BUILD || path.join(root, 'dist'));
app.setPath('userData', path.join(work, 'profile'));
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let win, child, finished = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  const end = Date.now() + 20000;
  while (Date.now() < end) { if (await fn()) return; await pause(80); }
  throw Error('Timed out: ' + label);
}
function finish(error) {
  if (finished) return; finished = true;
  child?.stdin.end('stop\n'); win?.destroy();
  const result = error ? {error:error.stack,work} : {passed:true,work,
    checks:['empty saved-tag picker', 'exact saved label without typing', 'bulk addition preserves each image tags',
      'repeat application is idempotent', 'untagged filter removes tagged selection', 'saved tags survive reload', 'original files unchanged',
      'adjustable page size and correct displayed counts', 'pagination uses selected page size', 'page-size changes keep selection and filters', 'page size survives reload',
      'compact view fits more smaller cards', 'density keeps selection and filters', 'density survives reload', 'comfortable view restores larger cards']};
  fs.writeFileSync(path.join(work,'result.json'), JSON.stringify(result,null,2));
  console.log(JSON.stringify(result)); app.exit(error ? 1 : 0);
}
setTimeout(() => finish(Error('Image tag QA timed out')), 70000).unref();
app.whenReady().then(async () => {
  child = spawn(path.join(root,'venv/Scripts/python.exe'), ['-B',path.join(root,'scripts/qa-image-manager-fixture.py'),work],
    {cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let stderr = ''; child.stderr.on('data', data => {stderr += data;});
  const connection = await new Promise((resolve,reject) => {
    let output = ''; const timer = setTimeout(() => reject(Error(stderr.slice(-2000))),25000);
    child.once('error', reject);
    child.stdout.on('data',data => {output += data; if(output.includes('\n')) {clearTimeout(timer);resolve(JSON.parse(output.split('\n')[0]));}});
  });
  protocol.handle('app', async request => {
    const response = await net.fetch(pathToFileURL(appAsset(build,request.url)).toString());
    return new Response(response.body,{headers:{...Object.fromEntries(response.headers),...APP_HEADERS}});
  });
  win = new BrowserWindow({show:false,width:1200,height:900,webPreferences:{preload:path.join(root,'electron/preload.js'),
    nodeIntegration:false,contextIsolation:true,offscreen:true,backgroundThrottling:false}});
  const trusted = event => event.sender===win.webContents && event.senderFrame===win.webContents.mainFrame && trustedUrl(event.senderFrame.url);
  ipcMain.on('app:connection',event => {event.returnValue=trusted(event)?connection:null;});
  ipcMain.handle('app:startup-status',()=>({state:'ready'})); ipcMain.handle('app:capabilities',()=>({features:{}}));
  for(const name of ['media-manager:place','viewer-browser:place']) ipcMain.handle(name,()=>{});
  ipcMain.handle('maintenance:import-status',()=>({active:false}));
  ipcMain.handle('github-publication:state',()=>null); ipcMain.handle('function-workflows:state',()=>null);
  const api = async (route,method='GET',body) => {
    const response = await fetch(connection.base+'/image-manager'+route,{method,
      headers:{'X-LAW-Session':connection.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const result = await response.json(); assert(response.ok,JSON.stringify(result)); return result;
  };
  const source = path.join(work,'image-source');
  await until(async()=>{try {await api('/state');return true;} catch {return false;}},'fixture backend ready');
  const folder = await api('/folders','POST',{path:source,purpose:'source'});
  await api('/tasks','POST',{kind:'scan',folder_ids:[folder.id],recursive:true});
  await until(async () => (await api('/state')).job?.status==='complete','fixture scan');
  const records = (await api('/images')).images;
  const first = records.find(row=>row.relative==='landscape.png'), second = records.find(row=>row.relative==='portrait.jpg');
  const donor = records.find(row=>row.relative==='landscape-copy.png'), tag = 'Client, archive & α';
  const originals = records.map(row=>({path:path.join(source,row.relative),bytes:fs.readFileSync(path.join(source,row.relative))}));
  const js = code => win.webContents.executeJavaScript(code);
  const openManager = async (count = 3) => {
    await win.loadURL('app://local/index.html');
    await until(()=>js("!!document.querySelector('[data-sidebar-route=image-manager]')"),'navigation');
    await js("document.querySelector('[data-sidebar-route=image-manager]').click()");
    await until(()=>js(`document.querySelectorAll('.im-grid article').length===${count}`),'image library');
  };
  const click = text => js(`(()=>{const b=[...document.querySelector('.image-manager').querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Button unavailable');b.click()})()`);
  const selectImage = name => js(`document.querySelector('[aria-label="Select ${name}"]').click()`);
  const pickTag = value => js(`(()=>{const e=document.querySelector('[aria-label="Existing tag for selected images"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await openManager(); await selectImage('landscape.png');
  assert(await js("document.querySelector('[aria-label=\"Existing tag for selected images\"]').disabled"));
  await api('/metadata','PATCH',{ids:[first.id],tags:['Landscape'],favorite:true});
  await api('/metadata','PATCH',{ids:[second.id],tags:['Portrait']});
  await api('/metadata','PATCH',{ids:[donor.id],tags:[tag]});
  await openManager(); await selectImage('landscape.png'); await selectImage('portrait.jpg');
  await until(()=>js(`!![...document.querySelector('[aria-label="Existing tag for selected images"]').options].find(o=>o.value===${JSON.stringify(tag)})`),'catalog saved-tag choice');
  assert.equal(await js("document.querySelector('[aria-label=\"Selected image tags\"]').value"),'');
  await pickTag(tag); await click('Add tag');
  await until(async()=> (await api('/images?tag='+encodeURIComponent(tag))).total===3,'bulk saved tag persisted');
  const after = (await api('/images')).images;
  assert.deepEqual(after.find(row=>row.id===first.id).tags,['Landscape',tag]);
  assert.equal(after.find(row=>row.id===first.id).favorite,1);
  assert.deepEqual(after.find(row=>row.id===second.id).tags,['Portrait',tag]);
  assert.deepEqual(after.find(row=>row.id===donor.id).tags,[tag]);
  await until(()=>js("document.querySelector('.im-selection').textContent.includes('2 selected') && ![...document.querySelectorAll('.im-selection button')].find(b=>b.textContent==='Add tag').disabled"),'selection retained after addition');
  await click('Add tag'); await pause(350);
  assert.deepEqual((await api('/images')).images.find(row=>row.id===first.id).tags,['Landscape',tag]);
  await api('/metadata','PATCH',{ids:[second.id],tags:[]});
  await openManager(); await js("document.querySelector('.im-extra-filters').open=true;[...document.querySelectorAll('.im-extra-filters label')].find(e=>e.textContent.includes('Untagged only')).querySelector('input').click()");
  await until(()=>js("document.querySelectorAll('.im-grid article').length===1"),'untagged-only image');
  await selectImage('portrait.jpg'); await pickTag(tag); await click('Add tag');
  await until(()=>js("document.querySelectorAll('.im-grid article').length===0 && document.querySelector('.im-selection').textContent.includes('0 selected')"),'tagged item and selection leave untagged filter');
  await openManager(); await selectImage('landscape.png');
  await until(()=>js(`document.querySelector('[aria-label="Existing tag for selected images"]').textContent.includes(${JSON.stringify(tag)})`),'saved choice after reload');
  assert(await js(`document.querySelector('[aria-label="Select landscape.png"]').closest('article').textContent.includes(${JSON.stringify(tag)})`));
  for(const original of originals) assert.deepEqual(fs.readFileSync(original.path),original.bytes);
  fs.writeFileSync(path.join(work,'existing-tag-picker.png'),(await win.webContents.capturePage()).toPNG());
  win.setSize(780,850); await pause(250);
  assert(await js("(()=>{const e=document.querySelector('.image-manager');return e.scrollWidth<=e.clientWidth+1})()"),'tag toolbar fits narrow pane');
  // A 52-image fixture proves increasing the limit actually displays more than
  // the previous fixed 48, including correct navigation from a partial last page.
  const scrollFolder = await api('/folders','POST',{path:path.join(work,'scroll-source'),purpose:'source'});
  await api('/tasks','POST',{kind:'scan',folder_ids:[scrollFolder.id]});
  await until(async()=> (await api('/state')).job?.status==='complete','large catalog scan');
  const select = (selector,value) => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await until(()=>js(`!![...document.querySelector('[aria-label="Filter image folder"]').options].find(o=>o.value===${JSON.stringify(scrollFolder.id)})`),'large folder choice');
  await click('Clear selection'); await select('[aria-label="Filter image folder"]',scrollFolder.id);
  await until(()=>js("document.querySelectorAll('.im-grid article').length===48 && document.querySelector('.im-selection [role=status]').textContent==='Showing 48 of 52 matches'"),'default displayed count');
  await js("document.querySelector('.im-grid article input[type=checkbox]').click()");
  await click('Next');
  await until(()=>js("document.querySelectorAll('.im-grid article').length===4 && document.querySelector('.im-pagination span').textContent==='49–52 of 52'"),'partial last page');
  await select('[aria-label="Images per page"]','24');
  await until(()=>js("document.querySelectorAll('.im-grid article').length===24 && document.querySelector('.im-pagination span').textContent==='1–24 of 52'"),'smaller size resets to first page');
  assert(await js("document.querySelector('.im-selection').textContent.includes('1 selected')"));
  await click('Next');
  await until(()=>js("document.querySelector('.im-pagination span').textContent==='25–48 of 52'"),'next page uses selected size');
  await select('[aria-label="Images per page"]','96');
  await until(()=>js("document.querySelectorAll('.im-grid article').length===52 && document.querySelector('.im-selection [role=status]').textContent==='Showing 52 of 52 matches'"),'increasing size displays all matches');
  assert.equal(await js("!!document.querySelector('.im-pagination')"),false);
  assert.equal(await js("document.querySelector('[aria-label=\"Filter image folder\"]').value"),scrollFolder.id);
  await click('Select page'); assert(await js("document.querySelector('.im-selection').textContent.includes('52 selected')"));
  await select('[aria-label="Images per page"]','1000');
  await pause(400); assert.equal(await js("document.querySelectorAll('.im-grid article').length"),52);
  assert(await js("(()=>{const e=document.querySelector('.image-manager');return e.scrollWidth<=e.clientWidth+1})()"),'display controls fit narrow pane');
  await openManager(55);
  assert.equal(await js("document.querySelector('[aria-label=\"Images per page\"]').value"),'1000');
  await select('[aria-label="Filter image folder"]',scrollFolder.id);
  await until(()=>js("document.querySelectorAll('.im-grid article').length===52"),'large display size persists after reload');
  fs.writeFileSync(path.join(work,'page-size-picker.png'),(await win.webContents.capturePage()).toPNG());
  win.setSize(1200,900); await pause(250);
  const geometry = () => js("(()=>{const grid=document.querySelector('.im-grid'),card=grid.firstElementChild;return {cardHeight:card.getBoundingClientRect().height,thumbnailHeight:card.querySelector('.im-image').getBoundingClientRect().height,columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length}})()");
  const comfortable = await geometry();
  await js("window.qaDensityCard=document.querySelector('.im-grid article');qaDensityCard.querySelector('input[type=checkbox]').click()");
  await select('[aria-label="Image Manager view density"]','compact');
  await until(()=>js("document.querySelector('.image-manager').dataset.density==='compact'"),'compact view');
  const compact = await geometry();
  assert(compact.cardHeight < comfortable.cardHeight && compact.thumbnailHeight < comfortable.thumbnailHeight);
  assert(compact.columns > comfortable.columns,'Compact displays more cards in each row');
  assert(await js("qaDensityCard===document.querySelector('.im-grid article') && document.querySelector('.im-selection').textContent.includes('1 selected')"));
  assert.equal(await js("document.querySelectorAll('.im-grid article').length"),52);
  assert.equal(await js("document.querySelector('[aria-label=\"Filter image folder\"]').value"),scrollFolder.id);
  assert.equal(await js("document.querySelector('[aria-label=\"Images per page\"]').value"),'1000');
  fs.writeFileSync(path.join(work,'compact-view.png'),(await win.webContents.capturePage()).toPNG());
  await openManager(55);
  assert.equal(await js("document.querySelector('.image-manager').dataset.density"),'compact');
  assert.equal(await js("document.querySelector('[aria-label=\"Image Manager view density\"]').value"),'compact');
  await select('[aria-label="Filter image folder"]',scrollFolder.id);
  await until(()=>js("document.querySelectorAll('.im-grid article').length===52"),'compact filtered grid restored');
  await select('[aria-label="Image Manager view density"]','comfortable');
  await until(()=>js("document.querySelector('.image-manager').dataset.density==='comfortable'"),'comfortable view');
  assert.equal((await geometry()).thumbnailHeight,comfortable.thumbnailHeight);
  win.setSize(780,850); await pause(250);
  assert(await js("(()=>{const e=document.querySelector('.image-manager');return e.scrollWidth<=e.clientWidth+1})()"),'comfortable density control fits narrow pane');
  await select('[aria-label="Image Manager view density"]','compact'); await pause(150);
  assert(await js("(()=>{const e=document.querySelector('.image-manager');return e.scrollWidth<=e.clientWidth+1})()"),'compact density control fits narrow pane');
  finish();
}).catch(finish);
