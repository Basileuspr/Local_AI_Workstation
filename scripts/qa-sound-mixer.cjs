'use strict';
// Isolated Electron QA: real Web Audio/MediaRecorder, neutral tones, simulated microphone only.
const {app,BrowserWindow,WebContentsView,protocol,net,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {appAsset,APP_HEADERS}=require('../electron/security');
const {installAudioPermissions}=require('../electron/audioPermissions');
const {normalizeNativeMix,createNativeMixer}=require('../electron/soundMixer');
const root=path.resolve(__dirname,'..'),assets=path.join(root,'artifacts/sound-mixer/fixture-build'),work=fs.mkdtempSync(path.join(os.tmpdir(),'law-sound-mixer-qa-'));
const native=Object.fromEntries(['browser','media-manager','integrations'].map(id=>[id,createNativeMixer(id)]));
let win,server;const views=[],errors=[];
app.setPath('userData',path.join(work,'profile'));
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
const watchdog=setTimeout(()=>{console.error('Sound Mixer QA timed out.');app.exit(1);},90000);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  protocol.handle('app',async request=>{
    const response=await net.fetch(pathToFileURL(appAsset(assets,request.url)).toString());
    return new Response(response.body,{headers:{...Object.fromEntries(response.headers),...APP_HEADERS}});
  });
  win=new BrowserWindow({show:false,width:1440,height:1100,webPreferences:{preload:path.join(root,'electron/preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  ipcMain.on('app:connection',event=>{event.returnValue=null;});
  ipcMain.handle('sound-output:open-settings',()=>({opened:true}));
  ipcMain.handle('sound-mixer:configure',(event,value)=>{
    if(!win || win.isDestroyed() || event.sender!==win.webContents || event.senderFrame!==win.webContents.mainFrame)return {error:'Untrusted'};
    const mix=normalizeNativeMix(value);for(const controller of Object.values(native))controller.configure(mix);return {applied:true};
  });
  installAudioPermissions(win.webContents);
  win.webContents.on('console-message',(_event,level,message)=>{if(level===3)errors.push(message);});
  await win.loadURL('app://local/tests/fixtures/soundMixer.html');
  const js=code=>win.webContents.executeJavaScript(code,true);
  async function until(test,label){const end=Date.now()+7000;while(Date.now()<end){if(await test())return;await pause(50);}throw Error('Timed out: '+label);}
  const click=label=>js(`{const button=[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===${JSON.stringify(label)} && !node.disabled && node.getBoundingClientRect().width);if(!button)throw Error('Missing button: '+${JSON.stringify(label)});button.click();}`);
  const channelClick=(name,label)=>js(`document.querySelector('[aria-label="${name} channel"]').querySelector('[aria-label="${label} ${name}"]').click()`);
  const range=(label,value)=>js(`{const input=document.querySelector('.sm-workspace [aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(String(value))});input.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await until(()=>js("Boolean(document.querySelector('.sm-workspace'))"),'board loads');
  assert.equal(await js("document.querySelector('.sm-input-controls').textContent.includes('Microphone off')"),true);
  await click('Load sample tracks');await click('Play all');
  await until(()=>js("Number(document.querySelector('[aria-label=\"Track 1 signal\"]').getAttribute('aria-valuenow'))>-50"),'real track meter');
  await channelClick('Track 2','Mute');
  async function capture(label) {
    await click('Record mix');await pause(1100);await click('Stop recording');await until(()=>js("Boolean(document.querySelector('.sm-record-result audio')) && !document.querySelector('.sm-record-actions button').disabled"),'recording finishes');
    await click('Inspect recorded PCM');await until(()=>js("Boolean(document.querySelector('[aria-label=\"Recording inspection\"]').textContent.includes('channelRms'))"),'decode recording');
    const result=await js("JSON.parse(document.querySelector('[aria-label=\"Recording inspection\"]').textContent)");
    await click('Clear recording');console.log(JSON.stringify({check:label,...result}));return result;
  }
  const baseline=await capture('baseline');assert(baseline.rms>.03);assert.equal(baseline.channels,2);
  await range('Track 1 volume',50);await pause(200);const fader=await capture('fader-half');assert(fader.rms<baseline.rms*.65 && fader.rms>baseline.rms*.35);
  await range('Track 1 volume',100);await click('Mute playback');await pause(200);const muted=await capture('master-muted');assert(muted.rms<.0001);await click('Unmute playback');
  await js("[...document.querySelector('[aria-label=\"Track 1 channel\"]').querySelectorAll('button')].find(node=>node.textContent.startsWith('EQ & pan')).click()");
  await range('Track 1 pan',-100);await pause(200);const pan=await capture('pan-left');assert(pan.channelRms[0]>.03 && pan.channelRms[1]<.0001);
  await range('Track 1 pan',0);await range('Track 1 mid EQ',12);await pause(200);const eq=await capture('mid-boost');assert(eq.rms>baseline.rms*1.1);await range('Track 1 mid EQ',0);
  await channelClick('Track 1','Solo');await until(()=>js("Number(document.querySelector('[aria-label=\"Audio signal\"]').getAttribute('aria-valuenow'))===-60"),'solo gate');await click('Clear solos');
  await click('Record mix');await click('Other workspace');await pause(1100);await click('Mixer board');await until(()=>js("document.querySelector('.sm-record-actions').textContent.includes('continues across tabs')"),'recording survives navigation');await click('Stop recording');await until(()=>js("Boolean(document.querySelector('.sm-record-result audio'))"),'navigation recording finishes');await click('Clear recording');await click('Pause all');
  await range('Playback volume',50);await click('Load speech preview');await click('Other workspace');
  await until(()=>js("document.querySelector('[aria-label=\"Neutral speech preview\"]')?.volume===.5"),'shared master applies outside mixer');await click('Mixer board');await range('Playback volume',100);
  await click('Use simulated microphone');assert.equal(await js("document.querySelector('[aria-label=\"Microphone QA status\"]').textContent"),'Simulated microphone ready · unopened');
  await click('Enable microphone');await until(()=>js("document.querySelector('.sm-input-controls').textContent.includes('Live input joins recordings')"),'simulated microphone opens');
  assert.equal(await js("document.querySelector('[aria-label=\"Monitor in speakers\"]')?.checked || document.querySelector('.sm-monitor input').checked"),false);
  await until(()=>js("Number(document.querySelector('[aria-label=\"Microphone signal\"]').getAttribute('aria-valuenow'))>-50"),'real simulated microphone PCM');
  assert.equal(await js("Number(document.querySelector('[aria-label=\"Master output level\"]').getAttribute('aria-valuenow'))"),-60);
  const microphone=await capture('microphone-monitor-off');assert(microphone.rms>.02);await click('Disable microphone');
  // Separate WebContentsViews verify the desktop volume/mute bridge, including nested and new players.
  server=http.createServer((_request,response)=>{response.setHeader('Content-Type','text/html');response.end('<!doctype html><audio id="player" controls></audio><iframe srcdoc="<audio id=child controls></audio>"></iframe>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const nativeUrl=`http://127.0.0.1:${server.address().port}/`;
  for(const id of Object.keys(native)){
    const view=new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});views.push(view);win.contentView.addChildView(view);view.setVisible(false);native[id].watch(view.webContents);await view.webContents.loadURL(nativeUrl);
  }
  await range('Playback volume',80);await range('Browser volume',50);
  await until(()=>views[0].webContents.executeJavaScript("document.querySelector('audio').volume===.4"),'native browser volume');
  assert.equal(await views[1].webContents.executeJavaScript("document.querySelector('audio').volume"),.8);
  const child=views[0].webContents.mainFrame.framesInSubtree.find(frame=>frame!==views[0].webContents.mainFrame);assert(child);await until(()=>child.executeJavaScript("document.querySelector('audio').volume===.4"),'nested frame volume');
  await views[0].webContents.executeJavaScript("document.body.appendChild(document.createElement('video'));undefined");await until(()=>views[0].webContents.executeJavaScript("document.querySelector('video').volume===.4"),'new native player volume');
  await channelClick('Browser','Mute');await until(()=>views[0].webContents.isAudioMuted(),'native browser mute');assert(!views[1].webContents.isAudioMuted());await channelClick('Browser','Mute');
  await channelClick('Track 1','Solo');await until(()=>views.every(view=>view.webContents.isAudioMuted()),'native solo gates');await click('Clear solos');
  await range('Playback volume',100);await range('Browser volume',100);await until(()=>views[0].webContents.executeJavaScript("document.querySelector('audio').volume===1"),'native gain restored');
  const devices=await js("[...document.querySelector('[aria-label=\"Sound output device\"]').options].map(option=>option.value).filter(id=>id && id!=='communications')");
  let selectedOutputVerified=false;
  if(devices.length){const id=devices[0];await js(`{const input=document.querySelector('[aria-label="Sound output device"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,${JSON.stringify(id)});input.dispatchEvent(new Event('change',{bubbles:true}));}`);await click('Inspect output routing');await until(async()=>{await click('Inspect output routing');return js(`JSON.parse(document.querySelector('[aria-label="Recording inspection"]').textContent).outputDevice===${JSON.stringify(id)}`);},'real AudioContext sink');selectedOutputVerified=true;}
  assert.equal(await js("document.getElementById('fixture-errors').textContent"),'');assert.deepEqual(errors,[]);
  const report={passed:true,baseline,fader,muted,pan,eq,microphone,recordingSurvivesNavigation:true,sharedMaster:true,nativeMuteVolume:true,nestedPlayers:true,newPlayers:true,selectedOutputVerified,physicalMicrophoneTested:false,errors,work};
  fs.mkdirSync(path.join(root,'artifacts/sound-mixer'),{recursive:true});fs.writeFileSync(path.join(root,'artifacts/sound-mixer/desktop-result.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(root,'artifacts/sound-mixer/desktop.png'),(await win.webContents.capturePage()).toPNG());console.log(JSON.stringify(report));
  clearTimeout(watchdog);for(const view of views)view.webContents.close();server.close();win.destroy();app.quit();
}).catch(error=>{console.error(error.stack||String(error));for(const view of views)if(!view.webContents.isDestroyed())view.webContents.close();win?.destroy();server?.close();app.exit(1);});
