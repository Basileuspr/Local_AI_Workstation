import {afterEach, describe, expect, it, vi} from 'vitest';
import {createAudioCapture, validateAudio, AUDIO_MAX_BYTES, formatAudioTranscript, renameAudioSpeakers, transcribeAudio} from '../../src/audio';
import {localVoices, speechChunks, speakText, speechStore, stopSpeech} from '../../src/audioSpeech';
import permissions from '../../electron/audioPermissions';

afterEach(() => {stopSpeech(); vi.unstubAllGlobals();});
function captureEnv(getUserMedia) {
  const track = {stop:vi.fn()}, stream = {getTracks:()=>[track], getAudioTracks:()=>[track]};
  let instance;
  class Recorder {
    static isTypeSupported() {return true;}
    constructor() {instance = this; this.state='inactive'; this.mimeType='audio/webm';}
    start() {this.state='recording';}
    stop() {this.state='inactive'; this.ondataavailable({data:new Blob(['audio'])}); this.onstop();}
  }
  return {track, stream, recorder:()=>instance, env:{navigator:{mediaDevices:{getUserMedia:getUserMedia || vi.fn(async()=>stream)}}, MediaRecorder:Recorder, File, setTimeout:vi.fn(), clearTimeout:vi.fn()}};
}
it('validates nonempty audio and bounded uploads', () => {
  expect(validateAudio({name:'VOICE.MP3',size:3})).toBe('');
  expect(validateAudio({name:'voice.wav',size:0})).toMatch('nonempty');
  expect(validateAudio({name:'voice.wav',size:AUDIO_MAX_BYTES+1})).toMatch('250 MB');
  expect(validateAudio({name:'Meeting recording.m4a',size:32123542})).toBe('');
  expect(validateAudio({name:'voice.exe',size:3})).toMatch('Choose');
});
it('formats speaker turns for the same copy, save and chat insertion text',()=>{
  const text=formatAudioTranscript({diarized:true,segments:[{start:3661.2,end:3663,speaker:'Speaker 1',text:'Hello.'},{start:3664,end:3665,speaker:'Speaker 2',text:'Hi.'}]});
  expect(text).toBe('[01:01:01 – 01:01:03] Speaker 1\nHello.\n\n[01:01:04 – 01:01:05] Speaker 2\nHi.');
  expect(formatAudioTranscript({text:'Plain',speaker_error:'failed'})).toBe('Plain');
});
it('renaming labels preserves manually edited transcript content',()=>{
  const text='[00:00:01 – 00:00:03] Speaker 1\nSpeaker 1 said hello. My correction.\n\n[00:00:03 – 00:00:05] Speaker 2\nReply';
  expect(renameAudioSpeakers(text,{'Speaker 1':'Alex','Speaker 2':'Sam'})).toBe('[00:00:01 – 00:00:03] Alex\nSpeaker 1 said hello. My correction.\n\n[00:00:03 – 00:00:05] Sam\nReply');
});
it('uploads a requested speaker count along with the audio',async()=>{
  const fetch=vi.fn(async()=>({ok:true,json:async()=>({text:'ok'})}));vi.stubGlobal('fetch',fetch);
  await transcribeAudio(new File(['audio'],'voice.m4a'),'auto',{diarize:true,numSpeakers:3,modelSize:'small'});
  const body=fetch.mock.calls[0][1].body;
  expect(body.get('diarize')).toBe('true');expect(body.get('num_speakers')).toBe('3');expect(body.get('file').name).toBe('voice.m4a');
  expect(body.get('model_size')).toBe('small');
  expect(body.get('acceleration')).toBe('auto');expect(body.get('cpu_assistance')).toBe('auto');
});
it('releases a microphone granted after cancellation without recording', async () => {
  let resolve;
  const test = captureEnv(() => new Promise(done => {resolve=done;}));
  const onFile = vi.fn(), onRecording = vi.fn();
  const capture = createAudioCapture({onFile,onRecording,onError:vi.fn()},test.env);
  await Promise.resolve(); capture.cancel(); resolve(test.stream); await capture.ready;
  expect(test.track.stop).toHaveBeenCalled(); expect(test.recorder()).toBeUndefined(); expect(onFile).not.toHaveBeenCalled();
});
it('stops recording, releases tracks, and returns a file for review', async () => {
  const test = captureEnv(), onFile = vi.fn(), onRecording=vi.fn();
  const capture = createAudioCapture({onFile,onRecording,onError:vi.fn()},test.env);
  await capture.ready; expect(onRecording).toHaveBeenCalledWith(true);
  expect(test.env.setTimeout.mock.calls[0][1]).toBe(600000);
  capture.stop(); expect(test.track.stop).toHaveBeenCalled(); expect(onFile.mock.calls[0][0].name).toBe('Recording.webm');
});
it('automatically stops a short voice reference and produces reusable audio', async () => {
  const test = captureEnv(), onFile = vi.fn();
  await createAudioCapture({maxSeconds:20,onFile,onRecording:vi.fn(),onError:vi.fn()},test.env).ready;
  const [stop,delay] = test.env.setTimeout.mock.calls[0];
  expect(delay).toBe(20000); stop();
  expect(test.track.stop).toHaveBeenCalled(); expect(onFile).toHaveBeenCalledOnce();
  expect(onFile.mock.calls[0][0].size).toBeGreaterThan(0);
});
it('discard never supplies audio for transcription', async () => {
  const test = captureEnv(), onFile=vi.fn();
  const capture=createAudioCapture({onFile,onRecording:vi.fn(),onError:vi.fn()},test.env);
  await capture.ready; capture.cancel(); expect(onFile).not.toHaveBeenCalled(); expect(test.track.stop).toHaveBeenCalled();
});
it('reports denied permission', async () => {
  const test=captureEnv(async()=>{throw Object.assign(new Error('denied'),{name:'NotAllowedError'});}), onError=vi.fn();
  await createAudioCapture({onFile:vi.fn(),onRecording:vi.fn(),onError},test.env).ready;
  expect(onError.mock.calls[0][0]).toMatch('denied');
});
it('uses only local voices and invalidates callbacks when stopped', () => {
  const synth={getVoices:()=>[{voiceURI:'remote',localService:false},{voiceURI:'local',lang:'en-US',localService:true}],cancel:vi.fn(),speak:vi.fn()};
  vi.stubGlobal('speechSynthesis',synth); vi.stubGlobal('SpeechSynthesisUtterance',class {constructor(text){this.text=text;}});
  expect(localVoices()).toHaveLength(1); speakText('Hello '.repeat(100),'test',{voice:'remote',rate:1});
  const first=synth.speak.mock.calls[0][0]; expect(first.voice.voiceURI).toBe('local');
  stopSpeech(); first.onend(); expect(synth.speak).toHaveBeenCalledTimes(1);
});
it('reports absent local voices without falling back to a cloud voice', () => {
  const speak=vi.fn();vi.stubGlobal('speechSynthesis',{getVoices:()=>[{localService:false}],cancel:vi.fn(),speak});
  speakText('Hello','test'); expect(speak).not.toHaveBeenCalled(); expect(speechStore.getSnapshot().error).toMatch('No local voice');
});
it('preserves all non-whitespace text when chunking long passages',()=>{
  const text='A'.repeat(500)+'\nAnother sentence. '.repeat(40);
  expect(speechChunks(text).join('').replace(/\s/g,'')).toBe(text.replace(/\s/g,''));
  expect(speechChunks(text).every(chunk=>chunk.length<=221)).toBe(true);
});
describe('desktop microphone permissions',()=>{
  const main={getURL:()=> 'app://local/index.html'};
  it('allows audio only in the trusted main renderer',()=>{
    expect(permissions.allowAudioPermission(main,'media',{requestingUrl:'app://local/index.html',mediaTypes:['audio'],isMainFrame:true},main)).toBe(true);
    expect(permissions.allowAudioPermission(main,'media',{securityOrigin:'app://local',mediaType:'audio'},main)).toBe(true);
    for(const details of [{requestingUrl:'https://example.com',mediaTypes:['audio']},{requestingUrl:'app://local',mediaTypes:['video']},{requestingUrl:'app://local',mediaTypes:['audio','video']},{requestingUrl:'app://local',mediaTypes:['audio'],isMainFrame:false}]) expect(permissions.allowAudioPermission(main,'media',details,main)).toBe(false);
    expect(permissions.allowAudioPermission({getURL:main.getURL},'media',{requestingUrl:'app://local',mediaTypes:['audio']},main)).toBe(false);
  });
});
