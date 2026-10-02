// Real manager interfaces and real file operations against generated, disposable
// fixtures only. No user folders, live backend, models or existing reports.
const { app, BrowserWindow, ipcMain, protocol, net } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { appAsset, APP_HEADERS, trustedUrl } = require('../electron/security');
const root = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'law-manager-deletion-'));
const resultFile = process.env.LAW_DELETE_QA_RESULT || path.join(work, 'result.json');
const build = path.resolve(root, process.env.LAW_DELETE_QA_BUILD || 'dist');
app.setPath('userData', path.join(work, 'profile'));
// The second fixture starts between windows; keep the QA process alive there.
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const checks = [], children = [], errors = [];
let win;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await pause(100); }
  throw Error('Timed out: ' + label);
}
async function fixture(script, args, cwd = root) {
  const child = spawn(path.join(root, 'venv/Scripts/python.exe'), ['-B', ...(Array.isArray(script)?script:[script]), ...args], {cwd,windowsHide:true,stdio:['pipe','pipe','pipe']});
  children.push(child); let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  return new Promise((resolve, reject) => {
    let output = ''; const timer = setTimeout(() => reject(Error('Fixture failed: ' + stderr.slice(-2000))), 35000);
    child.once('error', error => {clearTimeout(timer);reject(error);});
    child.once('exit', code => {if(!output.includes('\n')){clearTimeout(timer);reject(Error('Fixture exited '+code+': '+stderr.slice(-2000)));}});
    child.stdout.on('data', data => {
      output += data;
      if (output.includes('\n')) { clearTimeout(timer); try {resolve(JSON.parse(output.split('\n')[0]));} catch(error){reject(error);} }
    });
  });
}
app.whenReady().then(async () => {
  const connection = await fixture(path.join(root,'scripts/qa-image-manager-fixture.py'),[work]);
  protocol.handle('app', async request => {
    const response = await net.fetch(pathToFileURL(appAsset(build, request.url)).toString());
    return new Response(response.body,{headers:{...Object.fromEntries(response.headers),...APP_HEADERS}});
  });
  win = new BrowserWindow({show:false,width:1440,height:1050,webPreferences:{preload:path.join(root,'electron/preload.js'),contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});
  win.webContents.on('console-message', (_event, ...args) => {if(String(args).includes('Uncaught'))errors.push(String(args));});
  const trusted = event => event.sender===win.webContents && event.senderFrame===win.webContents.mainFrame && trustedUrl(event.senderFrame.url);
  ipcMain.on('app:connection', event => {event.returnValue=trusted(event)?connection:null;});
  ipcMain.handle('app:startup-status', () => ({state:'ready'}));
  ipcMain.handle('app:capabilities', () => ({features:{}}));
  for(const name of ['media-manager:place','viewer-browser:place'])ipcMain.handle(name,()=>{});
  ipcMain.handle('maintenance:import-status',()=>({active:false}));
  ipcMain.handle('github-publication:state',()=>null);ipcMain.handle('function-workflows:state',()=>null);
  const source=path.join(work,'image-source');
  ipcMain.handle('image-manager:choose-folder',event=>{assert(trusted(event));return {path:source};});
  const api=async(route,method='GET',body)=>{
    const response=await fetch(connection.base+'/image-manager'+route,{method,headers:{'X-LAW-Session':connection.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const value=await response.json();assert(response.ok,JSON.stringify(value));return value;
  };
  await until(async()=>{try{await api('/state');return true;}catch{return false;}},'image backend');
  const js=code=>win.webContents.executeJavaScript(code);
  const click=async(text,scope='.image-manager')=>{
    const code=`(()=>{const button=[...document.querySelector(${JSON.stringify(scope)})?.querySelectorAll('button')||[]].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!button||button.disabled)return false;button.click();return true})()`;
    await until(()=>js(code),'button '+text);
  };
  await win.loadURL('app://local/index.html');
  await until(()=>js("!!document.querySelector('[data-sidebar-route=image-manager]')"),'image tab');
  await js("document.querySelector('[data-sidebar-route=image-manager]').click()");
  await click('+ Add source folder');await until(()=>js("document.querySelector('.im-folder-list')?.textContent.includes('image-source')"),'source registered');
  await click('Scan folders');await until(()=>js("document.querySelectorAll('.im-grid article').length===3"),'three original images');
  const original=fs.readFileSync(path.join(source,'landscape.png'));
  const imageDelete=async()=>{
    await until(()=>js("!!document.querySelector('[aria-label=\"Delete landscape-copy.png\"]') && !document.querySelector('[aria-label=\"Delete landscape-copy.png\"]').disabled"),'image Delete enabled');
    await js("document.querySelector('[aria-label=\"Delete landscape-copy.png\"]').click()");
    await until(()=>js("document.querySelector('.im-dialog')?.open"),'image delete review');
    assert.equal(await js("document.querySelectorAll('.im-dialog tbody tr').length"),1);
  };
  await imageDelete();await click('Cancel','.im-dialog');
  assert(fs.existsSync(path.join(source,'landscape-copy.png')));
  await imageDelete();await click('Delete reviewed files','.im-dialog');
  await until(()=>js("document.querySelectorAll('.im-grid article').length===2"),'single image deleted');
  assert(!fs.existsSync(path.join(source,'landscape-copy.png')));
  assert.deepEqual(fs.readFileSync(path.join(source,'landscape.png')),original);
  await click('Trash (1)');await until(()=>js("document.querySelectorAll('.im-trash tbody tr').length===1"),'image Trash');
  await click('Restore');await click('Restore reviewed files','.im-dialog');
  await until(()=>js("document.querySelector('.im-trash')?.textContent.includes('Trash is empty')"),'image restored');
  assert.deepEqual(fs.readFileSync(path.join(source,'landscape-copy.png')),original);
  checks.push('Image Manager visible per-copy Delete, read-only Cancel, exact-copy deletion, Trash and single Restore');
  await click('Library');await until(()=>js("document.querySelectorAll('.im-grid article').length===3"),'restored image library');
  await js("document.querySelector('[aria-label=\"Select landscape-copy.png\"]').click();document.querySelector('[aria-label=\"Select portrait.jpg\"]').click()");
  await click('Delete selected (2)');await until(()=>js("document.querySelectorAll('.im-dialog tbody tr').length===2"),'image bulk review');
  await click('Delete reviewed files','.im-dialog');await until(()=>js("document.querySelectorAll('.im-grid article').length===1"),'bulk images deleted');
  await click('Trash (2)');await until(()=>js("document.querySelectorAll('.im-trash tbody tr').length===2"),'two images in Trash');
  await click('Select shown files');await click('Restore selected (2)');await click('Restore reviewed files','.im-dialog');
  await until(()=>js("document.querySelector('.im-trash')?.textContent.includes('Trash is empty')"),'bulk image restore');
  await click('Library');await until(()=>js("document.querySelectorAll('.im-grid article').length===3"),'bulk restored images');
  await imageDelete();await click('Delete reviewed files','.im-dialog');await until(()=>js("document.querySelectorAll('.im-grid article').length===2"),'copy back in Trash');
  const imageTrash=(await api('/trash')).entries[0].trash_path;
  await click('Trash (1)');await until(()=>js("document.querySelectorAll('.im-trash tbody tr').length===1"),'permanent image review target');
  await click('Delete permanently');assert(fs.existsSync(imageTrash));
  await click('Permanently delete reviewed files','.im-dialog');
  await until(()=>js("document.querySelector('.im-trash')?.textContent.includes('Trash is empty')"),'image purge');
  assert(!fs.existsSync(imageTrash));assert.deepEqual(fs.readFileSync(path.join(source,'landscape.png')),original);
  fs.writeFileSync(path.join(work,'image-trash-preview.png'),(await win.webContents.capturePage()).toPNG());
  checks.push('Image Manager reviewed bulk delete/restore and separate permanent deletion retain the unselected duplicate');
  win.destroy();win=null;

  const fixtureData=await fixture(['-m','tests.ui_fixture_server'],['--duplicates'],path.join(root,'media-manager'));
  win=new BrowserWindow({show:false,width:1440,height:1050,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,offscreen:true,backgroundThrottling:false}});
  await win.loadURL(fixtureData.url);
  const media=code=>win.webContents.executeJavaScript(`{${code}}`);
  await until(()=>media("!!document.querySelector('#mo-source')"),'media UI');
  await media(`document.querySelector('#mo-source').value=${JSON.stringify(fixtureData.source)};document.querySelector('#mo-destination').value=${JSON.stringify(fixtureData.destination)};document.querySelector('#mo-scan').click()`);
  await until(()=>media("document.querySelector('media-organizer').data?.records?.length===5 && !document.querySelector('media-organizer').busy"),'five generated media',35000);
  const copies=await media("document.querySelector('media-organizer').data.records.filter(row=>row.OriginalPath.includes('Backup copy')).map(row=>({id:row.RecordId,path:row.CurrentPath}))");
  assert.equal(copies.length,2);
  const keep=path.join(fixtureData.source,'VID_20200615_120000.mp4'),keepBytes=fs.readFileSync(keep);
  const mediaClick=async selector=>until(()=>media(`const b=document.querySelector(${JSON.stringify(selector)});if(!b||b.disabled)false;else{b.click();true}`),'media button '+selector);
  const mediaReady=label=>until(()=>media("!document.querySelector('media-organizer').busy && !document.querySelector('#mo-tools-dialog').open"),label);
  await mediaClick('#mo-show-duplicates');
  await mediaClick(`[data-tool="delete"][data-record="${copies[0].id}"]`);
  assert(await media("document.querySelector('#mo-tools-dialog').textContent.includes('Other copies remain')"));
  await mediaClick('[data-tool-close]');assert(fs.existsSync(copies[0].path));
  await mediaClick(`[data-tool="delete"][data-record="${copies[0].id}"]`);await mediaClick('#mo-file-submit');await mediaReady('single media deleted');
  assert(!fs.existsSync(copies[0].path));assert.deepEqual(fs.readFileSync(keep),keepBytes);
  await mediaClick('#mo-trash-view');await until(()=>media("document.querySelectorAll('#mo-results .mo-media-card').length===1"),'media Trash');
  await mediaClick('[data-tool="restore"]');await mediaClick('#mo-file-submit');await mediaReady('single media restore');
  assert(fs.existsSync(copies[0].path));assert.equal(await media("document.querySelector('media-organizer').filters.status"),'trash');
  await mediaClick('#mo-trash-view');
  await media(`for(const id of ${JSON.stringify(copies.map(row=>row.id))})document.querySelector('[data-select-media="'+id+'"]').click()`);
  // Keep selection while a filename filter hides one copy. Review must include both.
  await media("document.querySelector('#mo-search').value='20200615';document.querySelector('#mo-search').dispatchEvent(new Event('input'))");
  await mediaClick('#mo-delete-selected');assert.equal(await media("document.querySelectorAll('.mo-delete-review>p').length"),2);
  await mediaClick('#mo-bulk-delete-submit');await mediaReady('media bulk deletion');
  assert(copies.every(row=>!fs.existsSync(row.path)));assert.deepEqual(fs.readFileSync(keep),keepBytes);
  await media("document.querySelector('#mo-search').value='';document.querySelector('#mo-search').dispatchEvent(new Event('input'))");
  await mediaClick('#mo-trash-view');await until(()=>media("document.querySelectorAll('#mo-results .mo-media-card').length===2"),'two media Trash files');
  await mediaClick('#mo-select-matching');await mediaClick('#mo-restore-selected');await mediaClick('#mo-bulk-delete-submit');await mediaReady('media bulk restore');
  assert(copies.every(row=>fs.existsSync(row.path)));assert.equal(await media("document.querySelector('media-organizer').filters.status"),'trash');
  await mediaClick('#mo-trash-view');await mediaClick(`[data-tool="delete"][data-record="${copies[0].id}"]`);await mediaClick('#mo-file-submit');await mediaReady('media copy deleted again');
  const mediaTrash=await media(`document.querySelector('media-organizer').data.records.find(row=>row.RecordId===${JSON.stringify(copies[0].id)}).CurrentPath`);
  await mediaClick('#mo-trash-view');await mediaClick('[data-tool="purge"]');assert(fs.existsSync(mediaTrash));
  await mediaClick('#mo-file-submit');await mediaReady('permanent media deletion');
  assert(!fs.existsSync(mediaTrash));assert.deepEqual(fs.readFileSync(keep),keepBytes);assert(fs.existsSync(copies[1].path));
  fs.writeFileSync(path.join(work,'media-trash-preview.png'),(await win.webContents.capturePage()).toPNG());
  checks.push('Media Manager visible Delete, Cancel, reviewed bulk selection including filtered copies, single/bulk Restore, filter retention and separate permanent deletion');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,checks}));fs.writeFileSync(resultFile,JSON.stringify({ok:true,checks},null,2));
}).catch(async error=>{
  console.error(error.stack);
  const diagnostics=win&&!win.isDestroyed()?await win.webContents.executeJavaScript("({alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent),dialogs:[...document.querySelectorAll('dialog')].map(e=>({open:e.open,text:e.textContent})),job:document.querySelector('.im-job')?.textContent,mediaJob:document.querySelector('#mo-notice')?.textContent})").catch(()=>null):null;
  if(win&&!win.isDestroyed())fs.writeFileSync(path.join(work,'failure.png'),(await win.webContents.capturePage()).toPNG());
  fs.writeFileSync(resultFile,JSON.stringify({error:error.stack,checks,diagnostics,work},null,2));process.exitCode=1;
}).finally(async()=>{
  win?.destroy();
  for(const child of children)if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.stdin.end('stop\n');await Promise.race([exited,pause(2500)]);if(child.exitCode===null){child.kill();await Promise.race([exited,pause(2500)]);}}
  // Preserve screenshots/results for review. Fixtures clean up their own media.
  app.exit(process.exitCode||0);
});
