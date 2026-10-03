import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {StoreProvider,ChatStoreProvider,useStore,useDispatch} from '../../src/useStore';
import {audioOutput,testToneBlob} from '../../src/audioOutput';
import {pickPreferences,savePreferences} from '../../src/preferences';
import SoundOutputSettings from '../../src/components/SoundOutputSettings';
import '../../src/styles.css';

// Browser UI tests use explicit simulated devices. The Electron QA uses the
// real platform device list and real HTMLMediaElement.setSinkId, without mocks.
const simulated=!window.workstationDesktop;
let disconnected=false;
if(simulated) {
  const devices=()=>[{kind:'audiooutput',deviceId:'default',label:'System default (simulated)'},
    {kind:'audiooutput',deviceId:'speakers',label:'Speakers (simulated)'},
    ...(!disconnected?[{kind:'audiooutput',deviceId:'headset',label:'Headset (simulated)'}]:[])];
  Object.defineProperty(navigator.mediaDevices,'enumerateDevices',{value:async()=>devices(),configurable:true});
  Object.defineProperty(HTMLMediaElement.prototype,'setSinkId',{value:async function(id){
    if(id && !devices().some(device=>device.deviceId===id))throw Object.assign(new Error('Missing device'),{name:'NotFoundError'});
    this.setAttribute('data-output-device',id);Object.defineProperty(this,'sinkId',{value:id,configurable:true});
  },configurable:true});
}
function PreferencePersistence() {
  const state=useStore();useEffect(()=>savePreferences(pickPreferences(state)),[state.soundOutput]);return null;
}
function ResetPreferences() {
  const dispatch=useDispatch();return <button type="button" onClick={()=>dispatch({type:'RESET_PREFERENCES'})}>Reset preferences</button>;
}
function View() {
  const [tone,setTone]=useState(''),[extra,setExtra]=useState(false);
  useEffect(()=>{const url=URL.createObjectURL(testToneBlob());setTone(url);return ()=>URL.revokeObjectURL(url);},[]);
  return <main style={{maxWidth:980,margin:'24px auto',padding:'0 20px'}}>
    <h1>Sound output</h1><p>{simulated?'UI verification · simulated devices':'Desktop verification · real device routing'}</p>
    <PreferencePersistence/>
    <section aria-label="Settings preview"><h2>Settings</h2><SoundOutputSettings/></section>
    <section aria-label="Audio preview"><h2>Audio / recording preview</h2><SoundOutputSettings/><audio aria-label="Neutral audio preview" controls preload="metadata" src={tone || undefined}/><button type="button" onClick={()=>setExtra(value=>!value)}>{extra?'Remove second preview':'Add second preview'}</button>{extra&&<audio aria-label="Second neutral preview" controls src={tone || undefined}/>}</section>
    <ChatStoreProvider><section aria-label="Second chat settings"><h2>Second chat</h2><SoundOutputSettings/><ResetPreferences/></section></ChatStoreProvider>
    {simulated&&<button type="button" onClick={()=>{disconnected=!disconnected;void audioOutput.refresh();}}>Toggle simulated headset connection</button>}
  </main>;
}
createRoot(document.getElementById('root')).render(<StoreProvider><View/></StoreProvider>);
