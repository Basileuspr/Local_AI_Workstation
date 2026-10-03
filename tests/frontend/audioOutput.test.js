import {afterEach,describe,expect,it,vi} from 'vitest';
import {createAudioOutput,testToneBlob,audioOutput} from '../../src/audioOutput';
import {defaultSoundOutput,loadPreferences,normalizeSoundOutput,pickPreferences,savePreferences,clearPreferences} from '../../src/preferences';
import {reducer} from '../../src/useStore';
import {speakText,stopSpeech,speechStore} from '../../src/audioSpeech';
import permissions from '../../electron/audioPermissions';

afterEach(()=>{stopSpeech();audioOutput.configure(defaultSoundOutput);vi.unstubAllGlobals();});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture() {
  let devices=[{kind:'audiooutput',deviceId:'default',label:'Default - Speakers'},{kind:'audiooutput',deviceId:'speakers',label:'Speakers'},
    {kind:'audiooutput',deviceId:'headphones',label:'Headphones'},{kind:'audioinput',deviceId:'mic',label:'Microphone'}];
  const mediaDevices={enumerateDevices:vi.fn(async()=>devices),addEventListener:vi.fn(),removeEventListener:vi.fn()};
  const env={navigator:{mediaDevices},setTimeout:vi.fn(()=>9),clearTimeout:vi.fn(),URL:{createObjectURL:vi.fn(()=>'blob:tone'),revokeObjectURL:vi.fn()}};
  const output=createAudioOutput(env);
  function player() {
    const callbacks={}, media={volume:1,muted:false,sinkId:'',pause:vi.fn(),play:vi.fn(async()=>{}),load:vi.fn(),removeAttribute:vi.fn(),
      addEventListener:vi.fn((type,callback)=>{callbacks[type]=callback;}),removeEventListener:vi.fn(),
      setSinkId:vi.fn(async id=>{media.sinkId=id;})};
    media.changed=()=>callbacks.volumechange();return media;
  }
  return {env,output,player,mediaDevices,devices:value=>{devices=value;}};
}

describe('sound preferences',()=>{
  it('preserves silence, clamps volume and normalizes malformed saved devices',()=>{
    expect(normalizeSoundOutput({volume:0,muted:true,deviceId:'default',deviceLabel:'Old'})).toEqual({...defaultSoundOutput,volume:0,muted:true});
    expect(normalizeSoundOutput({volume:2})).toEqual(defaultSoundOutput);
    expect(normalizeSoundOutput({volume:-2}).volume).toBe(0);
    expect(normalizeSoundOutput({volume:'bad',deviceId:'bad\nvalue'})).toEqual(defaultSoundOutput);
    expect(normalizeSoundOutput(null)).toEqual(defaultSoundOutput);
  });
  it('saves changes through the existing settings reducer and restores after restart/reset',()=>{
    const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
    vi.stubGlobal('window',{localStorage:storage});vi.stubGlobal('localStorage',storage);
    expect(loadPreferences().soundOutput).toEqual(defaultSoundOutput);
    const chosen={volume:.37,muted:true,deviceId:'headphones',deviceLabel:'Headphones'};
    const state=reducer(loadPreferences(),{type:'SET_SOUND_OUTPUT',payload:chosen});
    savePreferences(pickPreferences(state));expect(loadPreferences().soundOutput).toEqual(chosen);
    clearPreferences();expect(reducer(state,{type:'RESET_PREFERENCES'}).soundOutput).toEqual(defaultSoundOutput);
  });
});
describe('real playback routing',()=>{
  it('applies volume, mute and selected output to current and newly created players',async()=>{
    const {output,player}=fixture(), first=player();await output.track(first).ready;
    output.configure({volume:.32,muted:true,deviceId:'headphones',deviceLabel:'Headphones'});
    await output.ready(first);const second=player();await output.track(second).ready;
    for(const media of [first,second])expect(media).toMatchObject({volume:.32,muted:true,sinkId:'headphones'});
    output.configure({volume:.62,muted:false,deviceId:''});await output.ready(first);
    expect(first).toMatchObject({volume:.62,muted:false,sinkId:''});
  });
  it('sends native player volume/mute changes back to shared settings without a feedback loop',async()=>{
    const {output,player}=fixture(), media=player(), update=vi.fn();await output.track(media,update).ready;
    output.configure({volume:.4,muted:false});media.changed();expect(update).not.toHaveBeenCalled();
    media.volume=.2;media.muted=true;media.changed();expect(update).toHaveBeenCalledWith({volume:.2,muted:true});
  });
  it('keeps the last device selection after asynchronous switches finish out of order',async()=>{
    const {output,player}=fixture(), media=player();await output.track(media).ready;
    let finish;media.setSinkId.mockImplementationOnce(id=>new Promise(resolve=>{finish=()=>{media.sinkId=id;resolve();};}));
    output.configure({deviceId:'speakers'});await flush();
    output.configure({deviceId:'headphones'});output.configure({deviceId:'speakers',volume:.25});
    finish();await output.ready(media);expect(media).toMatchObject({sinkId:'speakers',volume:.25});
  });
  it('falls back on disconnect and restores a preferred device when it reconnects',async()=>{
    const {output,player,devices}=fixture(), media=player();await output.track(media).ready;
    output.configure({deviceId:'headphones',deviceLabel:'Headphones'});await output.refresh();await output.ready(media);
    expect(output.getSnapshot().devices).toHaveLength(3);
    devices([{kind:'audiooutput',deviceId:'default',label:'Default - Speakers'}]);await output.refresh();await output.ready(media);
    expect(media.sinkId).toBe('');expect(output.getPreferences().deviceId).toBe('headphones');
    devices([{kind:'audiooutput',deviceId:'headphones',label:'Headphones'}]);await output.refresh();await output.ready(media);
    expect(media.sinkId).toBe('headphones');
  });
  it('reports denied routing and explicitly returns the player to system default',async()=>{
    const {output,player}=fixture(), media=player();await output.track(media).ready;
    media.setSinkId.mockRejectedValueOnce(Object.assign(new Error('denied'),{name:'NotAllowedError'}));
    output.configure({deviceId:'headphones'});await output.ready(media);
    expect(media.setSinkId).toHaveBeenLastCalledWith('');expect(output.getSnapshot().routeError).toContain('Permission');
    output.configure({deviceId:''});await output.ready(media);expect(output.getSnapshot().routeError).toBe('');
  });
  it('does not claim output routing works in a player without setSinkId',async()=>{
    const {output,player}=fixture(), media=player();delete media.setSinkId;
    output.configure({deviceId:'headphones'});await output.track(media).ready;
    expect(output.getSnapshot().routeError).toContain('unavailable');
  });
  it('shares registrations and stops touching a released player',async()=>{
    const {output,player}=fixture(), media=player(), first=output.track(media), second=output.track(media);
    await first.ready;first.release();output.configure({volume:.3});expect(media.volume).toBe(.3);
    second.release();output.configure({volume:.8});expect(media.volume).toBe(.3);
    expect(media.removeEventListener).toHaveBeenCalledOnce();
  });
  it('listens for device changes and removes its listener during cleanup',async()=>{
    const {output,mediaDevices}=fixture();const stop=output.listen();await output.refresh();
    mediaDevices.addEventListener.mock.calls[0][1]();await output.refresh();expect(mediaDevices.enumerateDevices).toHaveBeenCalledTimes(2);
    stop();expect(mediaDevices.removeEventListener).toHaveBeenCalledWith('devicechange',expect.any(Function));
  });
  it('never records to discover outputs or play a test sound',async()=>{
    const {output,env,player,mediaDevices}=fixture(), media=player();env.Audio=vi.fn(function(){return media;});
    await output.refresh();await output.testSound();expect(media.play).toHaveBeenCalledOnce();
    output.stopTest();expect(env.URL.revokeObjectURL).toHaveBeenCalledWith('blob:tone');expect(media.pause).toHaveBeenCalled();
    expect(mediaDevices.getUserMedia).toBeUndefined();
    output.configure({volume:0});await expect(output.testSound()).rejects.toThrow('raise the volume');
  });
  it('requests browser output permission directly and retains the chosen device',async()=>{
    const {output,mediaDevices}=fixture();mediaDevices.selectAudioOutput=vi.fn(async()=>({deviceId:'new',label:'New headset'}));
    expect(await output.choose()).toEqual({deviceId:'new',deviceLabel:'New headset'});
    expect(output.getSnapshot().devices).toContainEqual({deviceId:'new',label:'New headset'});
  });
  it('blocks test playback across workspaces until every active audio capture is released',async()=>{
    const {output,env,player}=fixture();env.Audio=vi.fn(function(){return player();});
    const first=output.holdCapture(),second=output.holdCapture();
    first();await expect(output.testSound()).rejects.toThrow('recording or processing');expect(env.Audio).not.toHaveBeenCalled();
    second();expect(output.getSnapshot().captureBusy).toBe(false);await output.testSound();output.stopTest();
  });
  it('creates a bounded local WAV with a valid audio header',async()=>{
    const data=await testToneBlob().arrayBuffer(),view=new DataView(data);
    expect(new TextDecoder().decode(data.slice(0,4))).toBe('RIFF');expect(data.byteLength).toBe(48044);
    expect(view.getUint32(24,true)).toBe(24000);expect(view.getInt16(44+200,true)).not.toBe(0);
  });
});
it('uses the shared volume for installed voices and stops current speech on mute',()=>{
  const synth={getVoices:()=>[{voiceURI:'local',lang:'en-US',localService:true}],cancel:vi.fn(),speak:vi.fn()};
  vi.stubGlobal('speechSynthesis',synth);vi.stubGlobal('SpeechSynthesisUtterance',class {constructor(text){this.text=text;}});
  audioOutput.configure({volume:.27});speakText('Neutral example','output-test');
  expect(synth.speak.mock.calls[0][0].volume).toBe(.27);
  audioOutput.configure({volume:.27,muted:true});expect(speechStore.getSnapshot().status).toBe('idle');
});
it('allows speaker selection only in the trusted app main frame',()=>{
  const contents={getURL:()=> 'app://local/index.html'},details={requestingUrl:'app://local/index.html',isMainFrame:true};
  expect(permissions.allowAudioPermission(contents,'speaker-selection',details,contents)).toBe(true);
  expect(permissions.allowAudioPermission(contents,'speaker-selection',{...details,isMainFrame:false},contents)).toBe(false);
  expect(permissions.allowAudioPermission(contents,'speaker-selection',{...details,requestingUrl:'https://open.spotify.com'},contents)).toBe(false);
  expect(permissions.allowAudioPermission({getURL:contents.getURL},'speaker-selection',details,contents)).toBe(false);
});
