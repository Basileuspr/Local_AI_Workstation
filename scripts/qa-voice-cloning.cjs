// Real model inference through the Audio workspace. Supply a synthetic or
// authorized 6-30 second reference and its exact transcript as arguments.
const {app,BrowserWindow,protocol,net}=require('electron');
const {spawn}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const {randomBytes,createHash}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'), source=path.resolve(process.argv[2]), referenceText=process.argv[3];
const engines=process.argv[4] ? [process.argv[4]] : ['chatterbox-turbo','omnivoice','qwen3-tts'];
const work=fs.mkdtempSync(path.join(os.tmpdir(),'law-voice-qa-'));
const output=path.join(root,'artifacts/voice-cloning-smoke',String(Date.now()));fs.mkdirSync(output,{recursive:true});
const before=createHash('sha256').update(fs.readFileSync(source)).digest('hex'),token=randomBytes(32).toString('hex');
app.setPath('userData',path.join(work,'profile'));
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
let win,backend;
const timeout=setTimeout(()=>finish(Error('Voice QA exceeded thirty minutes')),1800000);
function finish(error){clearTimeout(timeout);backend?.kill();win?.destroy();if(error)console.error(error);app.exit(error?1:0);}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  backend=spawn(path.join(root,'venv/Scripts/python.exe'),['-u','tests/fixtures/audio_backend.py'],{cwd:root,windowsHide:true,env:{...process.env,LAW_SESSION_TOKEN:token},stdio:['ignore','pipe','pipe']});
  const port=await new Promise((resolve,reject)=>{
    let buffer='';backend.once('error',reject);backend.once('exit',code=>reject(Error(`Voice API exited ${code}`)));
    backend.stdout.on('data',chunk=>{buffer+=chunk;try{resolve(JSON.parse(buffer.split('\n')[0]).port);}catch{}});
  });
  backend.stderr.on('data',chunk=>process.stderr.write(chunk));
  for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/audio/voices/status`,{headers:{'X-LAW-Session':token}})).ok)break;}catch{}await sleep(100);}
  protocol.handle('app',request=>net.fetch(pathToFileURL(path.join(root,'tmp/audio-qa',new URL(request.url).pathname)).toString()));
  win=new BrowserWindow({show:false,width:1350,height:1250,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  const js=code=>win.webContents.executeJavaScript(code,true);
  const until=async(fn,label,attempts=100)=>{for(let i=0;i<attempts;i++){if(await fn())return;await sleep(200);}throw Error('Timed out: '+label);};
  const set=(label,value,tag='HTMLInputElement')=>js(`(()=>{const e=document.querySelector('[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(${tag}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(${JSON.stringify(tag==='HTMLSelectElement'?'change':'input')},{bubbles:true}));})()`);
  await win.loadURL(`app://local/tests/fixtures/audio.html?apiPort=${port}&apiToken=${token}`);
  await until(()=>js("document.querySelector('.audio-cloning')?.textContent.includes('Installed locally')"),'installed status');
  win.webContents.debugger.attach('1.3');
  const {root:document}=await win.webContents.debugger.sendCommand('DOM.getDocument');
  const {nodeId}=await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:document.nodeId,selector:'[aria-label="Reference voice recording"]'});
  await win.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId,files:[source]});
  await until(()=>js("!!document.querySelector('[aria-label=\"Reference voice preview\"]')"),'reference selected');
  await js("[...document.querySelectorAll('button')].find(e=>e.textContent==='Transcribe reference').click()");
  await until(()=>js("document.querySelector('[aria-label=\"Reference voice transcript\"]').value.length>20 && ![...document.querySelectorAll('button')].find(e=>e.textContent==='Transcribe reference').disabled"),'reference transcription',600);
  await set('Reference voice transcript',referenceText,'HTMLTextAreaElement');
  const text='This is a local voice cloning test. The models are installed in the audio workspace.';
  await set('Text for cloned voice',text,'HTMLTextAreaElement');
  await js(`const originalFetch=window.fetch;window.fetch=async(...args)=>{const response=await originalFetch(...args);if(new URL(args[0]).pathname==='/audio/voices/synthesize'){window.qaResponse={status:response.status,processing:JSON.parse(response.headers.get('x-voice-processing')||'{}'),error:response.ok?null:await response.clone().text()};}return response;};undefined`);
  const reports=[];
  for(const engine of engines){
    await set('Voice cloning model',engine,'HTMLSelectElement');
    await sleep(150);
    await js("(()=>{window.qaResponse=null;document.querySelector('.audio-cloning').scrollIntoView({block:'start'});const b=[...document.querySelectorAll('button')].find(e=>e.textContent==='Generate cloned voice');if(b.disabled)throw Error('Generate is disabled');b.click();})()");
    console.log(`Generating ${engine} with the real model...`);
    await until(()=>js('!!window.qaResponse'),'generation response',3100);
    const response=await js('window.qaResponse');assert.equal(response.status,200,response.error);
    await until(()=>js("document.querySelector('[aria-label=\"Generated cloned voice\"]')?.readyState>=1 && ![...document.querySelectorAll('button')].find(e=>e.textContent==='Generate cloned voice').disabled"),'playable waveform');
    await until(()=>js(`document.querySelector('.audio-cloning .audio-source:last-of-type')?.textContent.includes(${JSON.stringify(engine==='qwen3-tts'?'Qwen3-TTS':engine==='omnivoice'?'OmniVoice':'Chatterbox Turbo')})`),'correct engine result');
    const duration=await js("document.querySelector('[aria-label=\"Generated cloned voice\"]').duration");assert(duration>1 && duration<180);
    const destination=path.join(output,`${engine}.wav`);
    const saved=new Promise((resolve,reject)=>win.webContents.session.once('will-download',(_event,item)=>{item.setSavePath(destination);item.once('done',(_e,state)=>state==='completed'?resolve():reject(Error(state)));}));
    await js("[...document.querySelectorAll('button')].find(e=>e.textContent==='Save generated WAV').click()");await saved;
    assert(fs.readFileSync(destination).subarray(0,4).equals(Buffer.from('RIFF')));
    reports.push({engine,duration,processing:response.processing,output:destination});console.log(JSON.stringify(reports.at(-1)));
  }
  assert.equal(createHash('sha256').update(fs.readFileSync(source)).digest('hex'),before);
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({referenceUnchanged:true,referenceFile:path.basename(source),text,reports},null,2));
  await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  fs.writeFileSync(path.join(output,'workspace.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  console.log(JSON.stringify({passed:true,output,engines}));finish();
}).catch(finish);
