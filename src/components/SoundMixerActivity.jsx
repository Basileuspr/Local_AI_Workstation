import {useSyncExternalStore} from 'react';
import {audioOutput} from '../audioOutput';
import {useDispatch} from '../useStore';
import './SoundMixerActivity.css';
export default function SoundMixerActivity({activeTab}) {
  const status=useSyncExternalStore(audioOutput.mixer.subscribe,audioOutput.mixer.getSnapshot,audioOutput.mixer.getSnapshot),dispatch=useDispatch();
  const recording=status.recording!=='idle',microphone=status.microphone!=='off';
  if(activeTab==='sound-mixer' || (!recording && !microphone))return null;
  const elapsed=`${Math.floor(status.recordingSeconds/60)}:${String(status.recordingSeconds%60).padStart(2,'0')}`;
  const label=recording?(status.recording==='starting'?'Starting mix':`Mix ${elapsed}`):status.microphone==='requesting'?'Mic permission':'Mic live';
  return <div className="sm-activity" aria-label="Sound Mixer activity">
    <button type="button" title={`${recording?'Mix recording active. ':''}${microphone?'Microphone input active. ':''}Open Sound Mixer.`} aria-label="Open active Sound Mixer" onClick={()=>dispatch({type:'SET_SIDEBAR_TAB',payload:'sound-mixer'})}><i/>{label}</button>
    <button type="button" aria-label="Stop mixer recording and live inputs" title="Stop recording, release microphone and pause local tracks" onClick={()=>audioOutput.mixer.stopAll()}>Stop</button>
  </div>;
}
