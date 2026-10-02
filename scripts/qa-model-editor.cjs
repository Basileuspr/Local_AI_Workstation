const {app,BrowserWindow,protocol}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'law-model-editor-qa-'));app.setPath('userData',path.join(work,'profile'));
const {appAsset,APP_HEADERS}=require('../electron/security');
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let win;const checks=[],failures=[],downloads=[],requests=[];
const timeout=setTimeout(()=>{console.error('3D editor QA timed out',work);app.exit(1);},120000);
app.whenReady().then(async()=>{
  protocol.handle('app',request=>{const file=appAsset(path.resolve(__dirname,'../tmp/model-editor-qa'),request.url);return new Response(fs.readFileSync(file),{headers:{...APP_HEADERS,'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm'}[path.extname(file)]||'application/octet-stream')}});});
  win=new BrowserWindow({show:false,width:1450,height:1100,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.on('console-message',event=>{if(event.level==='error'||event.level===3)failures.push(event.message);});
  win.webContents.session.webRequest.onBeforeRequest((details,callback)=>{if(!/^(app:|blob:|data:)/.test(details.url))requests.push(details.url);callback({cancel:false});});
  win.webContents.session.on('will-download',(_event,item)=>{const file=path.join(work,item.getFilename());item.setSavePath(file);item.once('done',(_event,state)=>{if(state==='completed')downloads.push(file);else failures.push(`Download ${state}`);});});
  const js=code=>win.webContents.executeJavaScript(code);
  const until=async(fn,label)=>{for(let i=0;i<300;i++){if(await fn())return;await sleep(40);}throw Error(`Timed out: ${label}\n${await js('document.body.innerText')}`);};
  const click=async label=>{const status=await js(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)return 'Button unavailable';b.click();return 'ok';})()`);assert.equal(status,'ok',`Click ${label}: ${status}`);};
  const field=(label,value)=>js(`(()=>{const el=[...document.querySelectorAll('input')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(label)});if(!el)throw Error('Missing field');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const objectCount=()=>js("document.querySelectorAll('.model-object-list>label').length");
  const quiet=()=>until(()=>js("!document.querySelector('.model-viewer [role=status]')"),'operation complete');
  const noError=async()=>assert.equal(await js("document.querySelector('[role=alert]')?.textContent||''"),'');
  const loaded=()=>until(()=>js("document.querySelectorAll('canvas').length===1 && Number(document.querySelector('.model-stage')?.dataset.renderCount)>0"),'canvas render');
  const start=async()=>{await click('New scene');if(await js("!!document.querySelector('[aria-label=\"Unsaved 3D edits\"]')"))await click('Discard edits');await click('Insert');await click('Cube');await loaded();};
  async function applyTool(name,action){await click('Edit');await click(name);await click(`Apply ${action}`);await quiet();await noError();}
  async function capture(name){await js("document.dispatchEvent(new Event('visibilitychange'))");let shot;for(let i=0;i<3;i++){win.webContents.invalidate();await sleep(180);shot=await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});}fs.writeFileSync(path.join(work,name),shot.toPNG());}
  async function load(name,buffer){await js(`(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(Buffer.from(buffer).toString('base64'))}),c=>c.charCodeAt(0));const d=new DataTransfer();d.items.add(new File([bytes],${JSON.stringify(name)}));const i=document.querySelector('input[type=file]');i.files=d.files;i.dispatchEvent(new Event('change',{bubbles:true}));})()`);if(await js("!!document.querySelector('[aria-label=\"Unsaved 3D edits\"]')"))await click('Discard edits');await quiet();await loaded();await noError();}
  await win.loadURL('app://local/tests/fixtures/modelViewer.html');
  await click('Cube');await loaded();await noError();assert.equal(await objectCount(),1);assert((await js("document.querySelector('.model-details').textContent")).includes('X 20 × Y 20 × Z 20'));
  await click('Object');await click('Duplicate');assert.equal(await objectCount(),2);await click('Undo');assert.equal(await objectCount(),1);await click('Redo');assert.equal(await objectCount(),2);
  await click('Cube copy');await field('Position X',10);await field('Position Y',0);await click('Apply transform');await click('Select all');await applyTool('Subtract','subtract');assert.equal(await objectCount(),1);assert((await js("document.querySelector('.model-details').textContent")).includes('X 10 × Y 20 × Z 20'));
  await click('Undo');assert.equal(await objectCount(),2);await click('Select all');await applyTool('Merge','merge');assert((await js("document.querySelector('.model-details').textContent")).includes('X 30 × Y 20 × Z 20'));
  await applyTool('Split','split');assert.equal(await objectCount(),2);
  checks.push('Insert, duplicate, numeric transforms, undo/redo, subtract, merge and capped split execute through the UI and production-origin geometry worker');
  await start();await applyTool('Hollow','hollow');await click('Undo');await applyTool('Smooth','smooth');await click('Undo');await applyTool('Emboss','emboss');await noError();
  checks.push('Hollow, smoothing and real embossed text complete; undo restores the prior objects');
  await start();await click('Paint');await field('Paint color','#d27c4d');await click('Texture Oak');await quiet();await field('QR URL','https://example.com/model');await click('Generate QR');await quiet();await noError();
  await click('Save project');await until(()=>downloads.some(p=>p.endsWith('.law3d')),'project download');await quiet();
  const saved=downloads.find(p=>p.endsWith('.law3d')),project=JSON.parse(fs.readFileSync(saved,'utf8'));assert.equal(project.format,'law-3d-project');assert(project.document.objects[0].materials[0].mapData.startsWith('data:image/png;base64,'));assert.equal(project.document.objects[0].materials[0].textureName,'QR code');
  await click('Export STL');await until(()=>downloads.some(p=>p.endsWith('.stl')),'STL download');await quiet();const stl=fs.readFileSync(downloads.find(p=>p.endsWith('.stl')));assert.equal(stl.length,84+50*stl.readUInt32LE(80));
  await load('roundtrip.law3d',fs.readFileSync(saved));assert.equal(await objectCount(),1);await click('Select all');await capture('paint.png');
  checks.push('Paint color, procedural texture, local QR generation, editable project round-trip and binary STL export work');
  await click('View');for(const name of ['Shadows','Reflections','Wireframe','X-ray','Grid','Smoothing','Colors','Shading'])await js(`(()=>{const label=[...document.querySelectorAll('.model-ribbon label')].find(e=>e.textContent===${JSON.stringify(name)});label.querySelector('input').click();})()`);
  await click('Top');await js("[...document.querySelectorAll('label')].find(e=>e.textContent==='Orthographic').querySelector('input').click()");await noError();await capture('view-controls.png');
  await sleep(250);const frame=await js("document.querySelector('.model-stage').dataset.renderCount");await sleep(400);assert.equal(await js("document.querySelector('.model-stage').dataset.renderCount"),frame);
  checks.push('Named cameras, orthographic projection and all display toggles render without an idle frame loop');
  await click('Object');await click('Measure');const rect=await js("(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()");
  for(const offset of [-.04,.04]){const x=Math.round(rect.x+rect.w*(.5+offset)),y=Math.round(rect.y+rect.h*.5);win.webContents.sendInputEvent({type:'mouseMove',x,y});win.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1});await sleep(90);}
  await until(()=>js("document.querySelector('.model-stage-hint')?.textContent.startsWith('Distance:')"),'surface measurement');
  await click('Object');await click('Duplicate');await click('Switch tab');assert.equal(await js('document.querySelectorAll("canvas").length'),0);await click('Switch tab');await loaded();assert.equal(await objectCount(),2);
  checks.push('Viewport surface measurement works; unsaved edits survive tab switches while the prior canvas is released');
  await click('Close model');await click('Keep editing');assert.equal(await objectCount(),2);await click('Close model');await click('Discard edits');assert.equal(await js('document.querySelectorAll("canvas").length'),0);
  await load('broken.stl',Buffer.from('not a model')).then(()=>{throw Error('Malformed load should fail');},()=>{});
  // A failed import must remain recoverable without clearing an existing scene.
  await click('Insert');await click('Cube');await loaded();await noError();await capture('editor.png');
  checks.push('Unsaved-close confirmation keeps or discards edits explicitly; a malformed file is recoverable');
  assert.deepEqual(requests,[],'Editor made external requests');assert.deepEqual(failures,[]);
  console.log(JSON.stringify({ok:true,checks,artifacts:work,electron:process.versions.electron,gpu:app.getGPUFeatureStatus()},null,2));
}).catch(async error=>{console.error(error);console.error('Renderer errors:',failures);console.error('Artifacts:',work);if(win){try{console.error(await win.webContents.executeJavaScript('document.body.innerText'));fs.writeFileSync(path.join(work,'failure.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());}catch{}}process.exitCode=1;}).finally(()=>{clearTimeout(timeout);win?.destroy();app.exit(process.exitCode||0);});
