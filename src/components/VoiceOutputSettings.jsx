import {useEffect, useState} from 'react';
import {useStore, useDispatch} from '../useStore';
import {resourceCatalog} from '../characterResources';
import {audioRequest} from '../audio';
import {VOICE_ENGINES, VOICE_LANGUAGES} from '../voiceCloning';

export function VoiceEngineControls({value, onChange, disabled = false, chat = false}) {
  return <div className="audio-controls">
    <label>Voice model <select aria-label={chat ? 'Chat voice model' : 'Voice cloning model'} disabled={disabled} value={value.engine} onChange={e => onChange({engine:e.target.value,...(e.target.value === 'chatterbox-turbo' ? {language:'English'} : {})})}>{Object.entries(VOICE_ENGINES).map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>
    <label>Language <select aria-label={chat ? 'Chat voice language' : 'Cloned voice language'} disabled={disabled || value.engine === 'chatterbox-turbo'} value={value.language} onChange={e => onChange({language:e.target.value})}>{VOICE_LANGUAGES.map(language => <option key={language}>{language}</option>)}</select></label>
    <label>Processing <select aria-label={chat ? 'Chat voice processing' : 'Voice cloning processing'} disabled={disabled} value={value.acceleration} onChange={e => onChange({acceleration:e.target.value})}><option value="auto">Auto · use available GPU</option><option value="cpu">CPU only</option></select></label>
  </div>;
}

export default function VoiceOutputSettings() {
  const state = useStore(), dispatch = useDispatch(), value = state.voiceOutput;
  const [files, setFiles] = useState([]), [status,setStatus] = useState(null), [error,setError] = useState('');
  const [revision,refresh] = useState(0);
  useEffect(() => {
    let disposed = false;
    Promise.all([resourceCatalog('file'),audioRequest('voices/status')]).then(([{items},readiness]) => {
      if (!disposed) {setFiles(items.filter(item => item.category === 'audio' && item.size <= 25*1024*1024));setStatus(readiness);setError('');}
    }).catch(e => {if (!disposed) setError(e.message);});
    return () => {disposed = true;};
  },[revision]);
  const update = payload => dispatch({type:'SET_VOICE_OUTPUT',payload});
  return <section className="voice-output-settings" aria-label="Voice Output">
    <strong>Voice Output</strong>
    <label><input type="checkbox" checked={value.autoSpeak} onChange={e => update({autoSpeak:e.target.checked})}/> Automatically speak assistant responses</label>
    <label>Voice reference <select aria-label="Chat voice reference" value={value.referenceId} onChange={e => {
      const chosen = files.find(file => file.id === e.target.value);
      update({referenceId:chosen?.id || '',referenceName:chosen?.name || '',referenceText:''});
    }}><option value="">Choose a saved voice reference</option>{value.referenceId && !files.some(file => file.id === value.referenceId) && <option value={value.referenceId}>{value.referenceName || 'Saved reference'} · unavailable until refreshed</option>}{files.map(file => <option key={file.id} value={file.id}>{file.name}</option>)}</select></label>
    <VoiceEngineControls value={value} onChange={update} chat/>
    <label>Words spoken in the reference<textarea aria-label="Chat voice reference transcript" rows={2} maxLength={4000} value={value.referenceText} onChange={e => update({referenceText:e.target.value})}/></label>

    <button type="button" onClick={() => refresh(value => value+1)}>Refresh saved voices</button>
    {status && !status.engines?.[value.engine]?.ready && <p role="status">This voice engine needs installation. Open Audio → Voice cloning for setup.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
