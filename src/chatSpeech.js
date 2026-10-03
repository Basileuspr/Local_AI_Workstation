import {generateClonedVoice, stopClonedVoice} from './voiceCloning';
import {characterFileUrl} from './characterResources';
import {registerSpeechStopper, stopSpeech} from './audioSpeech';
import {audioOutput} from './audioOutput';

export const chatSpeechOwner = (sessionId, messageId) => `chat:${sessionId}:${messageId}`;

export function speechResponseText(text) {
  return String(text || '').replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^\s*```[^\n]*$/gm, '')
    .replace(/^\s*#{1,6}\s+/gm, '').replace(/\*\*|__|`/g, '').trim();
}

async function loadReference(settings, signal) {
  const response = await fetch(characterFileUrl(settings.referenceId), {signal});
  if (!response.ok) throw new Error('The saved chat voice is unavailable. Choose a voice in Settings or save one in Audio.');
  return new File([await response.blob()], settings.referenceName || 'Voice.wav', {
    type: response.headers.get('content-type') || 'audio/wav',
  });
}

/** One optional output operation, independent of chat inference and persistence. */
export function createChatSpeech({generate = generateClonedVoice, cancel = stopClonedVoice,
  reference = loadReference, audio = url => new Audio(url), createUrl = blob => URL.createObjectURL(blob),
  revokeUrl = url => URL.revokeObjectURL(url), stopSystem = stopSpeech} = {}) {
  const listeners = new Set();
  let snapshot = {owner:null, status:'idle', error:'', warnings:[]}, operation = null;
  let scope = {sessionId:null, active:false, preferences:{}};
  const publish = value => {snapshot = value; listeners.forEach(listener => listener());};
  function release(op) {
    if (op.audio) {
      op.output?.release();
      op.audio.onended = null; op.audio.onerror = null;
      op.audio.pause(); op.audio.removeAttribute?.('src'); op.audio.load?.();
    }
    if (op.url) revokeUrl(op.url);
  }
  function stop(owner) {
    if (owner && snapshot.owner !== owner) return;
    const op = operation; operation = null;
    if (op) {
      op.controller.abort();
      if (op.submitted && snapshot.status === 'generating') void cancel(op.requestId).catch(() => {});
      release(op);
    }
    publish({owner:null, status:'idle', error:'', warnings:[]});
  }
  function configure(next) {
    const previous = scope; scope = next;
    if (!next.active || next.sessionId !== previous.sessionId
      || (operation && ((operation.automatic && !next.preferences.autoSpeak)
      || ['referenceId','referenceText','engine','language','acceleration'].some(key => previous.preferences[key] !== next.preferences[key])))) stop();
  }
  async function speak({text, owner, preferences, automatic = false}) {
    stop(); stopSystem();
    const words = speechResponseText(text);
    const fail = error => publish({owner, status:'idle', error, warnings:[]});
    if (!preferences?.referenceId) return fail('Choose a cloned voice in Settings → Voice Output, or use a reference from Audio.');
    if (!words) return fail('There is no response text to speak.');
    if (words.length > 1500) return fail('Cloned speech supports up to 1,500 characters. Use a shorter response or paste a passage into Audio.');
    if (preferences.engine !== 'chatterbox-turbo' && !preferences.referenceText?.trim()) return fail('This voice needs its reference transcript. Add the words spoken in Settings → Voice Output.');
    const op = {owner, automatic, controller:new AbortController(), requestId:crypto.randomUUID()};
    operation = op;
    publish({owner, status:'generating', error:'', warnings:[]});
    try {
      const file = await reference(preferences, op.controller.signal);
      if (operation !== op) return;
      op.submitted = true;
      const result = await generate({engine:preferences.engine, text:words, reference:file,
        referenceText:preferences.referenceText, language:preferences.language, acceleration:preferences.acceleration,
        requestId:op.requestId, signal:op.controller.signal});
      if (operation !== op) return;
      op.url = createUrl(result.blob); op.audio = audio(op.url);
      op.output = audioOutput.track(op.audio);
      op.audio.onended = () => {if (operation === op) {operation = null; release(op); publish({owner:null,status:'idle',error:'',warnings:[]});}};
      op.audio.onerror = () => {if (operation === op) {operation = null; release(op); fail('Generated speech could not be played. Press Speak to try again.');}};
      publish({owner, status:'playing', error:'', warnings:result.processing?.warnings || []});
      await op.output.ready;
      if(operation!==op)return;
      await op.audio.play();
    } catch (error) {
      if (operation !== op) return;
      operation = null; release(op);
      if (error.name === 'AbortError') publish({owner:null,status:'idle',error:'',warnings:[]});
      else fail(error.message || 'Speech generation failed. Your text response is still available.');
    }
  }
  function completed({message, sessionId, preferences, completed = true}) {
    if (!completed || !preferences?.autoSpeak || !scope.active || scope.sessionId !== sessionId
      || message.role !== 'assistant' || !message.id || !message.content?.trim()) return;
    void speak({text:message.content, owner:chatSpeechOwner(sessionId,message.id), preferences, automatic:true});
  }
  return {subscribe(listener) {listeners.add(listener); return () => listeners.delete(listener);},
    getSnapshot:() => snapshot, configure, speak, stop, completed};
}

export const chatSpeech = createChatSpeech();
registerSpeechStopper(owner => chatSpeech.stop(owner));
