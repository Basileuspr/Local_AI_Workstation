import {useState, useSyncExternalStore} from 'react';
import {useDispatch, useStore} from '../useStore';
import {audioOutput} from '../audioOutput';
import './SoundOutputSettings.css';

export default function SoundOutputSettings({recording = false,showMixerLink=true}) {
  const state=useStore(), dispatch=useDispatch(), [error,setError]=useState(''), [choosing,setChoosing]=useState(false);
  const status=useSyncExternalStore(audioOutput.subscribe,audioOutput.getSnapshot,audioOutput.getSnapshot);
  if(!state)return null;
  const value=state.soundOutput, outputs=status.devices.filter(device=>device.deviceId!=='default');
  const absent=Boolean(value.deviceId && status.loaded && !outputs.some(device=>device.deviceId===value.deviceId));
  const supported=typeof globalThis.HTMLMediaElement?.prototype?.setSinkId==='function';
  const defaultDevice=status.devices.find(device=>device.deviceId==='default');
  const captureBusy=recording || status.captureBusy;
  const update=payload=>{setError('');dispatch({type:'SET_SOUND_OUTPUT',payload});};
  async function choose() {
    setChoosing(true);setError('');
    try {update(await audioOutput.choose());}catch(failure){if(failure.name!=='AbortError')setError(failure.message);}
    finally {setChoosing(false);}
  }
  async function test() {
    setError('');try {await audioOutput.testSound();}catch(failure){setError(failure.message);}
  }
  async function openWindows() {
    setError('');
    try {const result=await window.workstationDesktop.openSoundSettings();if(result?.error)throw Error(result.error);}
    catch(failure){setError(failure.message || 'Could not open Windows Sound settings.');}
  }
  return <section className="sound-output-settings" aria-label="Sound output">
    <strong>Sound output</strong>
    <div className="sound-output-controls">
      <label className="sound-output-volume">Playback volume <input aria-label="Playback volume" type="range" min="0" max="100" step="1" value={Math.round(value.volume*100)} onChange={event=>update({volume:Number(event.target.value)/100})}/><output>{Math.round(value.volume*100)}%</output></label>
      <button type="button" aria-pressed={value.muted} onClick={()=>update({muted:!value.muted})}>{value.muted?'Unmute playback':'Mute playback'}</button>
      <label className="sound-output-device">Output device <select aria-label="Sound output device" value={value.deviceId} disabled={!supported || choosing} onChange={event=>{
        const device=outputs.find(output=>output.deviceId===event.target.value);
        update({deviceId:device?.deviceId || '',deviceLabel:device?.label || ''});
      }}>
        <option value="">System default{defaultDevice?.label ? ` · ${defaultDevice.label.replace(/^Default\s*[-–·]\s*/i,'')}` : ' (follows Windows)'}</option>
        {value.deviceId && !outputs.some(device=>device.deviceId===value.deviceId) && <option value={value.deviceId}>{value.deviceLabel || 'Saved output device'} · {status.loaded?'unavailable':'checking'}</option>}
        {outputs.map(device=><option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
      </select></label>
    </div>
    <div className="sound-output-actions">
      {showMixerLink && <button type="button" onClick={()=>{dispatch({type:'SET_SETTINGS_OPEN',payload:false});dispatch({type:'SET_SIDEBAR_TAB',payload:'sound-mixer'});}}>Open Sound Mixer</button>}
      <button type="button" disabled={status.refreshing} onClick={()=>void audioOutput.refresh()}>{status.refreshing?'Refreshing devices…':'Refresh devices'}</button>
      {typeof globalThis.navigator?.mediaDevices?.selectAudioOutput==='function' && <button type="button" disabled={choosing || !supported} onClick={choose}>{choosing?'Choosing output…':'Choose / allow output'}</button>}
      <button type="button" disabled={captureBusy || status.testing || value.muted || value.volume===0} onClick={test}>{status.testing?'Playing test sound…':'Test sound'}</button>
      {window.workstationDesktop?.openSoundSettings && <button type="button" onClick={openWindows}>Windows Sound settings</button>}
    </div>
    <small>App previews and generated speech · shared with Settings, Audio, and Spotify recording previews · saved automatically.</small>
    <small>Sound Mixer controls workspace channels and desktop HTML players. System recording captures the Windows default output; this selector routes app playback.</small>
    <details><summary>Playback and recording levels</summary><small>App volume and mute control audio/video previews and generated speech. Raw microphone and system recordings retain their captured levels; Sound Mixer recordings follow channel and master levels. Installed Windows voice volume applies to new speech chunks; muting stops the current spoken passage.</small></details>
    {!supported && <p role="status">This browser supports volume only. Output selection needs a supported desktop/browser player.</p>}
    {absent && <p role="status">{value.deviceLabel || 'Saved output device'} is unavailable. Playing through System default until it reconnects, or choose another output.</p>}
    {(value.muted || value.volume===0) && <p role="status">Playback is {value.muted?'muted':'at 0%'}. Sound Mixer recordings also follow this master level.</p>}
    {captureBusy && <p role="status">Test sound is disabled while audio recording or processing is active.</p>}
    {(error || status.error || status.routeError) && <p className="sound-output-error" role="alert">{error || status.error || status.routeError}</p>}
  </section>;
}
