// Owned test windows and generated fixtures. No live Spotify or microphone is
// accessed. Only the generated icon is written, inside a new temporary folder.
const {app,BrowserWindow,ipcMain,protocol,net}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {appAsset,APP_HEADERS,trustedUrl}=require('../electron/security');
const playback=require('../electron/playbackCapture'),{installAudioPermissions}=require('../electron/audioPermissions');
const {createConvertedImageSaver}=require('../electron/convertedImages');
const root=path.resolve(__dirname,'..'),assets=path.join(root,'tmp/playback-downloads-qa'),work=fs.mkdtempSync(path.join(os.tmpdir(),'law-playback-downloads-qa-'));
const generated=spawnSync(path.join(root,'venv/Scripts/python.exe'),['-B','-c',"from PIL import Image; import sys; image=Image.new('RGBA',(256,256),(40,100,180,255)); image.save(sys.argv[1]); image.save(sys.argv[2],sizes=[(16,16),(32,32),(48,48),(256,256)])",path.join(work,'neutral.png'),path.join(work,'neutral.ico')],{windowsHide:true});
if(generated.status!==0)throw Error('Could not create neutral icon fixture.');
const icon=fs.readFileSync(path.join(work,'neutral.ico')),preview=fs.readFileSync(path.join(work,'neutral.png'));
const token='playback-download-fixture',id='a'.repeat(32),checks=[],dialogOptions=[];
let server,win,tone;
const watchdog=process.argv.includes('--serve')?null:setTimeout(()=>{console.error('Playback/download QA timed out');app.exit(1);},60000);
app.setPath('userData',path.join(work,'profile'));
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
app.whenReady().then(async()=>{
  server=http.createServer((request,response)=>{
    const url=new URL(request.url,'http://fixture');
    if(url.pathname===`/workspaces/converted/${id}`){
      if(request.headers['x-law-session']!==token && url.searchParams.get('law_token')!==token && request.headers.origin==='app://local') {response.writeHead(401);response.end();return;}
      const thumbnail=url.searchParams.has('thumbnail');response.writeHead(200,{'Content-Type':thumbnail?'image/png':'image/vnd.microsoft.icon',
        'Content-Disposition':'attachment; filename="neutral.ico"','Access-Control-Allow-Origin':'*'});response.end(thumbnail?preview:icon);return;
    }
    try {
      const file=appAsset(assets,'app://local'+url.pathname);
      const extension=path.extname(file),types={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
      response.writeHead(200,{'Content-Type':types[extension] || 'application/octet-stream'});response.end(fs.readFileSync(file));
    } catch{response.writeHead(404);response.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  if(process.argv.includes('--serve')){console.log(JSON.stringify({url:base+'/tests/fixtures/playbackDownloads.html?apiBase='+encodeURIComponent(base),work}));return;}
  protocol.handle('app',async request=>{
    if(new URL(request.url).pathname==='/tone.html')return new Response('<html><body>Neutral source</body></html>',{headers:{'Content-Type':'text/html'}});
    const response=await net.fetch(pathToFileURL(appAsset(assets,request.url)).toString());return new Response(response.body,{headers:{...Object.fromEntries(response.headers),...APP_HEADERS,
      // Only this fixture reads its in-memory recording bytes for decode QA.
      'Content-Security-Policy':APP_HEADERS['Content-Security-Policy'].replace("connect-src 'self'", "connect-src 'self' blob:")}});
  });
  tone=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}});
  await tone.loadURL('app://local/tone.html');
  await tone.webContents.executeJavaScript(`window.qaTone=new AudioContext();window.qaOsc=qaTone.createOscillator();const gain=qaTone.createGain();gain.gain.value=.01;qaOsc.connect(gain).connect(qaTone.destination);qaOsc.start();qaTone.resume();`,true);
  win=new BrowserWindow({show:false,width:1280,height:1000,webPreferences:{preload:path.join(root,'electron/preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  const trusted=event=>event.sender===win.webContents && event.senderFrame===win.webContents.mainFrame && trustedUrl(event.senderFrame.url);
  ipcMain.on('app:connection',event=>{event.returnValue={base,token};});
  ipcMain.handle('linked-content:place',()=>{});ipcMain.handle('linked-content:close',()=>{});
  ipcMain.handle('playback-capture:status',event=>trusted(event)?{...playback.playbackCaptureStatus(event.sender),spotify_ready:true}:{supported:false});
  ipcMain.handle('playback-capture:arm',(event,value)=>{if(!trusted(event))return {error:'Untrusted frame'};playback.grantPlayback(event.sender,value);return {ready:true};});
  ipcMain.handle('playback-capture:cancel',event=>{if(trusted(event))playback.revokePlayback(event.sender);});
  const save=createConvertedImageSaver({getResponse:ident=>fetch(`${base}/workspaces/converted/${ident}`,{headers:{'X-LAW-Session':token}}),downloads:()=>work,
    showDialog:async options=>{dialogOptions.push(options);return {filePath:path.join(work,'saved-neutral.ico')};}});
  ipcMain.handle('converted-image:save',(event,ident)=>{if(!trusted(event))return {error:'Untrusted frame'};return save(ident);});
  installAudioPermissions(win.webContents);playback.installPlaybackCapture(win.webContents,{getSources:async()=>{throw Error('Player capture must not enumerate screens.');}},null,{getSpotifyFrame:()=>tone.webContents.mainFrame});
  win.webContents.on('will-frame-navigate',event=>{if(!trustedUrl(event.url))event.preventDefault();});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  await win.loadURL('app://local/tests/fixtures/playbackDownloads.html');
  const js=code=>win.webContents.executeJavaScript(code,true),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function until(test,label){const end=Date.now()+12000;while(Date.now()<end){if(await test())return;await pause(100);}throw Error('Timed out: '+label);}
  const click=label=>js(`[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(label)} && !button.disabled).click()`);
  await until(()=>js("!!document.querySelector('.linked-tabs')"),'UI load');await click('Spotify');
  await until(()=>js("document.body.textContent.includes('Desktop capture supported')"),'readiness');
  await js(`const select=document.querySelector('[aria-label="Playback recording source"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'spotify');select.dispatchEvent(new Event('change',{bubbles:true}));`);
  await click('Start playback recording');await until(()=>js("!!document.querySelector('.linked-capture-meter')"),'real player recording');
  await until(()=>js("document.querySelector('.linked-capture-meter')?.textContent.includes('Audio signal received')"),'real audio signal');
  assert(!playback.playbackGranted(win.webContents));await pause(1300);await click('Stop recording');
  await until(()=>js("!!document.querySelector('.linked-preview audio')"),'playback preview');
  const recorded=await js(`(async()=>{const audio=document.querySelector('.linked-preview audio');const data=await (await fetch(audio.src)).arrayBuffer();const context=new AudioContext();const decoded=await context.decodeAudioData(data.slice(0));const samples=decoded.getChannelData(0);let sum=0;for(const sample of samples)sum+=sample*sample;await context.close();return {bytes:data.byteLength,seconds:decoded.duration,rms:Math.sqrt(sum/samples.length)};})()`);
  assert(recorded.seconds>1 && recorded.rms>.00025);checks.push({player_audio:recorded,permission_revoked:true});
  await click('Download .ico');await until(()=>js("document.body.textContent.includes('Saved saved-neutral.ico.')"),'confirmed native icon save');
  assert.deepEqual(fs.readFileSync(path.join(work,'saved-neutral.ico')),icon);assert.equal(dialogOptions.length,1);checks.push({ico_saved:true,bytes:icon.length,identical:true});
  const report={passed:true,checks,work};fs.writeFileSync(path.join(work,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  clearTimeout(watchdog);win.destroy();tone.destroy();server.close();app.quit();
}).catch(error=>{console.error(error.stack || String(error));win?.destroy();tone?.destroy();server?.close();app.exit(1);});
