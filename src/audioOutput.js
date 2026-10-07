import {defaultSoundOutput, normalizeSoundOutput} from './preferences';
import {createSoundMixer} from './soundMixer';
import {mediaMixerChannel} from './mixerSettings';

const outputError = (error, action = 'use this output') => error?.name === 'NotAllowedError'
  ? `Permission to ${action} was denied. Choose an output device again, or use System default.`
  : error?.name === 'NotFoundError' ? 'The selected output device is no longer available. Using System default.'
  : `Could not ${action}. Refresh devices or use System default.`;

// A local, one-second tone. Creating this file never opens a microphone.
export function testToneBlob() {
  const rate=24000, count=rate, data=new ArrayBuffer(44+count*2), view=new DataView(data);
  const word=(offset,text)=>[...text].forEach((char,index)=>view.setUint8(offset+index,char.charCodeAt(0)));
  word(0,'RIFF');view.setUint32(4,36+count*2,true);word(8,'WAVE');word(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
  word(36,'data');view.setUint32(40,count*2,true);
  for(let i=0;i<count;i++) {
    const envelope=Math.min(1,i/(rate*.03),(count-i)/(rate*.08));
    view.setInt16(44+i*2,Math.round(Math.sin(i*2*Math.PI*440/rate)*.12*envelope*32767),true);
  }
  return new Blob([data],{type:'audio/wav'});
}

export function createAudioOutput(env = globalThis) {
  const mixer=createSoundMixer(env);
  const listeners=new Set(), players=new Map(), captures=new Set();
  let preferences={...defaultSoundOutput}, refreshOperation=null, deviceListener=null, test=null;
  let snapshot={devices:[],loaded:false,refreshing:false,error:'',routeError:'',testing:false,captureBusy:false};
  const publish=patch=>{snapshot={...snapshot,...patch};listeners.forEach(listener=>listener());};
  const routeStatus=()=>publish({routeError:[...players.values()].find(entry=>entry.error)?.error || ''});
  const missing=()=>Boolean(snapshot.loaded && preferences.deviceId && !snapshot.devices.some(device=>device.deviceId===preferences.deviceId));

  function apply(entry) {
    const chosen=preferences, version=++entry.version;
    const playback=mixer.playbackState(entry.channel,entry.mixer?.processed);
    entry.media.volume=playback.volume;entry.media.muted=playback.muted;
    entry.ready=entry.ready.catch(()=>{}).then(async()=>{
      if(!entry.active || version!==entry.version)return;
      const sink=missing() ? '' : chosen.deviceId;
      entry.error='';
      if(typeof entry.media.setSinkId!=='function') {
        if(sink)entry.error='Output selection is unavailable in this player. Using System default.';
        routeStatus();return;
      }
      try {
        if(entry.media.sinkId!==sink)await entry.media.setSinkId(sink);
      } catch(error) {
        if(!entry.active || version!==entry.version)return;
        entry.error=outputError(error)+(error?.name==='NotFoundError'?'':' Using System default.');
        try {await entry.media.setSinkId('');}
        catch {entry.media.pause?.();entry.error+=' Playback stopped because System default could not be opened.';}
      }
      if(entry.active && version===entry.version)routeStatus();
    });
    return entry.ready;
  }
  function track(media, onVolume, channel=mediaMixerChannel(media)) {
    let entry=players.get(media);
    if(!entry) {
      entry={media,channel,active:true,version:0,ready:Promise.resolve(),error:'',users:0,onVolume:new Set()};
      entry.changed=()=>{
        const expected=mixer.playbackState(entry.channel,entry.mixer?.processed);
        if(entry.active && (media.volume!==expected.volume || media.muted!==expected.muted)) {
          const channelVolume=entry.mixer?.processed ? 1 : mixer.getSnapshot().settings.channels[entry.channel]?.volume ?? 1;
          entry.onVolume.forEach(listener=>listener({volume:channelVolume>0?Math.min(1,media.volume/channelVolume):preferences.volume,muted:media.muted}));
        }
      };
      media.addEventListener?.('volumechange',entry.changed);players.set(media,entry);
      entry.mixer=mixer.bindMedia(media,channel,()=>{if(entry.active)void apply(entry);});void apply(entry);
    }
    entry.users++;if(onVolume)entry.onVolume.add(onVolume);
    let released=false;
    return {ready:entry.ready,release(){
      if(released)return;released=true;if(onVolume)entry.onVolume.delete(onVolume);
      if(--entry.users>0)return;
      entry.active=false;entry.version++;entry.mixer.release();media.removeEventListener?.('volumechange',entry.changed);players.delete(media);routeStatus();
    }};
  }
  function configure(value) {
    const next=normalizeSoundOutput(value);
    if(Object.keys(next).every(key=>next[key]===preferences[key]))return;
    preferences=next;mixer.setMaster({...next,deviceId:missing()?'':next.deviceId});for(const entry of players.values())void apply(entry);
    publish({});
  }
  async function refresh() {
    if(refreshOperation)return refreshOperation;
    const devices=env.navigator?.mediaDevices;
    if(!devices?.enumerateDevices){publish({error:'Audio devices are unavailable here. Use the desktop app or a secure browser connection.'});return;}
    publish({refreshing:true,error:''});
    refreshOperation=(async()=>{
      try {
        const outputs=(await devices.enumerateDevices()).filter(device=>device.kind==='audiooutput' && device.deviceId)
          .map(device=>({deviceId:device.deviceId,label:device.label || (device.deviceId==='default' ? 'System default' : 'Output device')}));
        publish({devices:outputs,loaded:true});
        mixer.setMaster({...preferences,deviceId:missing()?'':preferences.deviceId});
        for(const entry of players.values())void apply(entry);
      } catch(error) {publish({error:outputError(error,'list output devices')});}
      finally {refreshOperation=null;publish({refreshing:false});}
    })();
    return refreshOperation;
  }
  function listen() {
    const devices=env.navigator?.mediaDevices;
    if(!deviceListener && devices?.addEventListener) {
      deviceListener=()=>{if(refreshOperation)void refreshOperation.then(()=>refresh());else void refresh();};devices.addEventListener('devicechange',deviceListener);
    }
    void refresh();
    return ()=>{if(deviceListener){devices?.removeEventListener?.('devicechange',deviceListener);deviceListener=null;}};
  }
  async function choose() {
    // Call directly from the click, before any await, to retain user activation.
    if(!env.navigator?.mediaDevices?.selectAudioOutput)throw Error('This browser cannot open an output picker. Use the available device list or Windows Sound settings.');
    const device=await env.navigator.mediaDevices.selectAudioOutput({deviceId:preferences.deviceId});
    await refresh();
    // Some browsers enumerate the newly authorized device only on the next event.
    if(!snapshot.devices.some(output=>output.deviceId===device.deviceId))
      publish({devices:[...snapshot.devices,{deviceId:device.deviceId,label:device.label || 'Chosen output device'}]});
    return {deviceId:device.deviceId==='default'?'':device.deviceId,deviceLabel:device.label || 'Chosen output device'};
  }
  function bindDocument(document, onVolume) {
    const tracked=new Map();
    function add(media) {
      // Camera previews deliberately mute their live feed; leave those alone.
      if(tracked.has(media) || (media.autoplay && media.muted))return;
      tracked.set(media,track(media,onVolume));
    }
    function scan() {
      document.querySelectorAll('audio,video').forEach(add);
      for(const [media,handle] of tracked)if(!media.isConnected){handle.release();tracked.delete(media);}
    }
    scan();const observer=env.MutationObserver ? new env.MutationObserver(scan) : null;
    observer?.observe(document.documentElement,{childList:true,subtree:true});
    return ()=>{observer?.disconnect();for(const handle of tracked.values())handle.release();};
  }
  function stopTest() {
    if(!test)return;
    const previous=test;test=null;env.clearTimeout(previous.timer);
    previous.media.onended=null;previous.media.onerror=null;previous.media.pause();previous.handle.release();
    previous.media.removeAttribute?.('src');previous.media.load?.();env.URL.revokeObjectURL(previous.url);publish({testing:false});
  }
  async function testSound() {
    stopTest();
    if(captures.size)throw Error('Wait until audio recording or processing finishes before playing a test sound.');
    if(preferences.muted || preferences.volume===0)throw Error('Unmute playback and raise the volume before testing the output.');
    const url=env.URL.createObjectURL(testToneBlob()), media=new env.Audio(url), handle=track(media,undefined,'alerts');
    const current={url,media,handle};test=current;publish({testing:true,error:''});
    media.onended=()=>{if(test===current)stopTest();};
    media.onerror=()=>{if(test===current){stopTest();publish({error:'The test sound could not be played. Refresh devices or choose System default.'});}};
    current.timer=env.setTimeout(()=>{if(test===current)stopTest();},4000);
    try {await handle.ready;if(test===current)await media.play();}
    catch(error){if(test===current){stopTest();throw Error(outputError(error,'play the test sound'));}}
  }
  function holdCapture() {
    const token={};captures.add(token);stopTest();publish({captureBusy:true});
    return ()=>{captures.delete(token);publish({captureBusy:captures.size>0});};
  }
  mixer.connectPlayback((media,channel)=>track(media,undefined,channel),holdCapture);
  return {mixer,subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},getSnapshot:()=>snapshot,
    getPreferences:()=>preferences,configure,track,refresh,listen,choose,bindDocument,testSound,stopTest,holdCapture,
    ready:media=>players.get(media)?.ready || Promise.resolve()};
}

export const audioOutput=createAudioOutput();
