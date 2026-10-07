import {channelIsMuted, defaultMixerSettings, flatChannel, mixerChannelIds, normalizeMixerSettings, pcmMeter, trackIds} from './mixerSettings';

export const MIX_RECORD_LIMIT_MS=5*60*1000;
export const MIX_RECORD_LIMIT_BYTES=32*1024*1024;

// One graph for the renderer. No microphone, playback or recording starts on construction.
export function createSoundMixer(env=globalThis) {
  const listeners=new Set(), mediaEntries=new Set(), sourceCache=new WeakMap(), strips=new Map(), tracks=new Map();
  let settings=defaultMixerSettings, master={volume:1,muted:false,deviceId:''}, context=null, output=null, recordBus=null;
  let recorder=null, recording=null, recordVersion=0, mic=null, micVersion=0, registerPlayer=null, holdCapture=()=>()=>{};
  let routeOperation=Promise.resolve(), routeVersion=0;
  let nativeMix='', nativeVersion=0;
  let snapshot={enabled:false, contextState:'off', error:'', routeError:'', settings, tracks:[], microphone:'off', monitor:false,
    inputs:[], recording:'idle', recordingStarted:0, recordingSeconds:0, recordingBytes:0, result:null};
  const publish=patch=>{snapshot={...snapshot,...patch};listeners.forEach(listener=>listener());};
  function syncNative() {
    const desktop=env.workstationDesktop || env.window?.workstationDesktop;
    if(!desktop?.setSoundMix)return;
    const mix={volume:master.volume,muted:master.muted,channels:Object.fromEntries(['browser','media-manager','integrations'].map(id=>[id,{volume:settings.channels[id].volume,muted:channelIsMuted(settings,id)}]))};
    const serial=JSON.stringify(mix);if(serial===nativeMix)return;nativeMix=serial;const version=++nativeVersion;
    void Promise.resolve().then(()=>desktop.setSoundMix(mix)).then(result=>{if(result?.error && version===nativeVersion)publish({error:result.error});}).catch(()=>{if(version===nativeVersion)publish({error:'Desktop player controls could not be updated. Restart the desktop app after updating.'});});
  }
  const param=(target,value)=>{if(context?.state==='running' && target.setTargetAtTime)target.setTargetAtTime(value,context.currentTime,.012);else target.value=value;};
  const analyser=()=>{const node=context.createAnalyser();node.fftSize=1024;return node;};
  const limiter=()=>{const node=context.createDynamicsCompressor();node.threshold.value=-3;node.knee.value=6;node.ratio.value=12;node.attack.value=.003;node.release.value=.15;return node;};
  function makeBus(destination) {
    const input=context.createGain(), compressor=limiter(), bypass=context.createGain(), meter=analyser();
    input.connect(compressor);input.connect(bypass);
    const limited=context.createGain();compressor.connect(limited);limited.connect(meter);bypass.connect(meter);meter.connect(destination);
    return {input,limited,bypass,meter};
  }
  function applyStrip(id,strip) {
    const value=settings.channels[id] || flatChannel;
    param(strip.gain.gain,channelIsMuted(settings,id)?0:value.volume);
    param(strip.pan.pan,value.pan);param(strip.low.gain,value.low);param(strip.mid.gain,value.mid);param(strip.high.gain,value.high);
    // HTML players retain the shared native volume. Live sources need their own master stage.
    param(strip.liveMaster.gain,master.muted?0:master.volume);
    param(strip.monitor.gain,id==='microphone' && !snapshot.monitor ? 0 : 1);
  }
  function strip(id) {
    if(strips.has(id))return strips.get(id);
    const input=context.createGain(), liveMaster=context.createGain(), low=context.createBiquadFilter(), mid=context.createBiquadFilter(), high=context.createBiquadFilter();
    low.type='lowshelf';low.frequency.value=120;mid.type='peaking';mid.frequency.value=1000;mid.Q.value=.8;high.type='highshelf';high.frequency.value=6000;
    const pan=context.createStereoPanner(), gain=context.createGain(), meter=analyser(), monitor=context.createGain();
    liveMaster.connect(input);input.connect(low);low.connect(mid);mid.connect(high);high.connect(pan);pan.connect(gain);gain.connect(meter);
    meter.connect(monitor);monitor.connect(output.input);meter.connect(recordBus.input);
    const value={input,liveMaster,low,mid,high,pan,gain,meter,monitor};strips.set(id,value);applyStrip(id,value);return value;
  }
  function configure(value) {
    settings=normalizeMixerSettings(value);
    for(const [id,value] of strips)applyStrip(id,value);
    for(const bus of [output,recordBus])if(bus){param(bus.limited.gain,settings.limiter?1:0);param(bus.bypass.gain,settings.limiter?0:1);}
    for(const entry of mediaEntries)entry.changed?.();
    syncNative();
    publish({settings});
  }
  async function route() {
    if(!context)return;
    const version=++routeVersion, deviceId=master.deviceId;
    routeOperation=routeOperation.catch(()=>{}).then(async()=>{
      if(version!==routeVersion)return;
      let error='';
      if(typeof context.setSinkId!=='function') {if(deviceId)error='The audio graph cannot select an output here. Mixer effects use the system default.';}
      else try {await context.setSinkId(deviceId);}catch {error='The mixer output is unavailable. Using system default.';try{await context.setSinkId('');}catch{error='Could not open the mixer output. Choose an available device.';await context.suspend();}}
      if(version===routeVersion)publish({routeError:error,outputDevice:typeof context.sinkId==='string'?context.sinkId:''});
    });
    return routeOperation;
  }
  function setMaster(value) {
    const previous=master.deviceId;master={...value};
    for(const [id,value] of strips)applyStrip(id,value);
    if(previous!==master.deviceId)void route();
    syncNative();
  }
  async function enable() {
    if(!context) {
      const AudioContext=env.AudioContext || env.webkitAudioContext;
      if(!AudioContext)throw Error('Audio mixing needs the desktop app or a browser with Web Audio.');
      context=new AudioContext();
      output=makeBus(context.destination);
      const destination=context.createMediaStreamDestination();recordBus={...makeBus(destination),destination};
      context.onstatechange=()=>publish({contextState:context.state});
      configure(settings);publish({enabled:true,contextState:context.state,error:''});void route();
    }
    await context.resume();
    for(const entry of mediaEntries)if(!entry.media.paused)connectMedia(entry);
    publish({contextState:context.state});return context;
  }
  function safeMedia(media) {
    const source=media.currentSrc || media.src;
    if(!source)return false;
    if(/^(blob:|data:)/i.test(source))return true;
    if(media.crossOrigin)return true;
    try{return new URL(source,env.location?.href).origin===env.location?.origin;}catch{return false;}
  }
  function connectMedia(entry) {
    if(!context || entry.connected || !safeMedia(entry.media))return;
    try {
      let source=sourceCache.get(entry.media);
      if(!source){source=context.createMediaElementSource(entry.media);sourceCache.set(entry.media,source);}
      source.connect(strip(entry.channel).input);entry.source=source;entry.connected=true;entry.changed?.();
    }catch {publish({error:'A player could not use mixer effects. Its volume and mute controls remain available.'});}
  }
  function bindMedia(media,channel='audio',changed) {
    const entry={media,channel:mixerChannelIds.includes(channel)?channel:'audio',changed,connected:false,source:null};mediaEntries.add(entry);
    entry.play=()=>{void enable().then(()=>{if(mediaEntries.has(entry))connectMedia(entry);}).catch(error=>publish({error:error.message}));};
    media.addEventListener?.('play',entry.play);
    if(!media.paused && media.src)entry.play();
    return {get processed(){return entry.connected;},release(){mediaEntries.delete(entry);media.removeEventListener?.('play',entry.play);entry.source?.disconnect();}};
  }
  function playbackState(id,processed=false) {
    const value=settings.channels[id] || flatChannel;
    return {volume:master.volume*(processed?1:value.volume),muted:master.muted || (!processed && channelIsMuted(settings,id))};
  }
  function effectiveVolume(id) {return master.muted || channelIsMuted(settings,id) ? 0 : master.volume*(settings.channels[id]?.volume??1);}
  function levels() {
    const read=node=>{const samples=new Float32Array(node.fftSize);if(context?.state==='running')node.getFloatTimeDomainData(samples);return pcmMeter(samples);};
    return {channels:Object.fromEntries([...strips].map(([id,value])=>[id,read(value.meter)])),master:output?read(output.meter):pcmMeter([]),record:recordBus?read(recordBus.meter):pcmMeter([])};
  }
  function trackSnapshot() {publish({tracks:[...tracks.values()].map(({id,name,media,error})=>({id,name,playing:!media.paused,time:media.currentTime||0,duration:Number.isFinite(media.duration)?media.duration:0,loop:media.loop,error}))});}
  function addFiles(files) {
    if(!registerPlayer)throw Error('The mixer playback connection is not ready.');
    const chosen=Array.from(files);
    if(chosen.length+tracks.size>8)throw Error('The board holds up to 8 local tracks. Remove a track before adding more.');
    for(const file of chosen)if(file.size>100*1024*1024 || (!file.type?.startsWith('audio/') && !/\.(wav|mp3|m4a|aac|ogg|opus|flac|webm)$/i.test(file.name)))throw Error('Choose audio files up to 100 MB each.');
    for(const file of chosen) {
      const id=trackIds.find(value=>!tracks.has(value)), url=env.URL.createObjectURL(file), media=new env.Audio(url);
      media.preload='metadata';const handle=registerPlayer(media,id);
      const entry={id,name:file.name.slice(0,200),url,media,handle,error:'',version:0};
      entry.updated=()=>trackSnapshot();entry.failed=()=>{entry.error='This audio format could not be played. Try WAV, MP3 or OGG.';trackSnapshot();};
      for(const event of ['play','pause','ended','timeupdate','loadedmetadata'])media.addEventListener(event,entry.updated);
      media.addEventListener('error',entry.failed);tracks.set(id,entry);
    }
    trackSnapshot();
  }
  async function transport(id,action,value) {
    const entry=tracks.get(id);if(!entry)return;
    const version=++entry.version;
    if(action==='play'){await enable();await entry.handle.ready;if(version!==entry.version || !tracks.has(id))return;await entry.media.play();}
    if(action==='pause')entry.media.pause();
    if(action==='rewind'){entry.media.pause();entry.media.currentTime=0;}
    if(action==='seek' && Number.isFinite(value))entry.media.currentTime=Math.max(0,Math.min(entry.media.duration||0,value));
    if(action==='loop')entry.media.loop=Boolean(value);
    trackSnapshot();
  }
  function removeTrack(id) {
    const entry=tracks.get(id);if(!entry)return;
    entry.version++;
    entry.media.pause();entry.handle.release();
    for(const event of ['play','pause','ended','timeupdate','loadedmetadata'])entry.media.removeEventListener(event,entry.updated);
    entry.media.removeEventListener('error',entry.failed);entry.media.removeAttribute('src');entry.media.load();env.URL.revokeObjectURL(entry.url);tracks.delete(id);trackSnapshot();
  }
  async function refreshInputs() {
    const devices=await env.navigator?.mediaDevices?.enumerateDevices?.();
    publish({inputs:(devices||[]).filter(device=>device.kind==='audioinput').map(device=>({id:device.deviceId,label:device.label || 'Microphone'}))});
  }
  async function startMicrophone(deviceId='') {
    if(mic || snapshot.microphone==='requesting')return;
    if(!env.navigator?.mediaDevices?.getUserMedia)throw Error('Microphone input needs the desktop app or a secure browser.');
    const version=++micVersion;publish({microphone:'requesting',monitor:false});
    let stream;
    try {
      await enable();stream=await env.navigator.mediaDevices.getUserMedia({video:false,audio:{...(deviceId?{deviceId:{exact:deviceId}}:{}),echoCancellation:true,noiseSuppression:true,autoGainControl:false}});
      if(version!==micVersion){stream.getTracks().forEach(track=>track.stop());return;}
      const source=context.createMediaStreamSource(stream), release=holdCapture();mic={stream,source,release};source.connect(strip('microphone').liveMaster);
      stream.getAudioTracks().forEach(track=>track.addEventListener('ended',stopMicrophone,{once:true}));
      publish({microphone:'on',monitor:false});void refreshInputs().catch(()=>{});
    }catch(error){stream?.getTracks().forEach(track=>track.stop());if(version!==micVersion)return;publish({microphone:'off',monitor:false});throw Error(error.name==='NotAllowedError'?'Microphone permission was denied. Allow it and try again.':error.message || 'Could not open this microphone.');}
  }
  function stopMicrophone() {
    micVersion++;const previous=mic;mic=null;
    previous?.source.disconnect();previous?.stream.getTracks().forEach(track=>track.stop());previous?.release();
    publish({microphone:'off',monitor:false});if(strips.has('microphone'))applyStrip('microphone',strips.get('microphone'));
  }
  function setMonitor(value) {publish({monitor:Boolean(mic && value)});if(strips.has('microphone'))applyStrip('microphone',strips.get('microphone'));}
  async function startRecording() {
    if(snapshot.recording!=='idle')throw Error('A mix recording is already running.');
    if(!env.MediaRecorder)throw Error('Mix recording is unavailable in this browser.');
    const version=++recordVersion;publish({recording:'starting',recordingSeconds:0,error:''});
    try {await enable();}catch(error){if(version===recordVersion)publish({recording:'idle'});throw error;}
    if(version!==recordVersion)return;
    const type=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(value=>env.MediaRecorder.isTypeSupported(value));
    if(!type){publish({recording:'idle'});throw Error('No supported mix recording format is available.');}
    const chunks=[], release=holdCapture(), start=Date.now(), current={chunks,release,start,bytes:0,discard:false,timer:null};
    try {
      recorder=new env.MediaRecorder(recordBus.destination.stream,{mimeType:type,audioBitsPerSecond:192000});recording=current;
      recorder.ondataavailable=event=>{if(!event.data?.size)return;current.bytes+=event.data.size;if(current.bytes>MIX_RECORD_LIMIT_BYTES){current.discard=true;publish({error:'The recording reached its 32 MB limit. Try a shorter mix.'});stopRecording();return;}chunks.push(event.data);publish({recordingBytes:current.bytes});};
      recorder.onstop=()=>{
        env.clearInterval(current.timer);release();if(recording!==current)return;recording=null;recorder=null;
        if(!current.discard && chunks.length){clearResult();const blob=new Blob(chunks,{type}),url=env.URL.createObjectURL(blob);publish({result:{blob,url,type,duration:Math.min(MIX_RECORD_LIMIT_MS,Date.now()-start)/1000,name:`mix-${new Date(start).toISOString().replace(/[:.]/g,'-')}.${type.includes('mp4')?'m4a':'webm'}`}});}
        publish({recording:'idle',recordingSeconds:Math.floor((Date.now()-start)/1000)});
      };
      recorder.onerror=()=>{current.discard=true;publish({error:'The recording failed. Your source tracks remain loaded.'});stopRecording();};
      recorder.start(1000);publish({recording:'recording',recordingStarted:start,recordingSeconds:0,recordingBytes:0,error:''});
      current.timer=env.setInterval(()=>{publish({recordingSeconds:Math.floor((Date.now()-start)/1000)});if(Date.now()-start>=MIX_RECORD_LIMIT_MS)stopRecording();},250);
    }catch(error){release();recording=null;recorder=null;publish({recording:'idle'});throw error;}
  }
  function stopRecording() {recordVersion++;if(snapshot.recording==='starting')publish({recording:'idle'});if(recorder && recorder.state!=='inactive'){publish({recording:'saving'});recorder.stop();}}
  function clearResult() {if(snapshot.result)env.URL.revokeObjectURL(snapshot.result.url);publish({result:null});}
  function stopAll() {for(const entry of tracks.values()){entry.version++;entry.media.pause();}stopMicrophone();stopRecording();trackSnapshot();}
  async function liveInput(id) {await enable();return {context,input:strip(id).liveMaster};}
  return {subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},getSnapshot:()=>snapshot,configure,setMaster,enable,bindMedia,playbackState,effectiveVolume,levels,liveInput,
    addFiles,transport,removeTrack,refreshInputs,startMicrophone,stopMicrophone,setMonitor,startRecording,stopRecording,clearResult,stopAll,
    connectPlayback(register,hold){registerPlayer=register;holdCapture=hold;},clearError:()=>publish({error:''})};
}
