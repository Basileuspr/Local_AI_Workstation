import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {StoreProvider,useStore} from '../../src/useStore';
import {audioOutput,testToneBlob} from '../../src/audioOutput';
import SoundMixer from '../../src/components/SoundMixer';
import SoundOutputSettings from '../../src/components/SoundOutputSettings';
import '../../src/styles.css';
import '../../src/components/WorkspaceControls.css';

function Fixture() {
  const [board,setBoard]=useState(true),[speech,setSpeech]=useState(''),[check,setCheck]=useState(''),[micCheck,setMicCheck]=useState('Physical input unused'),state=useStore();
  useEffect(()=>()=>{if(speech)URL.revokeObjectURL(speech);},[speech]);
  async function checkRecording() {
    const result=audioOutput.mixer.getSnapshot().result;if(!result){setCheck('No recording to inspect');return;}
    setCheck('Decoding recorded PCM…');
    const context=new AudioContext();try {
      const buffer=await context.decodeAudioData(await result.blob.arrayBuffer());let peak=0,squares=0,count=0;const channelRms=[];
      for(let c=0;c<buffer.numberOfChannels;c++){let sum=0;for(const sample of buffer.getChannelData(c)){peak=Math.max(peak,Math.abs(sample));squares+=sample*sample;sum+=sample*sample;count++;}channelRms.push(Math.sqrt(sum/buffer.length));}
      setCheck(JSON.stringify({duration:buffer.duration,channels:buffer.numberOfChannels,sampleRate:buffer.sampleRate,rms:Math.sqrt(squares/count),channelRms,peak,bytes:result.blob.size}));
    }finally{await context.close();}
  }
  function simulatedMicrophone() {
    let opened=0;
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{
      opened++;setMicCheck(`Simulated microphone opened ${opened} time(s)`);
      const context=new AudioContext(),oscillator=context.createOscillator(),gain=context.createGain(),destination=context.createMediaStreamDestination();
      oscillator.frequency.value=660;gain.gain.value=.08;oscillator.connect(gain);gain.connect(destination);oscillator.start();await context.resume();
      const track=destination.stream.getAudioTracks()[0],stop=track.stop.bind(track);
      track.stop=()=>{stop();oscillator.stop();void context.close();};return destination.stream;
    }});
    setMicCheck('Simulated microphone ready · unopened');
  }
  return <main id="app" style={{display:'block',height:'auto',minHeight:'100vh',overflow:'visible'}}>
    <nav aria-label="QA controls" style={{padding:12,display:'flex',flexWrap:'wrap',gap:8,borderBottom:'1px solid #374151'}}>
      <button onClick={()=>setBoard(true)}>Mixer board</button><button onClick={()=>setBoard(false)}>Other workspace</button>
      <button onClick={()=>{const mixer=audioOutput.mixer;mixer.addFiles([new File([testToneBlob()],'Neutral tone A.wav',{type:'audio/wav'}),new File([testToneBlob()],'Neutral tone B.wav',{type:'audio/wav'})]);for(const track of mixer.getSnapshot().tracks)void mixer.transport(track.id,'loop',true);}}>Load sample tracks</button>
      <button onClick={()=>setSpeech(URL.createObjectURL(testToneBlob()))}>Load speech preview</button><button onClick={checkRecording}>Inspect recorded PCM</button>
      <button onClick={simulatedMicrophone}>Use simulated microphone</button><output aria-label="Microphone QA status">{micCheck}</output>
      <button onClick={()=>setCheck(JSON.stringify({outputDevice:audioOutput.mixer.getSnapshot().outputDevice,routeError:audioOutput.mixer.getSnapshot().routeError}))}>Inspect output routing</button>
    </nav>
    <output aria-label="Recording inspection">{check}</output>
    <div data-capture-tab="sound-mixer" hidden={!board}><SoundMixer active={board}/></div>
    <section hidden={board} data-capture-tab="audio" style={{padding:20}} aria-label="Other workspace"><h2>Other workspace</h2><SoundOutputSettings/>{speech && <audio controls loop src={speech} data-mixer-channel="speech" aria-label="Neutral speech preview"/>}</section>
    <output aria-label="Shared master volume" hidden>{state.soundOutput.volume}</output>
  </main>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><StoreProvider><Fixture/></StoreProvider></React.StrictMode>);
