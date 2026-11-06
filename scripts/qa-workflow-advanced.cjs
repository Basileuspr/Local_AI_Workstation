// Actual Chromium controls with synthetic APIs and a disposable profile; no GPU/data access.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
if(!process.versions.electron){
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=require('node:child_process').spawnSync(require('electron'),[__filename],{env,stdio:'inherit',windowsHide:true});process.exit(child.status??1);
}else{
  const {app,BrowserWindow,protocol}=require('electron');
  const {appAsset,APP_HEADERS}=require('../electron/security');
  const root=path.resolve(__dirname,'..'),work=fs.mkdtempSync(path.join(os.tmpdir(),'law-workflow-ui-'));
  app.setPath('userData',path.join(work,'profile'));app.disableHardwareAcceleration();
  protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
  let win;const timeout=setTimeout(()=>app.exit(1),90000);
  app.whenReady().then(async()=>{
    const {build}=await import('vite'),react=(await import('@vitejs/plugin-react')).default;
    await build({configFile:false,root,base:'./',plugins:[react()],logLevel:'error',build:{outDir:path.join(work,'dist'),rollupOptions:{input:path.join(root,'tests/fixtures/workflowAdvanced.html')}}});
    protocol.handle('app',request=>{const file=appAsset(path.join(work,'dist'),request.url);return new Response(fs.readFileSync(file),{headers:{...APP_HEADERS,'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream')}});});
    win=new BrowserWindow({show:false,width:1350,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    const js=code=>win.webContents.executeJavaScript(code,true),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const until=async code=>{for(let i=0;i<100;i++){if(await js(code))return;await sleep(80);}throw Error('Timeout: '+code);};
    const button=text=>js(`[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(text)}).click()`);
    const field=async(label,value)=>{await js(`(()=>{const e=[...document.querySelectorAll('label')].find(e=>e.querySelector('span')?.textContent===${JSON.stringify(label)}).querySelector('input,select');Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);await sleep(60);};
    await win.loadURL('app://local/tests/fixtures/workflowAdvanced.html');await until('document.body.innerText.includes("+ New image workflow")');
    await button('+ New image workflow');await until('document.querySelector(".workflow-editor")');
    for(const operation of ['controlnet','multi_reference','outpaint','upscale']){
      await js(`(()=>{const e=document.querySelector('[aria-label="Stage type to add"]');e.value=${JSON.stringify(operation)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await sleep(60);await button('+ Add stage');
    }
    await until('document.querySelectorAll(".workflow-stage").length===4');
    await field('Canny low threshold','70');await field('Canny high threshold','170');await field('Control influence','0.75');
    await field('Reference influence','0.8');
    await js(`document.querySelectorAll('.workflow-references input').forEach(e=>e.click())`);
    await field('New left border (pixels)','96');await field('New bottom border (pixels)','32');
    await field('Stage 4 provider','local-realesrgan');await field('Size multiplier','3');
    await button('Validate inputs');await until('window.workflowQA.saves.length===1 && document.body.innerText.includes("Ready to run")');
    const stages=await js('window.workflowQA.saves[0].stages');
    assert.equal(stages[0].control_input,'source');assert.equal(stages[0].canny_low,70);assert.equal(stages[0].canny_high,170);assert.equal(stages[0].control_scale,.75);
    assert.equal(stages[1].reference_scale,.8);assert.equal(stages[1].reference_asset_ids.length,2);
    assert.equal(stages[2].outpaint_left,96);assert.equal(stages[2].outpaint_bottom,32);
    assert.equal(stages[3].provider_slot,'local-realesrgan');assert.equal(stages[3].upscale_factor,3);
    await until('document.querySelectorAll(".workflow-stage").length===4 && !document.querySelector(".workflow-editor").disabled');
    await js('document.querySelector(".workflow-stage").scrollIntoView()');win.setSize(1352,1000);await sleep(1000);
    fs.writeFileSync(path.join(work,'desktop.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
    win.setSize(430,1000);await sleep(200);assert(await js('document.documentElement.scrollWidth<=innerWidth'));
    await js('document.querySelectorAll(".workflow-stage")[2].scrollIntoView()');win.setSize(430,1002);await sleep(1000);
    fs.writeFileSync(path.join(work,'narrow.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
    assert.deepEqual(await js('window.workflowQA.errors'),[]);
    console.log(JSON.stringify({ok:true,checks:['Canny controls submitted','Two reference inputs and influence submitted','Outpaint borders submitted','Trained upscale selection submitted','430px layout'],artifacts:work}));
  }).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{clearTimeout(timeout);win?.destroy();app.exit(process.exitCode||0);});
}
