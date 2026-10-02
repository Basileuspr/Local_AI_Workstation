const {app,BrowserWindow,protocol}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'law-model-viewer-qa-'));app.setPath('userData',path.join(work,'profile'));
const {appAsset,APP_HEADERS}=require('../electron/security');
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
let win,vite;const checks=[],failures=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const timeout=setTimeout(()=>app.exit(1),90000);
app.whenReady().then(async()=>{
  const {BoxGeometry,Mesh}=await import('three'),{STLExporter}=await import('three/addons/exporters/STLExporter.js');
  const {zipSync,strToU8}=await import('three/addons/libs/fflate.module.js');
  const {asZip64}=await import('../tests/fixtures/zip64.mjs');
  protocol.handle('app',request=>{const file=appAsset(path.resolve(__dirname,'../tmp/viewer-hardening-qa'),request.url);
    return new Response(fs.readFileSync(file),{headers:{...APP_HEADERS,'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm'}[path.extname(file)]||'application/octet-stream')}});});
  win=new BrowserWindow({show:false,width:1200,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.on('console-message',event=>{if(event.level==='error'||event.level===3)failures.push(event.message);});
  const js=code=>win.webContents.executeJavaScript(code),until=async(fn,label)=>{for(let i=0;i<250;i++){if(await fn())return;await sleep(60);}throw Error(`Timed out: ${label}: ${await js('document.body.innerText')}`);};
  const click=label=>js(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Button unavailable');b.click();})()`);
  const load=(name,buffer,drop=false)=>js(`(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(Buffer.from(buffer).toString('base64'))}),c=>c.charCodeAt(0));const f=new File([bytes],${JSON.stringify(name)});const d=new DataTransfer();d.items.add(f);${drop?`document.querySelector('.model-viewer').dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true}));`:`const i=document.querySelector('input[type=file]');i.files=d.files;i.dispatchEvent(new Event('change',{bubbles:true}));`}})()`);
  async function capture(name){
    const count=Number(await js("document.querySelector('.model-stage').dataset.renderCount"))||0;
    await js("document.dispatchEvent(new Event('visibilitychange'))");
    await until(async()=>Number(await js("document.querySelector('.model-stage').dataset.renderCount"))>count,'capture redraw');
    // Hidden Electron windows can expose the previous compositor surface first.
    let image;for(let i=0;i<3;i++){win.webContents.invalidate();await sleep(250);image=await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});}
    fs.writeFileSync(path.join(work,name),image.toPNG());
  }
  await win.loadURL('app://local/tests/fixtures/modelViewer.html');
  if(process.env.LAW_QA_MODEL) {
    const file=path.resolve(process.env.LAW_QA_MODEL),bytes=fs.readFileSync(file),{createHash}=require('node:crypto');
    const hash=data=>createHash('sha256').update(data).digest('hex'),beforeHash=hash(bytes);
    await load(path.basename(file),bytes,true);
    await until(()=>js("!!document.querySelector('[role=alert]') || (document.querySelectorAll('canvas').length===1 && !document.querySelector('[role=status]'))"),'selected model');
    const error=await js("document.querySelector('[role=alert]')?.textContent || ''");assert.equal(error,'');
    await capture('selected-model.png');
    const info=await js("document.querySelector('.model-details').innerText");
    assert.equal(hash(fs.readFileSync(file)),beforeHash,'Original model changed');
    assert.equal(failures.length,0,failures.join('\n'));
    console.log(JSON.stringify({ok:true,info,sha256:beforeHash,originalUnchanged:true,artifacts:work},null,2));return;
  }
  const mesh=new Mesh(new BoxGeometry(30,20,10));mesh.updateMatrixWorld();const stl=new STLExporter().parse(mesh,{binary:true}).buffer;
  await load('box.stl',stl);
  await until(()=>js("Number(document.querySelector('.model-stage')?.dataset.renderCount)>0"),'STL render');
  assert((await js("document.querySelector('.model-details').textContent")).includes('X 30 × Y 20 × Z 10'));
  await sleep(300);const before=await js("document.querySelector('.model-stage').dataset.renderCount");await sleep(500);
  assert.equal(await js("document.querySelector('.model-stage').dataset.renderCount"),before);checks.push('Binary STL renders with correct dimensions; idle scene does not render continuously');
  await click('Top');await until(async()=>Number(await js("document.querySelector('.model-stage').dataset.renderCount"))>Number(before),'camera redraw');
  await js("[...document.querySelectorAll('label')].find(e=>e.textContent.includes('Orthographic')).querySelector('input').click()");
  await click('Isometric');await sleep(250);
  await capture('stl.png');
  const model='<model unit="centimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><basematerials id="2"><base name="Red" displaycolor="#E34D59"/></basematerials><object id="1" pid="2" pindex="0"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="2" y="0" z="0"/><vertex x="0" y="2" z="0"/><vertex x="0" y="0" z="3"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/></triangles></mesh></object><object id="3"><components><component objectid="1"/><component objectid="1" transform="1 0 0 0 1 0 0 0 1 4 0 0"/></components></object></resources><build><item objectid="3"/></build></model>';
  const mf=zipSync({'_rels/.rels':strToU8('<Relationships><Relationship Target="/3D/model.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),'3D/model.model':strToU8(model)});
  await click('Close model');await load('assembly.3mf',mf,true);await until(()=>js("document.querySelector('.model-details')?.textContent.includes('assembly.3mf') && document.querySelectorAll('canvas').length===1 && !document.querySelector('[role=status]')"),'3MF render');
  assert((await js("document.querySelector('.model-details').textContent")).includes('X 6 × Y 2 × Z 3'));assert((await js('document.body.innerText')).includes('2 meshes'));
  await capture('3mf.png');
  checks.push('Dropped 3MF preserves declared units, colored components and transforms');
  await click('Close model');await load('assembly-zip64.3mf',asZip64(mf.buffer),true);
  await until(()=>js("document.querySelector('.model-details')?.textContent.includes('assembly-zip64.3mf') && document.querySelectorAll('canvas').length===1 && !document.querySelector('[role=status]')"),'ZIP64 3MF render');
  assert((await js("document.querySelector('.model-details').textContent")).includes('X 6 × Y 2 × Z 3'));assert((await js('document.body.innerText')).includes('2 meshes'));
  checks.push('Forced ZIP64 3MF loads and renders the same assembly and dimensions');
  const repeatMesh=new Mesh(new BoxGeometry(30,20,10,40,40,40));repeatMesh.updateMatrixWorld();
  const repeatedSTL=new STLExporter().parse(repeatMesh,{binary:true}).buffer,heap=[];
  for(let i=0;i<7;i++){
    await click('Close model');assert.equal(await js('document.querySelectorAll("canvas").length'),0);
    await load('repeat.stl',repeatedSTL);await until(()=>js("document.querySelectorAll('canvas').length===1 && !document.querySelector('[role=status]')"),'repeated open');
    await click('Close model');await sleep(80);
    win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');
    heap.push((await win.webContents.debugger.sendCommand('Runtime.getHeapUsage')).usedSize);win.webContents.debugger.detach();
    if(i<6){await load('box.stl',stl);await until(()=>js("document.querySelectorAll('canvas').length===1 && !document.querySelector('[role=status]')"),'small model reopen');}
  }
  assert(heap.at(-1)<heap[1]+4*1024*1024,`Unexpected retained heap growth: ${heap.join(', ')}`);
  await click('Switch tab');assert.equal(await js('document.querySelectorAll("canvas").length'),0);await click('Switch tab');assert((await js('document.body.innerText')).includes('No model open'));
  checks.push('Repeated 19,200-triangle open/close cycles keep collected JS heap bounded; tab changes release canvases and do not restore a model');
  await js(`(()=>{const b=new ArrayBuffer(84+50*1000001);new DataView(b).setUint32(80,1000001,true);const d=new DataTransfer();d.items.add(new File([b],'large.stl'));const i=document.querySelector('input[type=file]');i.files=d.files;i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(()=>js("document.querySelector('[role=alertdialog]')?.textContent.includes('1,000,001')"),'large geometry warning');await click('Cancel');assert.equal(await js('document.querySelectorAll("canvas").length'),0);
  await load('broken.stl',Buffer.from('not a model'));await until(()=>js("!!document.querySelector('[role=alert]')"),'malformed model error');
  await load('box.stl',stl);await until(()=>js("document.querySelectorAll('canvas').length===1 && !document.querySelector('[role=status]')"),'recovery');
  checks.push('Large-model warning can cancel before geometry construction; malformed input recovers on next open');
  assert.equal(failures.length,0,failures.join('\n'));
  console.log(JSON.stringify({ok:true,electron:process.versions.electron,checks,heapBytesAfterClose:heap,artifacts:work,gpu:app.getGPUFeatureStatus()},null,2));
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{clearTimeout(timeout);win?.destroy();vite?.httpServer.close();app.exit(process.exitCode||0);});
