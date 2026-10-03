import {audioOutput} from './audioOutput';
const listeners = new Set();
const stoppers = new Set();
export function registerSpeechStopper(stop) {stoppers.add(stop); return () => stoppers.delete(stop);}
let snapshot = {owner:null, status:'idle', error:''}, generation = 0;
const publish = value => { snapshot = value; listeners.forEach(fn => fn()); };
export const speechStore = {subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, getSnapshot:() => snapshot};
export const localVoices = () => globalThis.speechSynthesis?.getVoices().filter(voice => voice.localService) || [];
export function voicePreferences() {
  try { const value = JSON.parse(localStorage.getItem('law-audio-voice-v1')) || {}; return {voice:value.voice || '', rate:Math.min(2, Math.max(0.5, Number(value.rate) || 1))}; }
  catch { return {voice:'', rate:1}; }
}
export function saveVoicePreferences(value) { try { localStorage.setItem('law-audio-voice-v1', JSON.stringify(value)); } catch { /* Session-only settings still work. */ } }
export function speechChunks(text) {
  return String(text).trim().match(/.{1,220}(?:\s|$)|.{1,220}/gs)?.map(chunk => chunk.trim()).filter(Boolean) || [];
}
export function stopSpeech(owner) {
  stoppers.forEach(stop => stop(owner));
  if (owner && snapshot.owner !== owner) return;
  generation++; globalThis.speechSynthesis?.cancel(); publish({owner:null, status:'idle', error:''});
}
audioOutput.subscribe(()=>{
  const output=audioOutput.getPreferences();
  if(snapshot.owner && snapshot.status!=='idle' && (output.muted || output.volume===0))stopSpeech(snapshot.owner);
});
export function pauseSpeech() { globalThis.speechSynthesis?.pause(); publish({...snapshot, status:'paused'}); }
export function resumeSpeech() { globalThis.speechSynthesis?.resume(); publish({...snapshot, status:'speaking'}); }
export function speakText(text, owner, preferences = voicePreferences()) {
  stopSpeech();
  const synth = globalThis.speechSynthesis;
  const voices = localVoices();
  const voice = voices.find(v => v.voiceURI === preferences.voice) || voices.find(v => v.default) || voices[0];
  const chunks = speechChunks(text);
  const fail = error => publish({owner, status:'idle', error});
  if (!synth || !globalThis.SpeechSynthesisUtterance || !voice) return fail('No local voice is available. Install a Windows speech voice and restart the app.');
  if (!chunks.length) return fail('Enter text to read aloud.');
  if (String(text).length > 20000) return fail('Read-aloud supports up to 20,000 characters at a time. Select a shorter passage in Audio.');
  const token = generation;
  publish({owner, status:'speaking', error:''});
  function next() {
    if (token !== generation) return;
    if (!chunks.length) { publish({owner:null, status:'idle', error:''}); return; }
    const utterance = new globalThis.SpeechSynthesisUtterance(chunks.shift());
    utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = preferences.rate;
    const output=audioOutput.getPreferences();utterance.volume=output.muted ? 0 : output.volume;
    utterance.onend = next;
    utterance.onerror = event => { if (token === generation) { generation++; synth.cancel(); fail(`Voice playback failed (${event.error || 'unknown error'}). Try another installed voice.`); } };
    synth.speak(utterance);
  }
  next();
}
