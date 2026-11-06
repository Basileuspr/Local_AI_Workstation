// Actual Image Editor / Magic Edit controls. Synthetic by default; --real opts into GPU work.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const root=fs.realpathSync(path.resolve(__dirname,'..'));
if(!process.versions.electron){
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const args=process.argv.slice(2);
  if(!args.includes('--output'))args.push('--output',fs.mkdtempSync(path.join(os.tmpdir(),'law-magic-edit-')));
  const receipt=path.join(args[args.indexOf('--output')+1],'checks.json');
  const child=spawnSync(require('electron'),[__filename,...args],{env,stdio:'inherit',windowsHide:true});
  const passed=fs.existsSync(receipt)&&JSON.parse(fs.readFileSync(receipt,'utf8')).ok===true;
  process.exit(child.status===0&&passed?0:1);
}else{
  const {app,BrowserWindow,ipcMain,protocol,net}=require('electron'),{pathToFileURL}=require('node:url');
  const {appAsset,APP_HEADERS,trustedUrl}=require('../electron/security');
  const args=process.argv.slice(2),real=args.includes('--real');
  const value=flag=>args.includes(flag)?args[args.indexOf(flag)+1]:null;
  const requestedOutput=path.resolve(value('--output')||fs.mkdtempSync(path.join(os.tmpdir(),'law-magic-edit-')));
  fs.mkdirSync(requestedOutput,{recursive:true});
  const output=fs.realpathSync(requestedOutput),relative=path.relative(root.toLowerCase(),output.toLowerCase());
  if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw Error('Keep output outside the repository.');
  fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({ok:false,status:'running',real}));
  const photoArgs=args.includes('--photos')?args.slice(args.indexOf('--photos')+1,args.indexOf('--photos')+3):[];
  if(real&&photoArgs.length!==2)throw Error('--real requires --photos FIRST.png SECOND.png');
  app.setPath('userData',fs.mkdtempSync(path.join(output,'profile-')));app.disableHardwareAcceleration();
  protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
  let win,backend,failure=0;const checks=[],records=[];
  const timer=setTimeout(()=>{if(backend?.exitCode===null)backend.kill();win?.destroy();app.exit(1)},real?30*60*1000:180000);
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  app.whenReady().then(async()=>{
    backend=spawn(path.join(root,'venv/Scripts/python.exe'),['-B',path.join(__dirname,'qa-magic-edit-fixture.py'),output,...(real?['--real']:[])],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
    const log=fs.createWriteStream(path.join(output,'backend.log'));backend.stderr.pipe(log);
    const connection=await new Promise((resolve,reject)=>{let text='';const timeout=setTimeout(()=>reject(Error('Fixture startup timed out')),30000);backend.stdout.on('data',data=>{text+=data;if(text.includes('\n')){clearTimeout(timeout);resolve(JSON.parse(text.split('\n')[0]));}});backend.once('error',reject);});
    const api=async(url,options={})=>{const response=await fetch(connection.base+url,{signal:AbortSignal.timeout(120000),...options,headers:{'X-LAW-Session':connection.token,...options.headers}});if(!response.ok)throw Error(`API ${url.split('?')[0]} failed ${response.status}: ${await response.text()}`);return response;};
    const until=async(predicate,label,timeout=20000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await sleep(150)}throw Error('Timed out: '+label);};
    await until(async()=>{try{return(await api('/image-workflows')).ok}catch{return false}},'fixture ready');
    console.log(JSON.stringify({phase:'Discovering installed providers',real}));
    const catalog=await(await api('/image-workflows/capabilities')).json();
    console.log(JSON.stringify({phase:'Providers ready; building editor fixture',real}));
    for(const id of ['local-sdxl','local-sdxl-controlnet','local-sdxl-ip-adapter','local-sdxl-outpaint','local-realesrgan'])assert(catalog.providers.find(p=>p.id===id)?.available,`${id} unavailable`);
    const {build}=await import('vite'),react=(await import('@vitejs/plugin-react')).default;
    await build({configFile:false,root,base:'./',plugins:[react()],logLevel:'error',worker:{format:'es'},build:{outDir:path.join(output,'dist'),rollupOptions:{input:path.join(root,'tests/fixtures/imageEditor.html')}}});
    protocol.handle('app',async request=>{const response=await net.fetch(pathToFileURL(appAsset(path.join(output,'dist'),request.url)).toString());return new Response(response.body,{headers:{...Object.fromEntries(response.headers),...APP_HEADERS}})});
    win=new BrowserWindow({show:false,width:1450,height:1050,webPreferences:{preload:path.join(root,'electron/preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    win.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message.replace(/law_token=[^\s&]+/g,'law_token=REDACTED'))});
    ipcMain.on('app:connection',event=>{event.returnValue=event.sender===win.webContents&&trustedUrl(event.senderFrame.url)?connection:null});
    const js=code=>win.webContents.executeJavaScript(code,true);
    await win.loadURL('app://local/tests/fixtures/imageEditor.html');
    await until(()=>js('!!window.editorCropQA'),'editor fixture');
    await js(`(()=>{window.magicEvidence={workflows:[],executions:[],errors:[]};const original=window.fetch;window.fetch=async(...args)=>{const response=await original(...args);const url=new URL(args[0],location.href);if(response.ok&&args[1]?.method==='PUT'&&url.pathname.startsWith('/image-workflows/'))window.magicEvidence.workflows.push(await response.clone().json());if(response.ok&&url.pathname.endsWith('/execute'))window.magicEvidence.executions.push(await response.clone().json());return response;};window.addEventListener('error',e=>window.magicEvidence.errors.push(e.message));})()`);
    const button=async text=>{await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Missing or disabled button: '+${JSON.stringify(text)});b.click();})()`);await sleep(80)};
    const field=async(label,value)=>{await js(`(()=>{const e=document.querySelector('[aria-label='+CSS.escape(${JSON.stringify(label)})+']');if(!e)throw Error('Missing field '+${JSON.stringify(label)});Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);await sleep(70)};
    const files=real?photoArgs:[1,2].map(i=>path.join(output,`synthetic-${i}.png`));
    const encoded=files.map(file=>fs.readFileSync(file).toString('base64'));
    const importFile=async(label,index)=>{await js(`(()=>{const file=new File([Uint8Array.from(atob(${JSON.stringify(encoded[index])}),c=>c.charCodeAt(0))],${JSON.stringify(`photo-${index+1}.png`)},{type:'image/png'});const input=document.querySelector('[aria-label='+CSS.escape(${JSON.stringify(label)})+']');const data=new DataTransfer();data.items.add(file);input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);await sleep(100)};
    const open=async index=>{
      await js(`window.editorCropQA.openInline(new File([Uint8Array.from(atob(${JSON.stringify(encoded[index])}),c=>c.charCodeAt(0))],'photo.png',{type:'image/png'}))`);
      await until(()=>js("document.querySelector('.ie-stage img')?.naturalWidth>0 && !document.querySelector('.ie-import input')?.disabled"),'source ready');
      await js("document.querySelector('.ie-magic').open=true");
      await until(()=>js("!!document.querySelector('[aria-label=\"Magic Edit image model\"]')?.value"),'Magic Edit models');
      await field('Magic edit request','Refine this photograph subtly. Preserve the same face, expression, pose, clothing, colors and composition. Natural realistic texture.');
      assert.equal(await js("document.querySelector('[aria-label=\"Magic Edit strength\"]').value"),'0.2');
      assert.equal(await js("document.querySelector('[aria-label=\"Magic Edit result amount\"]').value"),'0.5');
    };
    const refs=async()=>{await js("document.querySelector('.ie-magic fieldset details').open=true");for(let i=0;i<2;i++){await importFile('Add Magic Edit reference',i);await until(()=>js(`document.querySelectorAll('.ie-magic-reference').length===${i+1}`),'reference upload')}};
    const paint=async()=>{
      await field('Magic Edit change area','paint');await until(()=>js("document.querySelector('.ie-mask-stage img')?.naturalWidth>0"),'mask image');
      await js("document.querySelector('.ie-mask-stage').scrollIntoView({block:'start'})");await sleep(100);
      const point=await js("(()=>{const c=document.querySelector('.ie-mask-stage canvas'),r=c.getBoundingClientRect(),p={x:Math.round(r.left+r.width*.8),y:Math.round(r.top+r.height*.2)};if(document.elementFromPoint(p.x,p.y)!==c)throw Error('Mask point is not visible');return p})()");
      win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});await sleep(100);
      assert(await js("(()=>{const c=document.querySelector('.ie-mask-stage canvas');return c.getContext('2d').getImageData(Math.round(c.width*.8),Math.round(c.height*.2),1,1).data[3]>0})()"));
    };
    // Native pixel checks use browser canvas, independent of a model's quality.
    const geometry=require('esbuild').buildSync({entryPoints:[path.join(__dirname,'qa-image-magic-browser.js')],bundle:true,format:'iife',globalName:'magicGeometryQA',write:false,define:{'import.meta.env':'{}'}});
    await js(geometry.outputFiles[0].text);checks.push(await js('magicGeometryQA.checkMagicGeometry()'));
    await open(0);
    await field('Magic Edit strength','.45');await field('Magic Edit result amount','.9');await button('Use gentle defaults');
    assert.equal(await js("document.querySelector('[aria-label=\"Magic Edit strength\"]').value"),'0.2');
    assert.equal(await js("document.querySelector('[aria-label=\"Magic Edit result amount\"]').value"),'0.5');
    await paint();await button('Undo mask stroke');
    assert(await js("(()=>{const c=document.querySelector('.ie-mask-stage canvas');return !c.getContext('2d').getImageData(0,0,c.width,c.height).data.some(Boolean)})()"));
    await paint();await button('Clear edit area');
    assert(await js("(()=>{const c=document.querySelector('.ie-mask-stage canvas');return !c.getContext('2d').getImageData(0,0,c.width,c.height).data.some(Boolean)})()"));
    await field('Magic Edit change area','all');checks.push('Gentle defaults, painted mask, undo and clear');
    await refs();
    if(!real){
      await js("document.querySelector('.ie-magic-reference input[type=checkbox]').click()");
      await until(()=>js("![...document.querySelectorAll('.ie-magic button')].find(b=>b.textContent==='Remove selected').disabled"),'selected reference');
      await js("[...document.querySelectorAll('.ie-magic button')].find(b=>b.textContent==='Remove selected').click()");
      await until(()=>js("document.querySelectorAll('.ie-magic-reference').length===1"),'selected reference removed');
      await js("document.querySelector('.ie-magic-reference button').click()");
      await until(()=>js("document.querySelectorAll('.ie-magic-reference').length===0"),'last reference removed');await refs();
      await button('Refresh installed models');assert.equal(await js("document.querySelector('[aria-label=\"Magic Edit image model\"]').value"),'qa-model');
      for(const [mode,label,changed,expected] of [['structure','Magic Edit control influence','.9','0.5'],['references','Magic Edit reference influence','.9','0.35'],['outpaint','Magic Edit left border','128','32'],['upscale','Magic Edit upscale factor','4','2']]){
        await field('Magic Edit mode',mode);await field(label,changed);await button('Use gentle defaults');
        assert.equal(await js(`document.querySelector('[aria-label='+CSS.escape(${JSON.stringify(label)})+']').value`),expected);
      }
      await field('Magic Edit mode','refine');checks.push('Reference removal, model refresh and gentle defaults in every mode');
    }
    await button('Read references into guidance');
    await until(()=>js("(()=>{const error=document.querySelector('.ie-magic [role=alert]')?.textContent;if(error)throw Error(error);return !document.querySelector('.ie-magic fieldset').disabled && !!document.querySelector('[aria-label=\"Reference guidance to apply\"]').value})()"),'vision guidance',real?240000:20000);
    fs.writeFileSync(path.join(output,'reference-guidance.txt'),await js("document.querySelector('[aria-label=\"Reference guidance to apply\"]').value"));checks.push('Vision reference guidance returned for review');
    await field('Reference guidance to apply','');
    const before=await js('window.magicEvidence.executions.length');await button('Generate edited candidate');
    await until(()=>js(`window.magicEvidence.executions.length>${before}`),'cancellable run');await button('Stop Magic Edit');
    await until(()=>js("!document.querySelector('.ie-magic fieldset').disabled"),'cancelled',real?180000:20000);
    assert.equal(await js("!!document.querySelector('.ie-magic-candidate')"),false);checks.push('Stop leaves the source unchanged and no candidate');
    for(let index=0;index<(real?2:1);index++)for(const name of ['refine','paint','structure','edge-map','references','outpaint','upscale']){
      const started=Date.now();await open(index);
      const mode=name==='paint'?'refine':name==='edge-map'?'structure':name;
      await field('Magic Edit mode',mode);
      if(name==='paint')await paint();
      if(mode==='references')await refs();
      if(name==='edge-map'){
        await field('Magic Edit edge input','map');
        // Real acceptance uses a real Canny map created by the installed preprocessing adapter.
        if(real){const result=spawnSync(path.join(root,'venv/Scripts/python.exe'),['-B','-c',"import sys;sys.path.insert(0,'backend');from PIL import Image;from services.image_workflows.advanced_adapters import canny_map;canny_map(Image.open(sys.argv[1])).save(sys.argv[2])",files[index],path.join(output,'edge-map.png')],{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr)}
        const saved=encoded[index];if(real)encoded[index]=fs.readFileSync(path.join(output,'edge-map.png')).toString('base64');await importFile('Magic Edit edge map',index);encoded[index]=saved;
      }
      if(mode==='outpaint')await button('Use detail refinement prompt');
      if(mode==='upscale')await field('Magic edit request',''); // A prompt is unnecessary for trained super-resolution.
      console.log(JSON.stringify({case:`${name}-${index+1}`,status:'starting',real}));
      await button('Generate edited candidate');
      await until(async()=>{const error=await js("document.querySelector('.ie-magic [role=alert]')?.textContent||''");if(error)throw Error(error);return js("!!document.querySelector('.ie-magic-candidate img')?.naturalWidth")},`${name} candidate`,real?360000:20000);
      const candidate=await js("(async()=>{const img=document.querySelector('.ie-magic-candidate img');const c=new OffscreenCanvas(img.naturalWidth,img.naturalHeight);c.getContext('2d').drawImage(img,0,0);return Array.from(new Uint8Array(await (await c.convertToBlob({type:'image/png'})).arrayBuffer()))})()");
      fs.writeFileSync(path.join(output,`${name}-${index+1}.png`),Buffer.from(candidate));
      const workflow=await js('window.magicEvidence.workflows.at(-1)'),execution=await js('window.magicEvidence.executions.at(-1)');
      const run=await(await api(`/image-workflows/${workflow.id}/jobs/${execution.id}/run`)).json();
      assert.equal(run.status,'completed');
      const raw=await api(`/image-workflows/${workflow.id}/jobs/${execution.id}/outputs/${run.outputs[0].id}`);
      fs.writeFileSync(path.join(output,`${name}-${index+1}-raw.png`),Buffer.from(await raw.arrayBuffer()));
      await button('Compare source');assert.equal(await js("document.querySelector('.ie-magic-candidate img').alt"),'Source before Magic Edit');await button('Show candidate');
      if(name==='refine'){
        await js("document.querySelector('.ie-magic-candidate').scrollIntoView({block:'center'})");win.setSize(1452,1050);await sleep(300);
        fs.writeFileSync(path.join(output,'desktop.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
      }
      await button('Use this edited image');await until(()=>js("document.querySelector('.ie-file')?.textContent.includes('magic-edited.png') && !document.querySelector('.ie-magic-candidate')"),'accepted');
      await button('Send edited image to chat');await until(()=>js('!!window.editorCropSaved'),'editor export');
      const exported=await js('window.editorCropSaved');
      fs.writeFileSync(path.join(output,`${name}-${index+1}-accepted.png`),Buffer.from(exported.bytes));await js('window.editorCropSaved=null');
      records.push({case:`${name}-${index+1}`,real,status:'passed',elapsed_seconds:(Date.now()-started)/1000,workflow,run});
      fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(records,null,2));console.log(JSON.stringify({case:`${name}-${index+1}`,status:'passed'}));
    }
    await open(0);await button('Generate edited candidate');await until(()=>js("!!document.querySelector('.ie-magic-candidate')"),'discard example',real?360000:20000);await button('Discard candidate');assert.equal(await js("!!document.querySelector('.ie-magic-candidate')"),false);checks.push('Candidate compare, acceptance, export and discard');
    win.setSize(700,1050);await js("document.querySelector('.ie-magic').scrollIntoView()");win.setSize(701,1050);await sleep(300);
    assert(await js("document.querySelector('.image-editor').scrollWidth<=document.querySelector('.image-editor').clientWidth+1"));
    fs.writeFileSync(path.join(output,'narrow.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());checks.push('Narrow editor layout');
    assert.deepEqual(await js('window.magicEvidence.errors'),[]);
    fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({ok:true,checks,real,cases:records.length},null,2));console.log(JSON.stringify({ok:true,real,cases:records.length,checks,output}));
  }).catch(error=>{console.error(error.message.replace(/law_token=[^\s&]+/g,'law_token=REDACTED'));failure=1;}).finally(async()=>{clearTimeout(timer);win?.destroy();if(backend){backend.stdin.end('\n');await Promise.race([new Promise(r=>backend.once('exit',r)),sleep(10000)]);if(backend.exitCode===null)backend.kill()}app.exit(failure)});
}
