import {useSyncExternalStore} from 'react';
import {chatSpeech, chatSpeechOwner} from '../chatSpeech';
import {useStore} from '../useStore';

export default function ChatSpeak({message, sessionId, active, streaming = false}) {
  const {voiceOutput} = useStore();
  const speech = useSyncExternalStore(chatSpeech.subscribe,chatSpeech.getSnapshot,chatSpeech.getSnapshot);
  const owner = chatSpeechOwner(sessionId,message.id), mine = speech.owner === owner;
  const busy = mine && speech.status !== 'idle';
  return <span className="audio-read-aloud chat-speak">
    <button type="button" disabled={!active || (streaming && !busy)} title={busy ? 'Stop speech generation or playback' : 'Speak with the cloned voice selected in Settings'} onClick={() => busy ? chatSpeech.stop(owner) : void chatSpeech.speak({text:message.content,owner,preferences:voiceOutput})}>
      {busy ? 'Stop' : 'Speak'}
    </button>
    {mine && speech.status === 'generating' && <small role="status">Generating speech…</small>}
    {mine && speech.error && <small role="alert">{speech.error}</small>}
    {mine && speech.warnings.map(warning => <small key={warning} role="status">{warning}</small>)}
  </span>;
}
