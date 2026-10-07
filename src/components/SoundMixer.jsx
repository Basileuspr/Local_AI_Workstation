import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {audioOutput} from '../audioOutput';
import {channelIsMuted,flatChannel,mixerChannels,mixerPreset,normalizeMixerSettings} from '../mixerSettings';
import {useDispatch,useStore} from '../useStore';
import {downloadBlob} from '../downloadBlob';
import SoundOutputSettings from './SoundOutputSettings';
import ActionMenu from './ActionMenu';
import './SoundMixer.css';

const mixer=audioOutput.mixer;
const clock=value=>`${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}`;
const signed=value=>`${value>0?'+':''}${value}`;
function Meter({value,label,large=false}) {
  const db=value?.db ?? -60, clipping=value?.clipping===true;
  return <div className={`sm-meter${large?' sm-meter-large':''}`}>
    <div className="sm-meter-bar" role="meter" aria-label={label} aria-valuemin={-60} aria-valuemax={0} aria-valuenow={Math.min(0,db)} aria-valuetext={`${db.toFixed(1)} dBFS`}>
      <span style={{width:`${Math.min(100,Math.max(0,(db+60)/60*100))}%`}}/>
    </div>
    <output className={clipping?'sm-clip':''}>{db<=-60?'−∞':db.toFixed(1)} dB{clipping?' · peak':''}</output>
  </div>;
}
function Channel({channel,value,muted,level,onChange,children}) {
  const [effects,setEffects]=useState(false);
  return <section className={`sm-channel${muted?' sm-channel-muted':''}`} style={{'--channel-color':channel.color}} aria-label={`${channel.name} channel`}>
    <header><span className="sm-channel-mark"/><div><h3>{channel.name}</h3><p>{channel.detail}</p></div></header>
    <div className="sm-channel-switches">
      <button type="button" className={value.muted?'sm-muted':''} aria-pressed={value.muted} aria-label={`Mute ${channel.name}`} onClick={()=>onChange({muted:!value.muted})}>Mute</button>
      <button type="button" className={value.solo?'sm-solo':''} aria-pressed={value.solo} aria-label={`Solo ${channel.name}`} onClick={()=>onChange({solo:!value.solo})}>Solo</button>
    </div>
    <div className="sm-fader-area">
      <div className="sm-fader-scale" aria-hidden="true"><span>100</span><span>75</span><span>50</span><span>25</span><span>0</span></div>
      <label className="sm-fader"><span className="sr-only">{channel.name} volume</span><input type="range" min="0" max="100" step="1" value={Math.round(value.volume*100)} aria-label={`${channel.name} volume`} aria-valuetext={`${Math.round(value.volume*100)} percent`} onChange={event=>onChange({volume:Number(event.target.value)/100})}/></label>
      <div className="sm-fader-readout"><output>{Math.round(value.volume*100)}<small>%</small></output><span>{muted?'Silenced':value.volume===0?'Fader down':'Level'}</span></div>
    </div>
    {channel.native ? <p className="sm-native-note">Desktop volume & mute<br/>Meters / EQ unavailable</p> : <Meter value={level} label={`${channel.name} signal`}/>}
    {!channel.native && <div className="sm-effects">
      <button type="button" aria-expanded={effects} onClick={()=>setEffects(!effects)}>EQ & pan <span aria-hidden="true">{effects?'−':'+'}</span></button>
      {effects && <div className="sm-effect-controls">
        <label>Pan <output>{value.pan===0?'Center':`${Math.round(Math.abs(value.pan)*100)}% ${value.pan<0?'L':'R'}`}</output><input aria-label={`${channel.name} pan`} type="range" min="-100" max="100" value={Math.round(value.pan*100)} onChange={event=>onChange({pan:Number(event.target.value)/100})}/></label>
        {['low','mid','high'].map(band=><label key={band}>{band==='low'?'Low · 120 Hz':band==='mid'?'Mid · 1 kHz':'High · 6 kHz'} <output>{signed(value[band])} dB</output><input aria-label={`${channel.name} ${band} EQ`} type="range" min="-12" max="12" value={value[band]} onChange={event=>onChange({[band]:Number(event.target.value)})}/></label>)}
        <button type="button" onClick={()=>onChange({pan:0,low:0,mid:0,high:0})}>Reset EQ & pan</button>
      </div>}
    </div>}
    {children}
  </section>;
}
export default function SoundMixer({active=true}) {
  const state=useStore(),dispatch=useDispatch(),status=useSyncExternalStore(mixer.subscribe,mixer.getSnapshot,mixer.getSnapshot);
  const [levels,setLevels]=useState(()=>mixer.levels()),[error,setError]=useState(''),[notice,setNotice]=useState(''),[device,setDevice]=useState(''),[preset,setPreset]=useState('flat');
  const files=useRef(null),settingsFile=useRef(null),recordPreview=useRef(null);
  useEffect(()=>{if(!active || !status.enabled)return;const timer=setInterval(()=>setLevels(mixer.levels()),120);return ()=>clearInterval(timer);},[active,status.enabled]);
  const settings=state?.soundMixer || status.settings;
  const update=payload=>dispatch({type:'SET_SOUND_MIXER',payload});
  const change=(id,patch)=>update({...settings,channels:{...settings.channels,[id]:{...settings.channels[id],...patch}}});
  const busy=status.recording!=='idle';
  async function run(action) {setError('');setNotice('');try{await action();}catch(failure){setError(failure.message || 'This audio action could not finish.');}}
  function clearSolos() {update({...settings,channels:Object.fromEntries(Object.entries(settings.channels).map(([id,value])=>[id,{...value,solo:false}]))});}
  async function loadSettings(file) {
    if(!file)return;
    if(file.size>65536)throw Error('Choose a mixer settings JSON file under 64 KB.');
    const value=JSON.parse(await file.text());
    if(value.format!=='law-sound-mixer' || value.version!==1 || !value.settings?.channels)throw Error('This is not a supported mixer settings file.');
    update(normalizeMixerSettings(value.settings));setNotice('Mixer settings loaded.');
  }
  return <div className="sm-workspace">
    <header className="sm-heading"><div><span className="sm-eyebrow">WORKSTATION AUDIO</span><h2>Sound Mixer</h2><p>One board for your app channels, local tracks and live input.</p></div>
      <div className="sm-heading-actions"><span className={`sm-engine-state${status.contextState==='running'?' sm-engine-live':''}`}><i/>{status.contextState==='running'?'Audio engine ready':status.enabled?'Audio engine paused':'Ready to play'}</span>
        <button type="button" onClick={()=>run(()=>mixer.enable())}>Enable audio</button><button type="button" onClick={()=>run(()=>mixer.stopAll())}>Stop inputs</button></div>
    </header>
    <section className="sm-master" aria-label="Master mixer output">
      <div className="sm-master-top"><div><h3>Master output</h3><p>Shared with Settings & Audio</p></div><Meter large value={levels.master} label="Master output level"/>
        <label className="sm-limiter"><input type="checkbox" checked={settings.limiter} onChange={event=>update({...settings,limiter:event.target.checked})}/> Peak limiter</label></div>
      <SoundOutputSettings recording={busy} showMixerLink={false}/>
    </section>
    <div className="sm-board-toolbar"><div><label>Preset <select value={preset} onChange={event=>setPreset(event.target.value)}><option value="flat">Flat</option><option value="voice">Voice focus</option><option value="music">Music balance</option></select></label>
      <button type="button" onClick={()=>{update(mixerPreset(preset));setNotice('Preset applied.');}}>Apply preset</button>
      <button type="button" disabled={!Object.values(settings.channels).some(value=>value.solo)} onClick={clearSolos}>Clear solos</button></div>
      <div><ActionMenu label="Board settings" actions={[
        {label:'Save settings', onClick:()=>{downloadBlob(new Blob([JSON.stringify({format:'law-sound-mixer',version:1,settings},null,2)],{type:'application/json'}),'mixer-settings.json');setNotice('Settings download started.');}},
        {label:'Load settings', onClick:()=>settingsFile.current.click()},
      ]}/><input ref={settingsFile} hidden type="file" accept=".json,application/json" onChange={event=>{void run(()=>loadSettings(event.target.files[0]));event.target.value='';}}/></div>
    </div>
    {(error || status.error || status.routeError) && <p className="sm-error" role="alert">{error || status.error || status.routeError}{(error || status.error) && <button type="button" onClick={()=>{setError('');mixer.clearError();}}>Dismiss</button>}</p>}
    {notice && <p className="sm-notice" role="status">{notice}</p>}
    <div className="sm-section-heading"><h3>App channels</h3><span>Settings stay linked when you switch tabs</span></div>
    <div className="sm-channels">{mixerChannels.map(channel=><Channel key={channel.id} channel={channel} value={settings.channels[channel.id] || flatChannel} muted={channelIsMuted(settings,channel.id)} level={levels.channels[channel.id]} onChange={patch=>change(channel.id,patch)}>
      {channel.id==='microphone' && <div className="sm-input-controls">
        <label>Input <select aria-label="Mixer microphone device" value={device} disabled={status.microphone!=='off'} onChange={event=>setDevice(event.target.value)}><option value="">System default</option>{status.inputs.filter(input=>input.id && input.id!=='default').map(input=><option key={input.id} value={input.id}>{input.label}</option>)}</select></label>
        <button type="button" onClick={()=>run(()=>mixer.refreshInputs())}>Refresh inputs</button>
        {status.microphone==='off'?<button type="button" className="sm-primary" onClick={()=>run(()=>mixer.startMicrophone(device))}>Enable microphone</button>:<button type="button" onClick={()=>mixer.stopMicrophone()}>{status.microphone==='requesting'?'Cancel microphone':'Disable microphone'}</button>}
        <label className="sm-monitor"><input type="checkbox" checked={status.monitor} disabled={status.microphone!=='on'} onChange={event=>mixer.setMonitor(event.target.checked)}/> Monitor in speakers</label><small>{status.microphone==='on'?'Live input joins recordings. Use headphones for monitoring.':'Microphone off · permission on enable'}</small>
      </div>}
    </Channel>)}</div>
    <section className="sm-tracks-section" aria-label="Local mixer tracks">
      <div className="sm-section-heading"><div><h3>Local tracks <span>{status.tracks.length} / 8</span></h3><p>Mix audio files directly from this computer.</p></div><div className="sm-track-actions">
        <button type="button" className="sm-primary" disabled={status.tracks.length>=8} onClick={()=>files.current.click()}>Add audio tracks</button>
        <button type="button" disabled={!status.tracks.length} onClick={()=>run(async()=>{const results=await Promise.allSettled(status.tracks.map(track=>mixer.transport(track.id,'play')));const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;})}>Play all</button>
        <button type="button" disabled={!status.tracks.length} onClick={()=>run(()=>Promise.all(status.tracks.map(track=>mixer.transport(track.id,'pause'))))}>Pause all</button>
        <input ref={files} hidden type="file" accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.opus,.flac,.webm" multiple onChange={event=>{const selected=Array.from(event.target.files);event.target.value='';void run(()=>mixer.addFiles(selected));}}/>
      </div></div>
      {!status.tracks.length && <div className="sm-empty"><span aria-hidden="true">♫</span><div><strong>Your tracks go here</strong><p>Add up to eight audio files to blend music, speech or sound effects. Each gets its own fader, EQ and transport.</p></div></div>}
      <div className="sm-channels">{status.tracks.map((track,index)=><Channel key={track.id} channel={{id:track.id,name:`Track ${Number(track.id.split('-')[1])}`,detail:track.name,color:['#60a5fa','#a78bfa','#34d399','#fbbf24'][index%4]}} value={settings.channels[track.id]} muted={channelIsMuted(settings,track.id)} level={levels.channels[track.id]} onChange={patch=>change(track.id,patch)}>
        <div className="sm-transport"><button type="button" className={track.playing?'sm-playing':''} onClick={()=>run(()=>mixer.transport(track.id,track.playing?'pause':'play'))}>{track.playing?'Pause':'Play'}</button><button type="button" onClick={()=>run(()=>mixer.transport(track.id,'rewind'))}>Rewind</button></div>
        <label className="sm-seek"><span>{clock(track.time)} / {clock(track.duration)}</span><input aria-label={`Seek ${track.name}`} type="range" min="0" max={track.duration || 1} step=".1" value={Math.min(track.duration || 1,track.time)} disabled={!track.duration} onChange={event=>run(()=>mixer.transport(track.id,'seek',Number(event.target.value)))}/></label>
        <div className="sm-track-footer"><label><input type="checkbox" checked={track.loop} onChange={event=>run(()=>mixer.transport(track.id,'loop',event.target.checked))}/> Loop</label><button type="button" aria-label={`Remove ${track.name}`} onClick={()=>run(()=>mixer.removeTrack(track.id))}>Remove</button></div>{track.error && <small role="alert">{track.error}</small>}
      </Channel>)}</div>
    </section>
    <section className="sm-recorder" aria-label="Mix recorder"><div className="sm-record-heading"><div><h3><i className={busy?'sm-recording-dot':''}/> Mix recorder</h3><p>Processed app channels, local tracks & enabled microphone · up to 5 minutes</p></div><output className="sm-record-time">{clock(status.recordingSeconds)}</output></div>
      <div className="sm-record-actions"><button type="button" className="sm-record-button" disabled={busy} onClick={()=>run(()=>mixer.startRecording())}>Record mix</button><button type="button" disabled={!['recording','starting'].includes(status.recording)} onClick={()=>mixer.stopRecording()}>{status.recording==='saving'?'Saving…':status.recording==='starting'?'Cancel recording':'Stop recording'}</button>
        <span>{status.recording==='starting'?'Preparing recording…':busy?'Recording continues across tabs.':status.result?'Recording ready to save.':'Ready to record'} {status.recordingBytes>0?`· ${(status.recordingBytes/1024/1024).toFixed(2)} MB`:''}</span></div>
      {busy && <Meter value={levels.record} label="Recorded mix level" large/>}
      {status.result && <div className="sm-record-result"><audio ref={recordPreview} controls preload="metadata" src={status.result.url} data-mixer-channel="audio" aria-label="Recorded mix preview"/><span>{clock(status.result.duration)} · {(status.result.blob.size/1024/1024).toFixed(2)} MB</span><button type="button" onClick={()=>downloadBlob(status.result.blob,status.result.name)}>Save recording</button><button type="button" onClick={()=>{recordPreview.current?.pause();mixer.clearResult();}}>Clear recording</button></div>}
      <p className="sm-record-note">Desktop browser / linked players and installed Windows voices stay outside this recording. App and local track recordings follow master volume and channel settings. Save before refreshing or closing.</p>
    </section>
    <details className="sm-routing-info"><summary>What’s connected to the board?</summary><p>Speech controls generated chat audio and installed voice volume. Audio covers transcription, extraction and voice previews. Video covers app video previews. Alerts covers timer sounds. Desktop channels control HTML player volume and mute; external Web Audio players support mute only and use Windows output settings. EQ, pan and meters require a processed app player. Microphone monitoring starts off every time.</p><p>Local files, microphone audio and mix recordings stay on this computer. A refresh releases live inputs and clears unsaved audio; your board settings are retained.</p></details>
  </div>;
}
