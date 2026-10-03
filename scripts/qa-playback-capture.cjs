// Real Windows loopback, a neutral test tone, no saved recording or Spotify interaction.
const {app,BrowserWindow,protocol,desktopCapturer}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const assert=require('node:assert/strict');
const {installAudioPermissions}=require('../electron/audioPermissions');
const {installPlaybackCapture,grantPlayback,revokePlayback,playbackGranted}=require('../electron/playbackCapture');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'law-playback-qa-'));
app.setPath('userData',path.join(work,'profile'));
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.whenReady().then(async()=>{
  protocol.handle('app',()=>new Response('<html><body>Neutral playback capture test</body></html>',{headers:{'Content-Type':'text/html'}}));
  const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}});
  const mediaHandler=win.webContents.session.setDisplayMediaRequestHandler.bind(win.webContents.session);
  win.webContents.session.setDisplayMediaRequestHandler=handler=>mediaHandler((request,callback)=>{
    console.log(JSON.stringify({capture_request:true,user_gesture:request.userGesture,audio_requested:request.audioRequested,main_frame:request.frame===win.webContents.mainFrame,origin:request.securityOrigin,granted:playbackGranted(win.webContents)}));
    handler(request,callback);
  });
  const permissions=win.webContents.session.setPermissionRequestHandler.bind(win.webContents.session);
  win.webContents.session.setPermissionRequestHandler=handler=>permissions((contents,permission,callback,details)=>handler(contents,permission,value=>{console.log(JSON.stringify({permission,allowed:value,origin:details.requestingUrl,main_frame:details.isMainFrame,types:details.mediaTypes,type:details.mediaType,requester_id:contents?.id,main_id:win.webContents.id,url:contents?.getURL(),granted:playbackGranted(win.webContents)}));callback(value);},details));
  const checks=win.webContents.session.setPermissionCheckHandler.bind(win.webContents.session);
  win.webContents.session.setPermissionCheckHandler=handler=>checks((contents,permission,origin,details)=>{
    const allowed=handler(contents,permission,origin,details);
    console.log(JSON.stringify({check:permission,allowed,origin,main_frame:details.isMainFrame,types:details.mediaTypes,type:details.mediaType,granted:playbackGranted(win.webContents)}));
    return allowed;
  });
  installAudioPermissions(win.webContents);installPlaybackCapture(win.webContents,{
    getSources: async options => {const sources=await desktopCapturer.getSources(options);console.log(JSON.stringify({screen_sources:sources.length}));return sources;}
  });
  await win.loadURL('app://local/index.html');
  grantPlayback(win.webContents);
  const result=await win.webContents.executeJavaScript(`(async()=>{
    const context=new AudioContext(),oscillator=context.createOscillator(),gain=context.createGain();
    oscillator.frequency.value=440;gain.gain.value=.01;oscillator.connect(gain).connect(context.destination);
    await context.resume();oscillator.start();
    let stream;
    try { stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},systemAudio:'include'}); }
    catch(error) { oscillator.stop();await context.close();return {capture_error:error.name,detail:error.message}; }
    const track=stream.getAudioTracks()[0];if(!track)throw Error('No loopback audio track');
    const audio=new MediaStream([track]),recorder=new MediaRecorder(audio,{mimeType:'audio/webm;codecs=opus'}),chunks=[];
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    const stopped=new Promise(resolve=>recorder.onstop=resolve);
    recorder.start(100);await new Promise(resolve=>setTimeout(resolve,1600));recorder.stop();await stopped;
    oscillator.stop();await context.close();stream.getTracks().forEach(track=>track.stop());
    const blob=new Blob(chunks,{type:'audio/webm'});
    return {audio_tracks:audio.getAudioTracks().length,bytes:blob.size,mime:recorder.mimeType,all_tracks_stopped:stream.getTracks().every(track=>track.readyState==='ended')};
  })()`,true);
  if(result.capture_error)throw Error(`${result.capture_error}: ${result.detail}`);
  revokePlayback(win.webContents);
  assert.equal(result.audio_tracks,1);assert(result.bytes>500);assert(result.all_tracks_stopped);assert(!playbackGranted(win.webContents));
  console.log(JSON.stringify({passed:true,...result}));win.destroy();app.quit();
}).catch(error=>{console.error(JSON.stringify(error),String(error),error?.stack || '');app.exit(1);});
