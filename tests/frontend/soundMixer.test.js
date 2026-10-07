import {afterEach,describe,expect,it,vi} from 'vitest';
import {createSoundMixer,MIX_RECORD_LIMIT_MS} from '../../src/soundMixer';
import {createAudioOutput} from '../../src/audioOutput';
import {channelIsMuted,defaultMixerSettings,mediaMixerChannel,normalizeMixerSettings,pcmMeter} from '../../src/mixerSettings';
import {reducer} from '../../src/useStore';
import {loadPreferences,pickPreferences,savePreferences} from '../../src/preferences';
import nativeMixer from '../../electron/soundMixer';
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
function fixture() {
  const nodes=[],contexts=[],urls=[],intervals=[];
  const parameter=()=>({value:1,setTargetAtTime:vi.fn(function(value){this.value=value;})});
  const node=kind=>{const value={kind,connections:[],connect:vi.fn(function(next){this.connections.push(next);}),disconnect:vi.fn(),gain:parameter(),pan:parameter(),frequency:parameter(),Q:parameter(),threshold:parameter(),knee:parameter(),ratio:parameter(),attack:parameter(),release:parameter(),fftSize:1024,getFloatTimeDomainData:samples=>samples.fill(.25)};nodes.push(value);return value;};
  class Context {
    constructor(){this.destination=node('speaker');this.currentTime=0;this.state='suspended';contexts.push(this);}
    createGain(){return node('gain');}createBiquadFilter(){return node('eq');}createStereoPanner(){return node('pan');}createAnalyser(){return node('meter');}createDynamicsCompressor(){return node('compressor');}
    createMediaStreamDestination(){return {...node('recorder'),stream:{id:'mix-stream'}};}
    createMediaStreamSource(stream){return {...node('mic'),stream};}createMediaElementSource(){return node('player');}
    async resume(){this.state='running';}async suspend(){this.state='suspended';}async setSinkId(id){this.sinkId=id;}
  }
  class Player {
    constructor(src){this.src=src;this.volume=1;this.muted=false;this.paused=true;this.currentTime=0;this.duration=12;this.events=new Map();}
    addEventListener(type,fn){this.events.set(type,fn);}removeEventListener(type){this.events.delete(type);}
    async play(){this.paused=false;this.events.get('play')?.();}pause(){this.paused=true;this.events.get('pause')?.();}
    removeAttribute(){this.src='';}load(){}async setSinkId(){}
  }
  class Recorder {
    static isTypeSupported(type){return type.includes('webm');}
    constructor(stream){this.stream=stream;this.state='inactive';}
    start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['neutral-signal'])});this.onstop();}
  }
  const micTrack={stop:vi.fn(),addEventListener:vi.fn()},stream={getTracks:()=>[micTrack],getAudioTracks:()=>[micTrack]};
  const env={AudioContext:Context,Audio:Player,MediaRecorder:Recorder,navigator:{mediaDevices:{getUserMedia:vi.fn(async()=>stream),enumerateDevices:vi.fn(async()=>[])}},
    URL:{createObjectURL:vi.fn(()=>{const url=`blob:test-${urls.length}`;urls.push(url);return url;}),revokeObjectURL:vi.fn()},
    setInterval:fn=>{intervals.push(fn);return intervals.length;},clearInterval:vi.fn()};
  const output=createAudioOutput(env);return {mixer:output.mixer,output,env,nodes,contexts,Player,stream,micTrack,intervals};
}
describe('mixer connections and capture lifecycle',()=>{
  it('never opens an audio graph, microphone or recorder merely by configuring or enumerating inputs',async()=>{
    const {mixer,env,contexts}=fixture();mixer.configure(defaultMixerSettings);await mixer.refreshInputs();
    expect(contexts).toHaveLength(0);expect(env.navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();expect(mixer.getSnapshot()).toMatchObject({microphone:'off',recording:'idle',enabled:false});
  });
  it('routes a real player through EQ, pan and meters while applying master volume once',async()=>{
    const {mixer,output,nodes,Player}=fixture(),media=new Player('blob:local');output.configure({volume:.4});const registration=output.track(media,undefined,'speech');
    const value=normalizeMixerSettings();value.channels.speech={...value.channels.speech,volume:.5,pan:-.3,low:-4,mid:2,high:3};mixer.configure(value);
    expect(media.volume).toBe(.2);await media.play();await flush();
    expect(media.volume).toBe(.4);expect(nodes.find(node=>node.kind==='player').connections[0].connections[0]).toMatchObject({type:'lowshelf',gain:{value:-4}});
    expect(nodes.find(node=>node.kind==='pan').pan.value).toBe(-.3);
    expect(nodes.filter(node=>node.kind==='eq').map(node=>node.gain.value)).toEqual([-4,2,3]);
    expect(mixer.levels().channels.speech.rms).toBe(.25);
    registration.release();expect(nodes.find(node=>node.kind==='player').disconnect).toHaveBeenCalledOnce();
  });
  it('keeps unsafe cross-origin players audible with volume/mute without routing tainted PCM',async()=>{
    const {mixer,output,nodes,Player}=fixture(),media=new Player('https://other.example/audio.wav');
    output.track(media,undefined,'audio');const value=normalizeMixerSettings();value.channels.audio.volume=.3;mixer.configure(value);await media.play();await flush();
    expect(media.volume).toBe(.3);expect(nodes.some(node=>node.kind==='player')).toBe(false);
  });
  it('reuses a media source after rebinding without creating a second Web Audio source',async()=>{
    const {mixer,output,nodes,Player}=fixture(),media=new Player('blob:local');const first=output.track(media);await media.play();await flush();first.release();
    output.track(media);await flush();expect(nodes.filter(node=>node.kind==='player')).toHaveLength(1);expect(nodes.find(node=>node.kind==='player').connect).toHaveBeenCalledTimes(2);
  });
  it('falls back from a missing graph output and restores the preferred device after reconnect',async()=>{
    const {mixer,output,contexts,env}=fixture();env.navigator.mediaDevices.enumerateDevices=vi.fn(async()=>[]);output.configure({deviceId:'saved-headset'});await mixer.enable();await output.refresh();await flush();
    expect(contexts[0].sinkId).toBe('');expect(output.getPreferences().deviceId).toBe('saved-headset');
    output.configure({volume:.7,deviceId:'saved-headset'});await flush();expect(contexts[0].sinkId).toBe('');
    env.navigator.mediaDevices.enumerateDevices.mockResolvedValue([{kind:'audiooutput',deviceId:'saved-headset',label:'Headset'}]);await output.refresh();await flush();expect(contexts[0].sinkId).toBe('saved-headset');
  });
  it('reports failed desktop updates without throwing from app settings',async()=>{
    const env={workstationDesktop:{setSoundMix(){throw Error('offline');}}},mixer=createSoundMixer(env);expect(()=>mixer.configure(defaultMixerSettings)).not.toThrow();await flush();expect(mixer.getSnapshot().error).toContain('could not be updated');
  });
  it('keeps microphone monitoring off while connecting it to the recording bus, and releases input on disable',async()=>{
    const {mixer,env,nodes,micTrack}=fixture();await mixer.startMicrophone('mic-device');
    expect(env.navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({video:false,audio:expect.objectContaining({deviceId:{exact:'mic-device'}})});
    expect(mixer.getSnapshot()).toMatchObject({microphone:'on',monitor:false});
    const meter=nodes.filter(node=>node.kind==='meter').at(-1),monitor=meter.connections[0];expect(monitor.gain.value).toBe(0);expect(meter.connections).toHaveLength(2);
    mixer.setMonitor(true);expect(monitor.gain.value).toBe(1);mixer.stopMicrophone();expect(micTrack.stop).toHaveBeenCalledOnce();expect(monitor.gain.value).toBe(0);
  });
  it('stops a permission result that arrives after microphone cancellation',async()=>{
    const {mixer,env,stream,micTrack}=fixture();let finish;env.navigator.mediaDevices.getUserMedia.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=mixer.startMicrophone();await flush();mixer.stopMicrophone();finish(stream);await pending;
    expect(micTrack.stop).toHaveBeenCalledOnce();expect(mixer.getSnapshot().microphone).toBe('off');
  });
  it('records the processed bus, blocks test playback while capturing, and retains the finished file until clear',async()=>{
    const {mixer,output,env,intervals}=fixture();await mixer.startRecording();expect(output.getSnapshot().captureBusy).toBe(true);
    await expect(output.testSound()).rejects.toThrow('recording');mixer.stopRecording();
    const result=mixer.getSnapshot().result;expect(result.type).toContain('webm');expect(await result.blob.text()).toBe('neutral-signal');expect(output.getSnapshot().captureBusy).toBe(false);
    expect(env.clearInterval).toHaveBeenCalledWith(intervals.length);mixer.clearResult();expect(env.URL.revokeObjectURL).toHaveBeenCalledWith(result.url);
  });
  it('cancels playback and recording that are waiting for the audio engine to resume',async()=>{
    const {mixer,env}=fixture();const file=new Blob(['local'],{type:'audio/wav'});file.name='neutral.wav';mixer.addFiles([file]);
    let resume;env.AudioContext.prototype.resume=function(){return new Promise(resolve=>{resume=()=>{this.state='running';resolve();};});};
    const play=mixer.transport('track-1','play');mixer.stopAll();resume();await play;expect(mixer.getSnapshot().tracks[0].playing).toBe(false);
    const capture=mixer.startRecording();expect(mixer.getSnapshot().recording).toBe('starting');mixer.stopRecording();resume();await capture;expect(mixer.getSnapshot()).toMatchObject({recording:'idle',result:null});
  });
  it('automatically stops recordings at the bounded duration',async()=>{
    vi.useFakeTimers();const {mixer,intervals}=fixture();await mixer.startRecording();vi.setSystemTime(Date.now()+MIX_RECORD_LIMIT_MS);intervals[0]();expect(mixer.getSnapshot().recording).toBe('idle');expect(mixer.getSnapshot().result.duration).toBe(300);
  });
  it('loads local tracks without playing them, rejects excess/oversize input, and releases removed files',async()=>{
    const {mixer,env}=fixture();const file=new Blob(['local'],{type:'audio/wav'});file.name='neutral.wav';mixer.addFiles([file]);
    expect(mixer.getSnapshot().tracks[0]).toMatchObject({playing:false,name:'neutral.wav'});await mixer.transport('track-1','play');expect(mixer.getSnapshot().tracks[0].playing).toBe(true);
    mixer.stopAll();expect(mixer.getSnapshot().tracks[0].playing).toBe(false);
    expect(()=>mixer.addFiles(Array(8).fill(file))).toThrow('8 local tracks');expect(()=>mixer.addFiles([{size:101*1024*1024,name:'too-large.wav'}])).toThrow('100 MB');
    mixer.removeTrack('track-1');expect(env.URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-0');expect(mixer.getSnapshot().tracks).toEqual([]);
  });
});
describe('mixer settings and measured signal',()=>{
  it('applies solo to all other channels and lets mute take precedence',()=>{
    const settings=normalizeMixerSettings();settings.channels.audio.solo=true;settings.channels['track-1'].solo=true;
    expect(channelIsMuted(settings,'speech')).toBe(true);expect(channelIsMuted(settings,'audio')).toBe(false);settings.channels.audio.muted=true;expect(channelIsMuted(settings,'audio')).toBe(true);
  });
  it('normalizes saved settings, preserves zero, excludes arbitrary keys and round trips through preferences',()=>{
    const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};vi.stubGlobal('window',{localStorage:storage});vi.stubGlobal('localStorage',storage);
    const settings=normalizeMixerSettings({channels:{audio:{volume:0,pan:-9,low:99,mid:NaN},evil:{volume:1}}});expect(settings.channels.audio).toMatchObject({volume:0,pan:-1,low:12,mid:0});expect(settings.channels.evil).toBeUndefined();
    savePreferences(pickPreferences(reducer(loadPreferences(),{type:'SET_SOUND_MIXER',payload:settings})));expect(loadPreferences().soundMixer).toEqual(settings);
  });
  it('assigns tab players by workspace and honors an explicit generated speech channel',()=>{
    expect(mediaMixerChannel({tagName:'VIDEO'})).toBe('video');expect(mediaMixerChannel({dataset:{mixerChannel:'speech'},tagName:'AUDIO'})).toBe('speech');
    expect(mediaMixerChannel({closest:()=>({dataset:{captureTab:'integrations'}})})).toBe('integrations');
  });
  it('measures silence, finite RMS and actual clipped sample peaks',()=>{
    expect(pcmMeter(new Float32Array(12))).toEqual({peak:0,rms:0,db:-60,clipping:false});expect(pcmMeter([.5,-.5]).db).toBeCloseTo(-6.0206);expect(pcmMeter([1,-1,NaN]).clipping).toBe(true);
  });
});
describe('bounded desktop player mixer',()=>{
  const valid={volume:.8,muted:false,channels:{browser:{volume:.5,muted:false},'media-manager':{volume:1,muted:true},integrations:{volume:.3,muted:false}}};
  it('rejects invalid IPC values and strips unknown data',()=>{
    expect(()=>nativeMixer.normalizeNativeMix({...valid,volume:Infinity})).toThrow();expect(()=>nativeMixer.normalizeNativeMix({...valid,channels:{...valid.channels,browser:{volume:'bad',muted:false}}})).toThrow();
    expect(nativeMixer.normalizeNativeMix({...valid,code:'unsafe'})).toEqual(valid);
  });
  it('applies combined master/channel volume and retains mute for future desktop views',()=>{
    const controller=nativeMixer.createNativeMixer('browser'),events={},script=vi.fn(async()=>{}),wc={isDestroyed:()=>false,setAudioMuted:vi.fn(),mainFrame:{framesInSubtree:[{executeJavaScript:script}]},on:(name,fn)=>{events[name]=fn;},once:vi.fn()};
    controller.configure(valid);controller.watch(wc);expect(wc.setAudioMuted).toHaveBeenLastCalledWith(false);expect(script.mock.calls[0][0]).toMatch(/\)\(0\.4\)$/);
    controller.configure({...valid,muted:true});expect(wc.setAudioMuted).toHaveBeenLastCalledWith(true);events['did-frame-finish-load']();expect(script).toHaveBeenCalledTimes(3);
  });
});
