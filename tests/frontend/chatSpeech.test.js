import {afterEach, describe, expect, it, vi} from 'vitest';
import {createChatSpeech, chatSpeechOwner, speechResponseText} from '../../src/chatSpeech';
import {defaultVoiceOutput, loadPreferences, normalizeVoiceOutput, pickPreferences, savePreferences} from '../../src/preferences';
import {reducer} from '../../src/useStore';

const preferences = {...defaultVoiceOutput,referenceId:'a'.repeat(64),referenceName:'Reference.wav',referenceText:'A reference.'};
const reply = {id:'reply',role:'assistant',content:'**Hello** there.'};
const controllers = [];
afterEach(() => {controllers.splice(0).forEach(controller => controller.stop());vi.unstubAllGlobals();});
function fixture(overrides = {}) {
  const player = {play:vi.fn(async () => {}),pause:vi.fn(),removeAttribute:vi.fn(),load:vi.fn()};
  const deps = {generate:vi.fn(async () => ({blob:new Blob(['wave']),processing:{warnings:[]}})),
    reference:vi.fn(async () => new File(['voice'],'Reference.wav')),cancel:vi.fn(async () => ({})),
    audio:vi.fn(() => player),createUrl:vi.fn(() => 'blob:result'),revokeUrl:vi.fn(),stopSystem:vi.fn(),...overrides};
  const controller = createChatSpeech(deps); controllers.push(controller);
  controller.configure({sessionId:'session',active:true,preferences});
  return {controller,deps,player};
}
const request = {text:reply.content,owner:chatSpeechOwner('session',reply.id),preferences};
const flush = async () => {for (let i=0;i<8;i++) await Promise.resolve();};

it('speaks the completed text with the chosen existing voice API and plays its WAV',async () => {
  const {controller,deps,player} = fixture();
  await controller.speak(request);
  expect(deps.generate).toHaveBeenCalledWith(expect.objectContaining({text:'Hello there.',engine:'chatterbox-turbo',referenceText:'A reference.',requestId:expect.any(String),signal:expect.any(AbortSignal)}));
  expect(player.play).toHaveBeenCalledOnce();expect(controller.getSnapshot().status).toBe('playing');
  controller.stop();expect(player.pause).toHaveBeenCalled();expect(deps.revokeUrl).toHaveBeenCalledWith('blob:result');
  expect(controller.getSnapshot().status).toBe('idle');
});
it('releases generated audio when playback ends',async () => {
  const {controller,deps,player} = fixture();await controller.speak(request);player.onended();
  expect(controller.getSnapshot().owner).toBeNull();expect(deps.revokeUrl).toHaveBeenCalledOnce();
});
it('does not generate speech when automatic output is disabled or a reply is incomplete',async () => {
  const {controller,deps} = fixture();
  controller.completed({message:reply,sessionId:'session',preferences});
  controller.completed({message:reply,sessionId:'session',preferences:{...preferences,autoSpeak:true},completed:false});
  await flush();expect(deps.generate).not.toHaveBeenCalled();
});
it('automatically speaks only newly completed assistant output in the active source chat',async () => {
  const {controller,deps,player} = fixture(), automatic = {...preferences,autoSpeak:true};
  controller.completed({message:reply,sessionId:'other',preferences:automatic});
  controller.completed({message:{...reply,role:'user'},sessionId:'session',preferences:automatic});
  expect(deps.generate).not.toHaveBeenCalled();
  controller.completed({message:reply,sessionId:'session',preferences:automatic});await flush();
  expect(deps.generate).toHaveBeenCalledOnce();expect(player.play).toHaveBeenCalledOnce();
});
it('Stop aborts generation and discards a late result without playing it',async () => {
  let resolve;const generate = vi.fn(() => new Promise(done => {resolve=done;}));
  const {controller,deps,player} = fixture({generate});const pending=controller.speak(request);await flush();
  const signal=generate.mock.calls[0][0].signal;controller.stop(request.owner);
  expect(signal.aborted).toBe(true);expect(deps.cancel).toHaveBeenCalledWith(generate.mock.calls[0][0].requestId);
  resolve({blob:new Blob(['late'])});await pending;
  expect(player.play).not.toHaveBeenCalled();expect(deps.createUrl).not.toHaveBeenCalled();expect(controller.getSnapshot().status).toBe('idle');
});
it('stopping while a saved reference loads prevents a synthesis request',async () => {
  let resolve;const {controller,deps} = fixture({reference:() => new Promise(done => {resolve=done;})});
  const pending=controller.speak(request);controller.stop();resolve(new File(['voice'],'Reference.wav'));await pending;
  expect(deps.generate).not.toHaveBeenCalled();expect(deps.cancel).not.toHaveBeenCalled();
});
it('a later Speak owns playback even when the earlier request finishes late',async () => {
  let resolve;let calls=0;
  const {controller,player} = fixture({generate:() => ++calls===1 ? new Promise(done => {resolve=done;}) : Promise.resolve({blob:new Blob(['new'])})});
  const first=controller.speak(request);await flush();await controller.speak({...request,owner:'second',text:'Second response'});
  resolve({blob:new Blob(['late'])});await first;expect(player.play).toHaveBeenCalledOnce();expect(controller.getSnapshot().owner).toBe('second');
});
it.each(['reference','generation','playback'])('reports a %s error without modifying chat text or retrying',async kind => {
  const error=new Error('Useful error'), overrides = kind==='reference' ? {reference:vi.fn(async()=>{throw error;})} : kind==='generation' ? {generate:vi.fn(async()=>{throw error;})} : {audio:() => ({play:async()=>{throw error;},pause:vi.fn()})};
  const {controller,deps} = fixture(overrides);const before={...reply};await controller.speak(request);
  expect(controller.getSnapshot()).toMatchObject({status:'idle',error:'Useful error'});expect(reply).toEqual(before);
  expect(deps.generate.mock.calls.length).toBeLessThanOrEqual(1);
});
it('a media decoding failure releases the audio and leaves Speak available',async () => {
  const {controller,player,deps}=fixture();await controller.speak(request);player.onerror();
  expect(controller.getSnapshot().error).toMatch('could not be played');expect(deps.revokeUrl).toHaveBeenCalledOnce();
});
it.each([
  [{...preferences,referenceId:''},'Choose a cloned voice'],
  [{...preferences,engine:'qwen3-tts',referenceText:''},'reference transcript'],
])('rejects unavailable voice configuration before making a request',async(settings,error) => {
  const {controller,deps}=fixture();await controller.speak({...request,preferences:settings});
  expect(controller.getSnapshot().error).toContain(error);expect(deps.generate).not.toHaveBeenCalled();
});
it('rejects oversized replies without silently truncating or chunking them',async()=>{
  const {controller,deps}=fixture();await controller.speak({...request,text:'x'.repeat(1501)});
  expect(controller.getSnapshot().error).toContain('1,500');expect(deps.generate).not.toHaveBeenCalled();
});
it.each(['navigation','voice change','disable automatic'])('cancels active speech after %s',async change => {
  const automatic={...preferences,autoSpeak:true}, {controller,player}=fixture();
  controller.configure({sessionId:'session',active:true,preferences:automatic});
  await controller.speak({...request,preferences:automatic,automatic:true});
  controller.configure({sessionId:'session',active:change!=='navigation',preferences:change==='voice change'?{...automatic,referenceId:'b'.repeat(64)}:change==='disable automatic'?preferences:automatic});
  expect(player.pause).toHaveBeenCalled();expect(controller.getSnapshot().status).toBe('idle');
});
it('does not interrupt manual playback just because automatic speech is disabled',async()=>{
  const {controller,player}=fixture();await controller.speak(request);
  controller.configure({sessionId:'session',active:true,preferences});expect(player.pause).not.toHaveBeenCalled();
});
describe('existing preference persistence',()=>{
  it('defaults automatic speech off and restores a disabled setting and selected voice after restart',()=>{
    const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
    vi.stubGlobal('window',{localStorage:storage});vi.stubGlobal('localStorage',storage);
    expect(loadPreferences().voiceOutput.autoSpeak).toBe(false);
    const state=reducer({...loadPreferences(),voiceOutput:{...preferences,autoSpeak:true}},{type:'SET_VOICE_OUTPUT',payload:{autoSpeak:false}});
    savePreferences(pickPreferences(state));expect(loadPreferences().voiceOutput).toEqual(preferences);
    expect(JSON.stringify(pickPreferences(state))).not.toContain('base64');
  });
  it('rejects arbitrary reference paths and non-boolean automatic settings',()=>{
    expect(normalizeVoiceOutput({autoSpeak:'true',referenceId:'../../voice.wav',engine:'shell',language:'French'})).toEqual(defaultVoiceOutput);
  });
});
it('removes presentation markup while preserving its spoken words',()=>{
  expect(speechResponseText('# Greeting\n**Hello** [world](https://example.com)\n```text\nExample\n```')).toBe('Greeting\nHello world\n\nExample');
});
