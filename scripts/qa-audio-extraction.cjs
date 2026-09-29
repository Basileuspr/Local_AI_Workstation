// Real desktop upload, extraction, playback, download and transcription handoff.
// Use a short synthetic video; pass the audio-track number and --transcribe
// to optionally run the installed speech model on that extracted track.
const {app,BrowserWindow,protocol,net}=require('electron');
const {spawn}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const {randomBytes,createHash}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),source=path.resolve(process.argv[2]),track=Number(process.argv[3])||1;
const work=fs.mkdtempSync(path.join(os.tmpdir(),'law-extraction-qa-'));
const output=path.join(root,'artifacts/audio-extraction-smoke',String(Date.now()));fs.mkdirSync(output,{recursive:true});
const hash=value=>createHash('sha256').update(value).digest('hex');
const before=hash(fs.readFileSync(source)),token=randomBytes(32).toString('hex');
app.setPath('userData',path.join(work,'profile'));
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
let win,backend;
const timeout=setTimeout(()=>finish(Error('Extraction QA exceeded ten minutes')),600000);
function finish(error){clearTimeout(timeout);backend?.kill();win?.destroy();if(error)console.error(error);app.exit(error?1:0);}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  backend=spawn(path.join(root,'venv/Scripts/python.exe'),['-u','tests/fixtures/audio_backend.py'],{
    cwd:root,windowsHide:true,env:{...process.env,LAW_SESSION_TOKEN:token,LAW_DATA_DIR:path.join(work,'data'),LAW_LOG_DIR:path.join(work,'logs')},stdio:['ignore','pipe','pipe'],
  });
  const port=await new Promise((resolve,reject)=>{
    let buffer='';backend.once('error',reject);backend.once('exit',code=>reject(Error(`Extraction API exited ${code}`)));
    backend.stdout.on('data',chunk=>{buffer+=chunk;try{resolve(JSON.parse(buffer.split('\n')[0]).port);}catch{}});
  });
  backend.stderr.on('data',chunk=>process.stderr.write(chunk));
  for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/audio/extraction/status`,{headers:{'X-LAW-Session':token}})).ok)break;}catch{}await sleep(100);}
  protocol.handle('app',request=>net.fetch(pathToFileURL(path.join(root,'tmp/audio-qa',new URL(request.url).pathname)).toString()));
  win=new BrowserWindow({show:false,width:1350,height:1100,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  const js=code=>win.webContents.executeJavaScript(code,true);
  const until=async(fn,label,attempts=100)=>{for(let i=0;i<attempts;i++){if(await fn())return;await sleep(200);}throw Error('Timed out: '+label);};
  const click=label=>js(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(label)} && e.getClientRects().length);if(!b||b.disabled)throw Error('Missing enabled button: '+${JSON.stringify(label)});b.click();})()`);
  const set=(label,value,tag='HTMLInputElement')=>js(`(()=>{const e=document.querySelector('[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(${tag}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(${JSON.stringify(tag==='HTMLSelectElement'?'change':'input')},{bubbles:true}));})()`);
  await win.loadURL(`app://local/tests/fixtures/audio.html?apiPort=${port}&apiToken=${token}`);
  await until(()=>js("[...document.querySelectorAll('[aria-label=\"Extracted audio format\"] option')].every(e=>!e.disabled) && !document.querySelector('.audio-extractor').textContent.includes('Checking audio')"),'extractor ready');
  win.webContents.debugger.attach('1.3');
  const {root:document}=await win.webContents.debugger.sendCommand('DOM.getDocument');
  const {nodeId}=await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:document.nodeId,selector:'[aria-label="Video or audio to extract"]'});
  await win.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId,files:[source]});
  await until(()=>js(`document.querySelector('.audio-extractor').textContent.includes(${JSON.stringify(path.basename(source))})`),'video selected');
  await set('Audio track to extract',String(track));
  const reports=[];
  for(const format of ['wav','m4a','flac','mp3']){
    await set('Extracted audio format',format,'HTMLSelectElement');await sleep(50);
    const started=performance.now();await click('Extract audio');
    await until(()=>js(`document.querySelector('[aria-label="Extracted audio result"] strong')?.textContent.endsWith('.${format}') && !document.querySelector('.audio-extractor .audio-demo-button').disabled`),format+' download');
    await until(()=>js("document.querySelector('[aria-label=\"Extracted audio preview\"]')?.readyState>=1"),format+' preview');
    const duration=await js("document.querySelector('[aria-label=\"Extracted audio preview\"]').duration");assert(duration>0);
    await js("(()=>{const a=document.querySelector('[aria-label=\"Extracted audio preview\"]');a.muted=true;return a.play();})()");
    await until(()=>js("document.querySelector('[aria-label=\"Extracted audio preview\"]').currentTime>0"),format+' playback');
    await click('Switch workspace');assert.equal(await js("document.querySelector('[aria-label=\"Extracted audio preview\"]').paused"),true);
    await click('Switch workspace');
    const bytes=await js("fetch(document.querySelector('[aria-label=\"Extracted audio preview\"]').src).then(r=>r.arrayBuffer()).then(b=>Array.from(new Uint8Array(b)))");
    const destination=path.join(output,'extracted.'+format);
    const saved=new Promise((resolve,reject)=>win.webContents.session.once('will-download',(_event,item)=>{item.setSavePath(destination);item.once('done',(_e,state)=>state==='completed'?resolve():reject(Error(state)));}));
    await click('Save extracted audio');await saved;
    assert.equal(hash(fs.readFileSync(destination)),hash(Buffer.from(bytes)));
    reports.push({format,duration,bytes:bytes.length,elapsedSeconds:(performance.now()-started)/1000,previewPlayed:true,downloadVerified:true});
  }
  await js("document.querySelector('.audio-extractor').scrollIntoView({block:'start',behavior:'instant'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  fs.writeFileSync(path.join(output,'extractor.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  win.setSize(780,1100);
  await js("document.querySelector('.audio-extractor').scrollIntoView({block:'start',behavior:'instant'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  assert(await js('document.documentElement.scrollWidth<=document.documentElement.clientWidth'),'Narrow view overflows');
  fs.writeFileSync(path.join(output,'extractor-narrow.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  win.setSize(1350,1100);
  await click('Use for transcription');
  await until(()=>js("document.querySelector('.audio-transcription .audio-source')?.textContent.includes('-audio.mp3')"),'transcription handoff');
  assert.equal(await js("document.querySelector('[aria-label=\"Audio transcript\"]').value"),'','Handoff must not transcribe automatically');
  let transcribed=false;
  if(process.argv.includes('--transcribe')){
    await until(()=>js("!document.querySelector('.audio-primary').disabled"),'installed speech model');
    await click('Transcribe audio');
    await until(()=>js("document.querySelector('[aria-label=\"Audio transcript\"]').value.length>15 && !document.querySelector('.audio-primary').disabled"),'real speech transcription',1800);
    fs.writeFileSync(path.join(output,'transcript.txt'),await js("document.querySelector('[aria-label=\"Audio transcript\"]').value"));
    transcribed=true;
  }
  await js("document.querySelector('.audio-transcription').scrollIntoView({block:'start',behavior:'instant'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  fs.writeFileSync(path.join(output,'transcription.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  // Cancellation UI uses an explicitly delayed fixture request. Backend tests
  // separately verify real encoder cancellation and disconnect cleanup.
  await js(`window.qaFetch=window.fetch;window.fetch=(url,options)=>new URL(url).pathname==='/audio/extract'?new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>{window.qaAborted=true;reject(new DOMException('Cancelled','AbortError'));},{once:true})):window.qaFetch(url,options);undefined`);
  await click('Extract audio');await until(()=>js("document.querySelector('.audio-extractor').textContent.includes('Cancel extraction')"),'cancel control');
  await click('Cancel extraction');await until(()=>js("document.querySelector('.audio-extractor').textContent.includes('Extraction cancelled.')"),'cancel feedback');
  assert.equal(await js('window.qaAborted'),true);
  await js('window.fetch=window.qaFetch;undefined');
  assert.equal(hash(fs.readFileSync(source)),before,'Source video changed');
  const report={sourceUnchanged:true,track,reports,transcriptionHandoff:true,realTranscription:transcribed,cancellationUi:'delayed fixture response'};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:true,output,...report}));finish();
}).catch(finish);
