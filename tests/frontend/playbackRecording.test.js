import {afterEach, describe, expect, it, vi} from 'vitest';
import {createRequire} from 'node:module';
import {createPlaybackCapture, playbackAvailability, playbackCaptureError, playbackSignal} from '../../src/playbackRecording';
const require=createRequire(import.meta.url);
const {grantPlayback,revokePlayback,playbackGranted,installPlaybackCapture,playbackCaptureStatus}=require('../../electron/playbackCapture');
const {allowAudioPermission}=require('../../electron/audioPermissions');
afterEach(()=>vi.useRealTimers());

function nativeCapture({sources=[{id:'screen:0:0'}],getSpotifyFrame}={}) {
  let handler;
  const contents={getURL:()=> 'app://local/index.html',isDestroyed:()=>false,mainFrame:{url:'app://local/index.html'},
    session:{setDisplayMediaRequestHandler:value=>{handler=value;}}};
  const getSources=vi.fn(async()=>sources);
  installPlaybackCapture(contents,{getSources},null,{getSpotifyFrame});
  return {contents,getSources,request:patch=>({frame:contents.mainFrame,userGesture:true,audioRequested:true,...patch}),run:(request,callback)=>handler(request,callback)};
}

describe('desktop playback permission ordering',()=>{
  it.skipIf(process.platform!=='win32')('permits the final untyped check after one display grant, then revokes it',async()=>{
    const native=nativeCapture(),details={requestingUrl:'app://local/',isMainFrame:true};
    grantPlayback(native.contents);
    expect(allowAudioPermission(native.contents,'media',details,native.contents)).toBe(false);
    const selected=vi.fn();await native.run(native.request(),selected);
    expect(selected).toHaveBeenCalledWith({video:{id:'screen:0:0'},audio:'loopback'});
    expect(playbackGranted(native.contents)).toBe(true);
    expect(allowAudioPermission(native.contents,'media',details,native.contents)).toBe(true);
    expect(allowAudioPermission(native.contents,'media',{...details,isMainFrame:false},native.contents)).toBe(false);
    expect(allowAudioPermission(native.contents,'media',{...details,requestingUrl:'https://open.spotify.com'},native.contents)).toBe(false);
    const duplicate=vi.fn();await native.run(native.request(),duplicate);
    expect(duplicate).toHaveBeenCalledWith({});expect(native.getSources).toHaveBeenCalledTimes(1);
    revokePlayback(native.contents);expect(allowAudioPermission(native.contents,'media',details,native.contents)).toBe(false);
  });
  it.skipIf(process.platform!=='win32')('expires the opening lease and cancels a late screen enumeration',async()=>{
    vi.useFakeTimers();const native=nativeCapture();grantPlayback(native.contents);
    vi.advanceTimersByTime(15001);const expired=vi.fn();await native.run(native.request(),expired);expect(expired).toHaveBeenCalledWith({});
    let resolve;native.getSources.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
    grantPlayback(native.contents);const cancelled=vi.fn(),pending=native.run(native.request(),cancelled);
    revokePlayback(native.contents);resolve([{id:'screen:0:0'}]);await pending;expect(cancelled).toHaveBeenCalledWith({});
  });
  it.skipIf(process.platform!=='win32')('captures only the host-selected embedded player, without screen enumeration',async()=>{
    const frame={url:'https://open.spotify.com/embed/track/0123456789ABCDEFGHIJKL'};
    const native=nativeCapture({getSpotifyFrame:()=>frame});grantPlayback(native.contents,{source:'spotify'});
    const selected=vi.fn();await native.run(native.request(),selected);
    expect(selected).toHaveBeenCalledWith({video:native.contents.mainFrame,audio:frame,enableLocalEcho:true});expect(native.getSources).not.toHaveBeenCalled();
    revokePlayback(native.contents);
    const missing=nativeCapture();grantPlayback(missing.contents,{source:'spotify'});await missing.run(missing.request(),vi.fn());
    expect(playbackCaptureStatus(missing.contents).error).toContain('Open the embedded Spotify');expect(playbackGranted(missing.contents)).toBe(false);
    expect(()=>grantPlayback(missing.contents,{source:'microphone'})).toThrow('Choose Windows playback');
  });
  it('does not arm or capture when reading support',()=>{const native=nativeCapture();playbackCaptureStatus(native.contents);expect(playbackGranted(native.contents)).toBe(false);expect(native.getSources).not.toHaveBeenCalled();});
});

function recorderEnv({getDisplayMedia,signal=0,monitoring=true}={}) {
  const track=kind=>({kind,readyState:'live',stop:vi.fn(function(){this.readyState='ended';}),addEventListener:vi.fn()});
  const audio=track('audio'),video=track('video'),stream={getAudioTracks:()=>[audio],getVideoTracks:()=>[video],getTracks:()=>[audio,video]};
  let recorder;
  class Recorder {
    static isTypeSupported(){return true;}
    constructor(input){this.input=input;this.state='inactive';this.mimeType='audio/webm;codecs=opus';recorder=this;}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['neutral fixture'])});this.onstop?.();}
  }
  const analyser={fftSize:2048,getFloatTimeDomainData:buffer=>buffer.fill(signal),disconnect:vi.fn()};
  const source={connect:vi.fn(),disconnect:vi.fn()};
  class Context {createAnalyser(){return analyser;}createMediaStreamSource(){return source;}resume(){return Promise.resolve();}close(){return Promise.resolve();}}
  const env={workstationDesktop:{requestPlaybackCapture:vi.fn(async()=>({ready:true})),cancelPlaybackCapture:vi.fn(async()=>{}),playbackCaptureStatus:vi.fn(async()=>({supported:true}))},
    navigator:{mediaDevices:{getDisplayMedia:vi.fn(getDisplayMedia || (async()=>stream))}},MediaRecorder:Recorder,
    MediaStream:class {constructor(tracks){this.tracks=tracks;}getAudioTracks(){return this.tracks;}},Blob,AudioContext:monitoring?Context:undefined,
    setTimeout,clearTimeout,setInterval,clearInterval};
  return {env,stream,audio,video,recorder:()=>recorder};
}

describe('playback recording lifecycle and feedback',()=>{
  it('explains unavailable capture and actionable startup errors',()=>{
    expect(playbackAvailability({})).toContain('Windows desktop');
    expect(playbackCaptureError({name:'NotReadableError'})).toContain('Embedded Spotify player');
    expect(playbackCaptureError({name:'InvalidStateError'})).toContain('unlocked');
    expect(playbackCaptureError({name:'NotAllowedError'})).toContain('restart');
    expect(playbackSignal(new Float32Array(64)).audible).toBe(false);
    expect(playbackSignal(new Float32Array([0.1,-0.1])).rms).toBeCloseTo(.1);
  });
  it('records audio only, detects signal, and releases every track and grant',async()=>{
    vi.useFakeTimers();const fixture=recorderEnv({signal:.1}),onFile=vi.fn(),onSignal=vi.fn();
    const capture=createPlaybackCapture({source:'spotify',onFile,onSignal},fixture.env);await capture.ready;
    expect(fixture.video.stop).toHaveBeenCalled();expect(fixture.audio.stop).not.toHaveBeenCalled();
    expect(fixture.env.workstationDesktop.requestPlaybackCapture).toHaveBeenCalledWith({source:'spotify'});
    expect(fixture.recorder().input.getAudioTracks()).toEqual([fixture.audio]);
    vi.advanceTimersByTime(500);expect(onSignal.mock.lastCall[0].signalDetected).toBe(true);
    capture.stop();expect(onFile.mock.lastCall[1]).toMatchObject({signalDetected:true,signalMonitored:true,source:'spotify'});
    expect(fixture.audio.stop).toHaveBeenCalled();expect(fixture.env.workstationDesktop.cancelPlaybackCapture).toHaveBeenCalled();
  });
  it('marks silent recordings and stops at the time limit',async()=>{
    vi.useFakeTimers();const fixture=recorderEnv(),onFile=vi.fn();const capture=createPlaybackCapture({onFile,maxSeconds:1},fixture.env);
    await capture.ready;vi.advanceTimersByTime(1000);
    expect(onFile.mock.lastCall[1]).toMatchObject({signalDetected:false,signalMonitored:true,reason:'time-limit'});
    expect(fixture.audio.readyState).toBe('ended');
  });
  it('cancels a late opening without saving audio or reporting a late error',async()=>{
    let resolve;const fixture=recorderEnv({getDisplayMedia:()=>new Promise(done=>{resolve=done;})}),onFile=vi.fn(),onError=vi.fn();
    const capture=createPlaybackCapture({onFile,onError},fixture.env);
    await Promise.resolve();await Promise.resolve();capture.cancel();resolve(fixture.stream);await capture.ready;
    expect(fixture.audio.stop).toHaveBeenCalled();expect(fixture.video.stop).toHaveBeenCalled();expect(onFile).not.toHaveBeenCalled();expect(onError).not.toHaveBeenCalled();
  });
  it('discards active capture without replacing a recording',async()=>{
    const fixture=recorderEnv({monitoring:false}),onFile=vi.fn();const capture=createPlaybackCapture({onFile},fixture.env);
    await capture.ready;capture.cancel();expect(onFile).not.toHaveBeenCalled();expect(fixture.audio.stop).toHaveBeenCalled();
  });
  it('reports Windows audio failure and revokes the opening lease',async()=>{
    const fixture=recorderEnv({getDisplayMedia:async()=>{throw Object.assign(new Error('Could not start audio source'),{name:'NotReadableError'});}}),onError=vi.fn();
    await createPlaybackCapture({onError},fixture.env).ready;
    expect(onError.mock.lastCall[0]).toContain('Windows could not open');expect(fixture.env.workstationDesktop.cancelPlaybackCapture).toHaveBeenCalled();expect(fixture.recorder()).toBeUndefined();
  });
});
