// End-to-end desktop file upload with the real local model and a private API.
// Usage: electron scripts/qa-audio-upload.cjs "C:\path\recording.m4a"
const {app,BrowserWindow,protocol,net}=require('electron');
const {spawn}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const {createHash,randomBytes}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'), source=path.resolve(process.argv[2]);
const separate=process.argv[3] !== undefined, speakerCount=Number(process.argv[3]) || 0;
const work=fs.mkdtempSync(path.join(os.tmpdir(),'law-audio-upload-'));
const digest=()=>createHash('sha256').update(fs.readFileSync(source)).digest('hex');
const before=digest(), token=randomBytes(32).toString('hex');
app.setPath('userData',path.join(work,'profile'));
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
let win,backend;
const timeout=setTimeout(()=>finish(Error('Upload QA exceeded twenty minutes')),1200000);
function finish(error){clearTimeout(timeout);backend?.kill();win?.destroy();if(error)console.error(error);app.exit(error?1:0);}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  backend=spawn(path.join(root,'venv/Scripts/python.exe'),['-u','tests/fixtures/audio_backend.py'],{
    cwd:root,windowsHide:true,env:{...process.env,LAW_SESSION_TOKEN:token},stdio:['ignore','pipe','pipe'],
  });
  const port=await new Promise((resolve,reject)=>{
    let value='';backend.once('error',reject);backend.once('exit',code=>reject(Error(`QA API exited: ${code}`)));
    backend.stdout.on('data',chunk=>{value+=chunk;const line=value.split('\n')[0];try{resolve(JSON.parse(line).port);}catch{}});
  });
  // Backend stderr is diagnostic only. Never log request URLs with tokens.
  backend.stderr.on('data',chunk=>process.stderr.write(chunk));
  for(let i=0;i<100;i++) {try {const r=await fetch(`http://127.0.0.1:${port}/audio/status`,{headers:{'X-LAW-Session':token}});if(r.ok)break;}catch{}await sleep(100);}
  protocol.handle('app',request=>net.fetch(pathToFileURL(path.join(root,'tmp/audio-qa',new URL(request.url).pathname)).toString()));
  win=new BrowserWindow({show:false,width:1300,height:1100,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  const js=code=>win.webContents.executeJavaScript(code,true);
  const until=async(fn,label)=>{for(let i=0;i<100;i++){if(await fn())return;await sleep(100);}throw Error('Timed out: '+label);};
  await win.loadURL(`app://local/tests/fixtures/audio.html?apiPort=${port}&apiToken=${token}`);
  await until(()=>js("document.body.textContent.includes('Ready for local transcription')"),'model ready');
  if(separate) {
    await js("document.querySelector('.audio-speaker-settings input[type=checkbox]').click()");
    await until(()=>js("!!document.querySelector('[aria-label=\"Number of speakers\"]')"),'speaker count control');
    await js(`(()=>{const e=document.querySelector('[aria-label="Number of speakers"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(String(speakerCount))});e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  }
  // Instrument responses in this fixture without changing requests or results.
  await js(`window.qaUploads=0;const originalFetch=window.fetch;window.fetch=async(...args)=>{const response=await originalFetch(...args);if(new URL(args[0]).pathname==='/audio/transcribe'){window.qaUploads++;window.qaResult=await response.clone().json();window.qaStatus=response.status;}return response;};undefined`);
  win.webContents.debugger.attach('1.3');
  const {root:document}=await win.webContents.debugger.sendCommand('DOM.getDocument');
  const {nodeId}=await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:document.nodeId,selector:'.audio-transcription input[type=file]'});
  await win.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId,files:[source]});
  await until(()=>js(`document.body.textContent.includes(${JSON.stringify(path.basename(source))})`),'selected original file');
  const started=performance.now();
  await js(`(()=>{const button=[...document.querySelectorAll('button')].find(e=>e.textContent==='Transcribe audio');if(button.disabled)throw Error('Upload rejected by UI');button.click();})()`);
  let previous='',lastLog=0,result;
  for(let i=0;i<2400;i++) {
    result=await js("window.qaResult ? {status:window.qaStatus,result:window.qaResult,uploads:window.qaUploads,text:document.querySelector('[aria-label=\"Audio transcript\"]').value}:null");
    if(result && (result.status!==200 || result.text))break;
    const progress=await js("[...document.querySelectorAll('[role=status]')].map(e=>e.textContent).find(t=>t.startsWith('Transcribing locally') || t.startsWith('Separating speakers')) || ''");
    const stage=progress.split(' · ')[0];
    if(progress && (stage!==previous || performance.now()-lastLog>15000)){console.log(progress);previous=stage;lastLog=performance.now();}
    await sleep(500);
  }
  assert(result,'No result');assert.equal(result.status,200);assert.equal(result.uploads,1);
  if(separate) {assert.equal(result.result.diarized,true,result.result.speaker_error);assert.match(result.text,/\[\d\d:\d\d:\d\d/);for(const label of result.result.speakers)assert(result.text.includes(label));if(speakerCount)assert.equal(result.result.speakers.length,speakerCount);}
  else assert.equal(result.text,result.result.text);
  assert(result.result.duration>600,'Fixture must exceed the old duration limit');assert(result.result.chunks>1);assert(result.text.length>100);
  assert.equal(digest(),before,'Original file changed');
  const directory=path.join(root,'artifacts/audio-transcription');fs.mkdirSync(directory,{recursive:true});
  const output=path.join(directory,`${path.parse(source).name}.${separate?'speakers':'direct-upload'}-${Date.now()}.txt`);
  fs.writeFileSync(output,result.text,{encoding:'utf8',flag:'wx'});
  // Private diagnostic output only, alongside this fixture's temporary profile.
  fs.writeFileSync(path.join(work,'result.json'),JSON.stringify(result.result));
  await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  fs.writeFileSync(path.join(work,'complete.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  console.log(JSON.stringify({passed:true,uploads:result.uploads,elapsedSeconds:(performance.now()-started)/1000,processing:result.result.processing,duration:result.result.duration,chunks:result.result.chunks,words:result.result.text.split(/\s+/).length,speakers:result.result.speakers,turns:result.result.segments.length,sourceUnchanged:true,output,resultFile:path.join(work,'result.json'),screenshot:path.join(work,'complete.png')}));
  finish();
}).catch(finish);
