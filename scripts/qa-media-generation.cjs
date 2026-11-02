// Hidden Chromium with synthetic API responses; never touches real jobs or models.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
if(!process.versions.electron){
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=require('node:child_process').spawn(require('electron'),[__filename],{env,windowsHide:true,stdio:'inherit'});
  child.on('error',error=>{console.error(error);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code;});
}else{
  const {app,BrowserWindow,protocol}=require('electron'),{appAsset,APP_HEADERS}=require('../electron/security');
  const root=path.resolve(__dirname,'..'),work=fs.mkdtempSync(path.join(os.tmpdir(),'law-media-ui-'));
  app.setPath('userData',path.join(work,'profile'));app.disableHardwareAcceleration();
  protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
  let win;const timeout=setTimeout(()=>app.exit(1),90000);
  app.whenReady().then(async()=>{
    const {build}=await import('vite'),react=(await import('@vitejs/plugin-react')).default;
    await build({configFile:false,root,base:'./',plugins:[react()],logLevel:'error',build:{outDir:path.join(work,'dist'),rollupOptions:{input:path.join(root,'tests/fixtures/mediaGeneration.html')}}});
    protocol.handle('app',request=>{const file=appAsset(path.join(work,'dist'),request.url);return new Response(fs.readFileSync(file),{headers:{...APP_HEADERS,'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream')}});});
    win=new BrowserWindow({show:false,width:1200,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    const js=code=>win.webContents.executeJavaScript(code,true),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const until=async code=>{for(let i=0;i<100;i++){if(await js(code))return;await sleep(80);}throw Error('Timeout: '+code);};
    const field=(selector,value)=>js(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element),'value').set.call(element,${JSON.stringify(value)});element.dispatchEvent(new Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
    const button=text=>js(`[...document.querySelectorAll('button')].find(element=>element.textContent===${JSON.stringify(text)}).click()`);
    await win.loadURL('app://local/tests/fixtures/mediaGeneration.html');await until('document.querySelectorAll("option").length===3');
    assert(await js('document.querySelector("button[type=submit]").disabled'));
    await field('form select','qwen');await field('textarea','Make the cup blue; preserve its shape.');
    await js(`(()=>{const input=document.querySelector('input[type=file]'),transfer=new DataTransfer();transfer.items.add(new File(['synthetic'],'cup.png',{type:'image/png'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until('window.mediaQA.uploads===1 && document.body.innerText.includes("cup.png")');
    await button('Generate image');await until('window.mediaQA.requests.length===1');
    assert.deepEqual(await js('window.mediaQA.requests[0].references'),['blob:synthetic']);
    assert.equal(await js('window.mediaQA.requests[0].steps'),30);
    await until('document.body.innerText.includes("Stop")');await button('Stop');await until('window.mediaQA.jobs[0].status==="cancelled"');
    await button('Remove');await field('form select','wan');
    assert(await js('document.querySelector("button[type=submit]").disabled'));
    assert(await js('document.body.innerText.includes("Steps per expert")'));
    await js(`(()=>{const input=document.querySelector('input[type=file]'),transfer=new DataTransfer();transfer.items.add(new File(['synthetic'],'cup.png',{type:'image/png'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until('window.mediaQA.uploads===2 && !document.querySelector("button[type=submit]").disabled');
    await button('Generate video');await until('window.mediaQA.requests.length===2');
    assert.equal(await js('window.mediaQA.requests[1].frames'),17);
    await sleep(200);fs.writeFileSync(path.join(work,'desktop.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
    win.setSize(430,1000);await sleep(250);assert(await js('document.documentElement.scrollWidth<=innerWidth'));
    fs.writeFileSync(path.join(work,'narrow.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
    assert.deepEqual(await js('window.mediaQA.errors'),[]);
    console.log(JSON.stringify({ok:true,checks:['Qwen reference upload and submit','Cancel during loading','Wan required reference and video settings','430px layout and no browser errors'],artifacts:work}));
  }).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{clearTimeout(timeout);win?.destroy();app.exit(process.exitCode||0);});
}
