import React from 'react';
import { createRoot } from 'react-dom/client';
import BreakRoom from '../../src/components/BreakRoom';
import AppIntegrations from '../../src/components/AppIntegrations';
import { StoreProvider, useStore, useDispatch } from '../../src/useStore';
import { pianoNotesToSequence, pianoNotesMidi, runPianoNoteConversion } from '../../src/pianoAudio';
import { Midi } from '@tonejs/midi';
import '../../src/styles.css';

window.workstationDesktop = { playbackCaptureStatus: async () => ({ supported: false }), placeLinkedContent: async () => {}, closeLinkedContent: async () => {} };
// Fixture replaces only the integration backend; Spotify is never contacted in QA.
const originalFetch = window.fetch;
window.fetch = (url, options) => String(url).includes('/integrations/status') ? Promise.resolve(new Response(JSON.stringify({ processes: [], phone: {} }), { headers: { 'Content-Type': 'application/json' } })) : originalFetch(url, options);
const workerCounts = { started: 0, terminated: 0 };
const NativeWorker = window.Worker;
window.Worker = class extends NativeWorker { constructor(...args) { super(...args); workerCounts.started++; } terminate() { workerCounts.terminated++; super.terminate(); } };
const expected = [60,64,67];
function knownAudio(silent = false) {
  const rate = 22050, length = Math.ceil(4.3 * rate), buffer = new ArrayBuffer(44 + length * 2), view = new DataView(buffer);
  const word = (offset, text) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  word(0,'RIFF');view.setUint32(4,36+length*2,true);word(8,'WAVE');word(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);word(36,'data');view.setUint32(40,length*2,true);
  const notes = [[60,0,.45],[64,.65,.45],[67,1.3,.45],[60,2,.8],[64,2,.8],[67,2,.8],[60,3.05,.35],[60,3.55,.35]];
  for (let i=0;i<length;i++) {
    let sample=0, time=i/rate;
    if (!silent) for (const [pitch,start,duration] of notes) {
      const elapsed=time-start;if(elapsed<0||elapsed>=duration)continue;
      const phase=2*Math.PI*440*2**((pitch-69)/12)*elapsed;
      const envelope=Math.min(1,elapsed/.012,(duration-elapsed)/.04)*Math.exp(-elapsed*1.2);
      sample += .2 * envelope * (Math.sin(phase)+.3*Math.sin(phase*2)+.12*Math.sin(phase*3));
    }
    view.setInt16(44+i*2,Math.max(-32767,Math.min(32767,Math.round(sample*32767))),true);
  }
  return new File([buffer],silent?'silence.wav':'known-piano.wav',{type:'audio/wav'});
}
window.pianoAudioQA = {
  expected, knownAudio, workerCounts,
  async resultFromSamples(samples) { const job=runPianoNoteConversion(samples,.3);return job.promise; },
  async midi(notes) {const midi=new Midi(await (await pianoNotesMidi(notes)).arrayBuffer());return midi.tracks[0].notes.map(note=>({midi:note.midi,time:note.time,duration:note.duration}));},
  quantize:pianoNotesToSequence,
  upload(kind='known') { const input=document.querySelector('[aria-label="Piano audio file"]'),data=new DataTransfer();data.items.add(kind==='bad'?new File(['bad audio'],'broken.wav',{type:'audio/wav'}):knownAudio(kind==='silent'));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true})); }
};
function Fixture() {
  const state=useStore(),dispatch=useDispatch(),integrations=state.activeSidebarTab==='integrations';
  return <div style={{ height: '100%', overflow: 'auto' }}><nav><button onClick={()=>dispatch({type:'SET_SIDEBAR_TAB',payload:integrations?'break-room':'integrations'})}>Switch workspace</button><output>{state.activeSidebarTab}</output></nav>
    <div hidden={integrations}><BreakRoom active={!integrations}/></div><div hidden={!integrations}><AppIntegrations active={integrations}/></div></div>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><StoreProvider><Fixture/></StoreProvider></React.StrictMode>);
