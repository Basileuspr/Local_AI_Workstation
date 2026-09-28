// Real Electron recording from a synthetic WAV, then real local transcription
// and OmniVoice synthesis. Later failure/navigation cases use explicit mocks.
// Never opens the physical microphone or the running app's profile.
const {app,BrowserWindow,protocol,net}=require('electron');
const {spawn}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const {randomBytes,createHash}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {installAudioPermissions}=require('../electron/audioPermissions');
const root=path.resolve(__dirname,'..'),source=path.resolve(process.argv[2]);
const work=fs.mkdtempSync(path.join(os.tmpdir(),'law-voice-recording-'));
const output=path.join(root,'artifacts/voice-recording-smoke',String(Date.now()));fs.mkdirSync(output,{recursive:true});
const before=createHash('sha256').update(fs.readFileSync(source)).digest('hex'),token=randomBytes(32).toString('hex');
app.setPath('userData',path.join(work,'profile'));
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-file-for-fake-audio-capture',source);
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
let win,backend;
const timeout=setTimeout(()=>finish(Error('Recording QA exceeded fifteen minutes')),900000);
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
  win=new BrowserWindow({show:false,width:1350,height:1450,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  installAudioPermissions(win.webContents);win.webContents.setAudioMuted(true);
  const js=code=>win.webContents.executeJavaScript(code,true);
  const until=async(fn,label,attempts=100)=>{for(let i=0;i<attempts;i++){if(await fn())return;await sleep(200);}throw Error('Timed out: '+label);};
  const click=label=>js(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(label)}&&e.getClientRects().length);if(!b||b.disabled)throw Error('Missing enabled button: '+${JSON.stringify(label)});b.click();})()`);
  const set=(label,value,tag='HTMLTextAreaElement')=>js(`(()=>{const e=document.querySelector('[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(${tag}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(${JSON.stringify(tag==='HTMLSelectElement'?'change':'input')},{bubbles:true}));})()`);
  const save=async(label,name)=>{
    const destination=path.join(output,name);
    const done=new Promise((resolve,reject)=>win.webContents.session.once('will-download',(_event,item)=>{item.setSavePath(destination);item.once('done',(_e,state)=>state==='completed'?resolve():reject(Error(state)));}));
    await click(label);await done;return destination;
  };
  const screenshot=async(name)=>{
    await js("document.querySelector('.audio-cloning').scrollIntoView({block:'start'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    fs.writeFileSync(path.join(output,name),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  };
  await win.loadURL(`app://local/tests/fixtures/audio.html?apiPort=${port}&apiToken=${token}`);
  await until(()=>js("document.querySelector('.audio-cloning')?.textContent.includes('Installed locally')"),'installed status');
  await js(`window.qaTracks=[];window.qaPlays=0;window.qaRequests=[];
    window.qaMicrophone=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async options=>{const stream=await qaMicrophone(options);qaTracks.push(...stream.getTracks());return stream;};
    document.addEventListener('play',event=>{if(event.target.getAttribute('aria-label')==='Generated cloned voice')qaPlays++;},true);
    window.qaFetch=window.fetch;window.fetch=async(...args)=>{
      const route=new URL(args[0]).pathname;
      if(route.endsWith('/transcribe')||route.endsWith('/synthesize'))qaRequests.push({route,text:args[1].body.get('text'),referenceText:args[1].body.get('reference_text'),acceleration:args[1].body.get('acceleration')});
      const response=await qaFetch(...args);
      if(route.endsWith('/synthesize')){window.qaSynthesis={status:response.status,processing:JSON.parse(response.headers.get('x-voice-processing')||'{}'),error:response.ok?null:await response.clone().text()};if(response.ok)window.qaWave=await response.clone().blob();}
      return response;
    };undefined`);
  assert.equal(await js("[...document.querySelectorAll('button')].find(e=>e.textContent==='Demo this voice').disabled"),true);

  await click('Record voice reference');
  await until(()=>js("document.querySelector('.audio-voice-recorder').textContent.includes('Stop and use recording')"),'capture started');
  await sleep(1100);await click('Stop and use recording');
  await until(()=>js("document.querySelector('.audio-cloning [role=alert]')?.textContent.includes('too short')"),'short recording rejected');
  assert.equal(await js("!!document.querySelector('[aria-label=\"Reference voice preview\"]')"),false);
  assert.equal(await js("qaTracks.every(track=>track.readyState==='ended')"),true);

  await click('Record voice reference');
  await until(()=>js("document.querySelector('.audio-voice-recorder').textContent.includes('Stop and use recording')"),'discard capture');
  await click('Discard recording');
  assert.equal(await js("qaTracks.every(track=>track.readyState==='ended')"),true);
  assert.equal(await js("!!document.querySelector('[aria-label=\"Reference voice preview\"]')"),false);

  // Permission can resolve after the user has already left Audio.
  await js("navigator.mediaDevices.getUserMedia=async options=>{const stream=await qaMicrophone(options);qaTracks.push(...stream.getTracks());return new Promise(resolve=>window.qaGrant=()=>resolve(stream));};undefined");
  await click('Record voice reference');await until(()=>js('!!window.qaGrant'),'deferred permission');
  await click('Switch workspace');await js('qaGrant();undefined');
  await until(()=>js("qaTracks.every(track=>track.readyState==='ended')"),'late microphone released');
  await click('Switch workspace');
  await js("navigator.mediaDevices.getUserMedia=async options=>{const stream=await qaMicrophone(options);qaTracks.push(...stream.getTracks());return stream;};undefined");

  console.log('Recording synthetic speech through the real microphone capture path (20 seconds)...');
  await click('Record voice reference');
  await until(()=>js("document.querySelector('.audio-voice-recorder').textContent.includes('Ready to use')"),'minimum speech length');
  await screenshot('recording.png');
  await until(()=>js("!!document.querySelector('[aria-label=\"Reference voice preview\"]')"),'automatic recording stop',100);
  assert.equal(await js("qaTracks.every(track=>track.readyState==='ended')"),true);
  assert.equal(await js('qaRequests.length'),0,'Recording alone never submits audio');
  const recorded=await js("qaFetch(document.querySelector('[aria-label=\"Reference voice preview\"]').src).then(r=>r.arrayBuffer()).then(b=>Array.from(new Uint8Array(b)))");
  const savedReference=await save('Save reference recording','reference.webm');
  assert.deepEqual(fs.readFileSync(savedReference),Buffer.from(recorded));

  await set('Voice cloning model','omnivoice','HTMLSelectElement');await sleep(100);
  console.log('Demo: automatic real Whisper transcription, real OmniVoice generation, automatic muted playback...');
  await click('Demo this voice');
  await until(()=>js('!!window.qaSynthesis'),'real demo response',3100);
  const inference=await js('qaSynthesis');assert.equal(inference.status,200,inference.error);
  await until(()=>js('qaPlays===1'),'automatic demo playback');
  await until(()=>js("document.querySelector('[aria-label=\"Generated cloned voice\"]').currentTime>0"),'playback advances');
  const requests=await js('qaRequests');
  assert.deepEqual(requests.map(value=>value.route),['/audio/transcribe','/audio/voices/synthesize']);
  assert(requests[1].referenceText.length>30);assert.match(requests[1].text,/my cloned voice/i);
  const transcript=await js("document.querySelector('[aria-label=\"Reference voice transcript\"]').value");
  assert.match(transcript,/sample voice|audio workspace|quick brown fox/i,'Fake microphone must contain speech, not the fake-device tone');
  const duration=await js("document.querySelector('[aria-label=\"Generated cloned voice\"]').duration");assert(duration>1&&duration<60);
  const generated=await save('Save generated WAV','demo.wav');assert.equal(fs.readFileSync(generated).subarray(0,4).toString(),'RIFF');
  await screenshot('demo.png');

  // All remaining responses are simulated to check races without extra GPU jobs.
  await set('Text for cloned voice','My custom demo text.');
  await js("window.fetch=async(...args)=>{if(new URL(args[0]).pathname.endsWith('/synthesize')){window.qaCustomText=args[1].body.get('text');return new Promise(resolve=>window.qaFinish=()=>resolve(new Response(qaWave,{headers:{'content-type':'audio/wav'}})));}return qaFetch(...args);};undefined");
  await click('Demo this voice');await until(()=>js('!!window.qaFinish'),'queued demo');
  assert.equal(await js('qaCustomText'),'My custom demo text.');
  await click('Switch workspace');await js('qaFinish();undefined');await sleep(250);
  await click('Switch workspace');await sleep(250);
  assert.equal(await js('qaPlays'),1,'Returning must not replay the old or pending demo');
  assert.equal(await js("document.querySelector('[aria-label=\"Generated cloned voice\"]').paused"),true);

  await set('Reference voice transcript','');
  await js("window.qaExtraSynthesis=0;window.fetch=async(...args)=>{const route=new URL(args[0]).pathname;if(route.endsWith('/synthesize'))qaExtraSynthesis++;if(route.endsWith('/transcribe'))return new Promise(resolve=>window.qaTranscribed=()=>resolve(new Response(JSON.stringify({text:'Synthetic reference words.'}),{headers:{'content-type':'application/json'}})));return qaFetch(...args);};undefined");
  await click('Demo this voice');await until(()=>js('!!window.qaTranscribed'),'queued transcription');
  await click('Switch workspace');await js('qaTranscribed();undefined');await sleep(250);await click('Switch workspace');await sleep(250);
  assert.equal(await js('qaExtraSynthesis'),0,'Leaving during transcription must not start synthesis');

  await js("window.qaPlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){return Promise.reject(new DOMException('Blocked by browser','NotAllowedError'));};window.fetch=async(...args)=>new URL(args[0]).pathname.endsWith('/synthesize')?new Response(qaWave,{headers:{'content-type':'audio/wav'}}):qaFetch(...args);undefined");
  await click('Demo this voice');
  await until(()=>js("document.querySelector('.audio-cloning').textContent.includes('Press Play below')"),'autoplay fallback');
  await js('HTMLMediaElement.prototype.play=qaPlay;undefined');

  await js("window.fetch=async(...args)=>new URL(args[0]).pathname.endsWith('/synthesize')?new Response(JSON.stringify({detail:'QA model failure'}),{status:500,headers:{'content-type':'application/json'}}):qaFetch(...args);undefined");
  await click('Demo this voice');await until(()=>js("document.querySelector('.audio-cloning [role=alert]')?.textContent==='QA model failure'"),'generation error');
  assert.equal(await js("[...document.querySelectorAll('button')].find(e=>e.textContent==='Demo this voice').disabled"),false,'Demo retry enabled');
  await js("navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError');};undefined");
  await click('Record a new reference');
  await until(()=>js("document.querySelector('.audio-cloning [role=alert]')?.textContent.includes('denied')"),'microphone denial');
  assert.equal(await js("!!document.querySelector('[aria-label=\"Reference voice preview\"]')"),true,'A failed replacement preserves the existing reference');
  assert.equal(createHash('sha256').update(fs.readFileSync(source)).digest('hex'),before);

  const report={passed:true,sourceUnchanged:true,recordingInput:'Synthetic speech WAV via Chromium fake microphone; physical microphone never opened',reference:savedReference,generated,transcript,duration,inference,
    realChecks:['20-second bounded recording','short capture rejected','discard releases microphone','late permission releases microphone','original reference saved byte-for-byte','automatic Whisper transcription','OmniVoice inference','automatic playback advances (muted)','generated WAV saved'],
    simulatedChecks:['custom demo text submission','navigation suppresses late playback','navigation ends transcription/generation chain','blocked autoplay fallback','generation error allows retry','permission denial preserves previous reference']};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,output,inference}));finish();
}).catch(finish);
