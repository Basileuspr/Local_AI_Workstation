// Isolated profile, generated local tone, real permission guard/device routing.
// Does not change Windows output settings, start a microphone or access app data.
const {app,BrowserWindow,ipcMain,protocol,net}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {appAsset,APP_HEADERS}=require('../electron/security');
const {installAudioPermissions}=require('../electron/audioPermissions');
const root=path.resolve(__dirname,'..'),assets=path.join(root,'tmp/sound-output-qa'),work=fs.mkdtempSync(path.join(os.tmpdir(),'law-sound-output-qa-'));
let win,server;
app.setPath('userData',path.join(work,'profile'));
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
const watchdog=process.argv.includes('--serve')?null:setTimeout(()=>{console.error('Sound output QA timed out.');app.exit(1);},55000);
app.whenReady().then(async()=>{
  if(process.argv.includes('--serve')) {
    server=http.createServer((request,response)=>{
      try {const url=new URL(request.url,'http://fixture'),file=appAsset(assets,'app://local'+url.pathname);
        response.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream'});response.end(fs.readFileSync(file));}
      catch {response.writeHead(404);response.end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/tests/fixtures/soundOutput.html`,work}));return;
  }
  protocol.handle('app',async request=>{
    const response=await net.fetch(pathToFileURL(appAsset(assets,request.url)).toString());
    return new Response(response.body,{headers:{...Object.fromEntries(response.headers),...APP_HEADERS}});
  });
  win=new BrowserWindow({show:false,width:1300,height:1100,webPreferences:{preload:path.join(root,'electron/preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  ipcMain.on('app:connection',event=>{event.returnValue=null;});
  ipcMain.handle('sound-output:open-settings',()=>({opened:true})); // Never opens or changes Windows settings in QA.
  installAudioPermissions(win.webContents);
  const errors=[];win.webContents.on('console-message',(_event,level,message)=>{if(level===3)errors.push(message);});
  await win.loadURL('app://local/tests/fixtures/soundOutput.html');
  const js=code=>win.webContents.executeJavaScript(code,true),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function until(test,label){const end=Date.now()+10000;while(Date.now()<end){if(await test())return;await pause(100);}throw Error('Timed out: '+label);}
  const changeSelect=(scope,id)=>js(`{const element=document.querySelector('[aria-label="${scope}"] [aria-label="Sound output device"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(element,${JSON.stringify(id)});element.dispatchEvent(new Event('change',{bubbles:true}));}`);
  const click=(scope,label)=>js(`[...document.querySelectorAll('[aria-label="${scope}"] button')].find(button=>button.textContent.trim()===${JSON.stringify(label)} && !button.disabled).click()`);
  await until(()=>js("document.querySelectorAll('[aria-label=\"Sound output device\"] option').length>3"),'device list');
  const devices=await js("[...document.querySelector('[aria-label=\"Sound output device\"]').options].map(option=>({id:option.value,label:option.textContent}))");
  const chosen=devices.find(device=>device.id && device.id!=='communications');assert(chosen,'No physical sound output was listed.');
  await changeSelect('Settings preview',chosen.id);
  await until(()=>js(`document.querySelector('audio').sinkId===${JSON.stringify(chosen.id)}`),'real sink applied');
  await until(()=>js(`Array.from(document.querySelectorAll('[aria-label="Sound output device"]')).every(element=>element.value===${JSON.stringify(chosen.id)})`),'settings synchronization');
  await js(`{const audio=document.querySelector('audio');audio.volume=.29;audio.muted=true;}`);
  await until(()=>js("[...document.querySelectorAll('[aria-label=\"Playback volume\"]')].every(input=>input.value==='29') && [...document.querySelectorAll('.sound-output-controls button')].every(button=>button.textContent==='Unmute playback')"),'native player controls synchronization');
  await click('Audio preview','Add second preview');
  await until(()=>js(`document.querySelector('[aria-label="Second neutral preview"]')?.sinkId===${JSON.stringify(chosen.id)} && document.querySelector('[aria-label="Second neutral preview"]').volume===.29 && document.querySelector('[aria-label="Second neutral preview"]').muted`),'new preview uses saved output');
  await click('Second chat settings','Unmute playback');
  await until(()=>js("[...document.querySelectorAll('audio')].every(audio=>audio.muted===false)"),'second chat changes global output');
  await click('Settings preview','Test sound');
  await until(()=>js("document.body.textContent.includes('Playing test sound')"),'test playback starts');
  await until(()=>js("!document.body.textContent.includes('Playing test sound')"),'test playback ends');
  assert.equal(await js("document.querySelector('.sound-output-error')?.textContent || ''"),'');
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload();});
  await until(()=>js(`document.querySelector('audio')?.sinkId===${JSON.stringify(chosen.id)} && document.querySelector('[aria-label="Playback volume"]').value==='29'`),'restored after renderer restart');
  await changeSelect('Settings preview','');await until(()=>js("document.querySelector('audio').sinkId===''"),'return to Windows default');
  const state=await js("({volume:document.querySelector('audio').volume,muted:document.querySelector('audio').muted,sink:document.querySelector('audio').sinkId})");
  assert.deepEqual(state,{volume:.29,muted:false,sink:''});assert.equal(errors.length,0);
  await click('Second chat settings','Reset preferences');
  await until(()=>js("document.querySelector('audio').volume===1 && Array.from(document.querySelectorAll('[aria-label=\"Playback volume\"]')).every(input=>input.value==='100')"),'second chat resets shared sound preferences');
  const report={passed:true,deviceCount:devices.length,selectedLabel:chosen.label,realSinkApplied:true,nativeControlsSynchronized:true,secondChatSynchronized:true,newPreviewSynchronized:true,testPlaybackCompleted:true,restartRestored:true,defaultRestored:true,resetSynchronized:true,errors,work};
  fs.writeFileSync(path.join(work,'result.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(work,'interface.png'),(await win.webContents.capturePage()).toPNG());console.log(JSON.stringify(report));
  clearTimeout(watchdog);win.destroy();app.quit();
}).catch(error=>{console.error(error.stack||String(error));win?.destroy();server?.close();app.exit(1);});
