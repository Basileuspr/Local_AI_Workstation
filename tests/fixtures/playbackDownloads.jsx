import React from 'react';
import {createRoot} from 'react-dom/client';
import AppIntegrations from '../../src/components/AppIntegrations';
import {ConvertedAttachment} from '../../src/components/FileConverter';
import '../../src/styles.css';

// Browser-only simulation: synthetic audio, no desktop, microphone, Spotify,
// saved app data, or external service is accessed. Electron uses its real bridge.
const browserFixture = !window.workstationDesktop;
let playerReady=false, feed='tone';
if(browserFixture){
  window.workstationDesktop={
    playbackCaptureStatus:async()=>({supported:true,spotify_ready:playerReady}),
    requestPlaybackCapture:async()=>({ready:true}),cancelPlaybackCapture:async()=>{},
    openLinkedContent:async()=>{playerReady=true;return {ready:true};},placeLinkedContent:async()=>{},closeLinkedContent:async()=>{},
    saveConvertedImage:async()=>({saved:true,name:'neutral.ico'}),
  };
  navigator.mediaDevices.getDisplayMedia=async()=>{
    if(feed==='failure')throw Object.assign(new Error('Could not start audio source'),{name:'NotReadableError'});
    const context=new AudioContext(),destination=context.createMediaStreamDestination(),oscillator=context.createOscillator(),gain=context.createGain();
    gain.gain.value=feed==='silence'?0:.03;oscillator.connect(gain).connect(destination);await context.resume();oscillator.start();
    const track=destination.stream.getAudioTracks()[0],stop=track.stop.bind(track);let stopped=false;
    track.stop=()=>{if(stopped)return;stopped=true;stop();oscillator.stop();void context.close().catch(()=>{});};
    return destination.stream;
  };
}
const actualFetch=window.fetch.bind(window);
window.fetch=async(input,options)=>{
  const url=new URL(input,location.href),json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  if(url.pathname==='/integrations/status')return json({processes:{discord:[],spotify:[],phone:[]},phone:{ready:false,description:'Neutral verification only.'}});
  if(url.pathname==='/integrations/embed')return json({url:'https://open.spotify.com/embed/track/0123456789ABCDEFGHIJKL'});
  return actualFetch(input,options);
};
function Fixture(){return <main style={{height:'100vh',overflow:'auto'}}>
  <p style={{padding:'8px 20px'}}>Isolated verification · generated test audio and icon{browserFixture && <> · simulated desktop <label>Audio feed <select aria-label="Fixture audio feed" defaultValue="tone" onChange={event=>{feed=event.target.value;}}><option value="tone">Test tone</option><option value="silence">Silence</option><option value="failure">Device failure</option></select></label></>}</p>
  <AppIntegrations/>
  <section className="tools-workspace"><h2>Converted icon</h2><ConvertedAttachment artifact={{id:'a'.repeat(32),name:'neutral.ico',format:'ico',width:256,height:256,size:2048}}/></section>
</main>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
