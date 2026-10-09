import { expect, it, vi } from 'vitest';
import { Midi } from '@tonejs/midi';
import { decodePianoAudioFile, pianoNotesMidi, pianoNotesToSequence, runPianoNoteConversion, validatePianoAudioOptions } from '../../src/pianoAudio';
import { normalizePianoSpotifyLink, requestPianoSpotifyReference, takePianoSpotifyReference } from '../../src/pianoSpotifyBridge';
import { parsePianoSequence, readPianoTemplates, savePianoTemplates, validatePianoTemplate } from '../../src/pianoTemplates';

const note = (pitchMidi, startTimeSeconds, durationSeconds, amplitude = .8) => ({ pitchMidi, startTimeSeconds, durationSeconds, amplitude });

it('converts detected starts, chords, rests, and repeated attacks into playable steps', () => {
  const result = pianoNotesToSequence([note(60, .5, .5), note(60, 1, .5), note(64, 1.5, 1), note(67, 1.5, 1)], { duration: 3, tempo: 120 });
  expect(result.sequence).toBe('R C4 C4 [E4 G4]:2');
  expect(parsePianoSequence(result.sequence).map(step => step.notes.map(item => item.midi))).toEqual([[], [60], [60], [64,67]]);
  expect(result.templateError).toBe('');
  const long = pianoNotesToSequence([note(60, 0, 10)], { tempo: 120, duration: 10 });
  expect(long.sequence).toBe('C4:8 C4:8 C4:4');
  expect(pianoNotesToSequence([note(60, 0, .4),note(64,.4,.4)],{tempo:120,grid:.5}).sequence).toBe('C4 E4:0.5');
});

it('reports empty, invalid, overcrowded and overlong results without silently dropping data', () => {
  expect(() => pianoNotesToSequence([], {})).toThrow('No clear');
  expect(() => pianoNotesToSequence([note(60,0,-1)], {})).toThrow('No clear');
  const crowded = pianoNotesToSequence(Array.from({length:9},(_,index)=>note(60+index,0,1)), {});
  expect(crowded.templateError).toContain('eight'); expect(crowded.accepted).toBe(9);
  const excessive = pianoNotesToSequence(Array.from({length:160},(_,index)=>note(60,index*.125,.1)), {duration:30,tempo:120});
  expect(excessive.templateError).toContain('128');
  const filtered = pianoNotesToSequence([note(10,0,1),note(60,0,1),note(60,40,1)],{});
  expect(filtered.outside).toBe(1); expect(filtered.accepted).toBe(1);
  for (const options of [{start:-1},{duration:31},{tempo:NaN},{grid:.1},{threshold:0}]) expect(() => validatePianoAudioOptions(options)).toThrow();
});

it('exports raw polyphonic MIDI without quantizing starts or merging repeated notes', async () => {
  const input = [note(60,.12,.37),note(64,.12,.6),note(60,.55,.3)];
  const midi = new Midi(await (await pianoNotesMidi(input,'Known clip')).arrayBuffer());
  expect(midi.name).toBe('Known clip'); expect(midi.tracks[0].notes).toHaveLength(3);
  expect(midi.tracks[0].notes.map(item=>item.midi)).toEqual([60,64,60]);
  expect(midi.tracks[0].notes[0].time).toBeCloseTo(.12,2);
  expect(midi.tracks[0].notes[0].duration).toBeCloseTo(.37,2);
});

it('normalizes Spotify track references, rejects other origins, and round-trips them in saved templates', () => {
  const id='0123456789ABCDEFGHIJKL', url=`https://open.spotify.com/track/${id}`;
  for (const value of [url+'?si=private',`spotify:track:${id}`,`https://open.spotify.com/intl-en/embed/track/${id}/`]) expect(normalizePianoSpotifyLink(value)).toBe(url);
  for (const value of ['https://evil.test/track/'+id,'https://open.spotify.com@evil.test/track/'+id,'http://open.spotify.com/track/'+id,'javascript:alert(1)',url.replace('/track/','/album/'),url+ '/secret']) expect(()=>normalizePianoSpotifyLink(value)).toThrow();
  requestPianoSpotifyReference(url); expect(takePianoSpotifyReference()).toEqual({url}); expect(takePianoSpotifyReference()).toBeNull();
  expect(normalizePianoSpotifyLink(undefined)).toBe('');
  let raw='';const storage={getItem:()=>raw,setItem:(_key,value)=>{raw=value;}};
  const template={...validatePianoTemplate({title:'My notes',description:'Review',tempo:90,sequence:'C4',spotifyLink:url+'?si=private'}),id:'user-example'};
  savePianoTemplates([template],storage); expect(readPianoTemplates(storage).templates[0].spotifyLink).toBe(url);
});

it('bounds file decoding and creates a normalized mono clip without opening playback audio', async () => {
  const channels=[Float32Array.from([.05,.1,.15,.2,.1,.05]),Float32Array.from([.05,.1,.15,.2,.1,.05])];
  const decode=vi.fn(async()=>({duration:3,sampleRate:2,numberOfChannels:2,getChannelData:index=>channels[index]}));
  class Context { decodeAudioData=decode; }
  const file={size:32,arrayBuffer:async()=>new ArrayBuffer(32)};
  const result=await decodePianoAudioFile(file,{start:1,duration:1},{OfflineAudioContext:Context});
  expect(result.samples).toEqual(Float32Array.from([.375,.5]));
  await expect(decodePianoAudioFile({...file,size:40*1024**2},{},{OfflineAudioContext:Context})).rejects.toThrow('32 MB');
  await expect(decodePianoAudioFile(file,{start:4},{OfflineAudioContext:Context})).rejects.toThrow('past the end');
  decode.mockResolvedValueOnce({duration:601});await expect(decodePianoAudioFile(file,{}, {OfflineAudioContext:Context})).rejects.toThrow('ten minutes');
});

it('terminates workers on result, failure, or cancellation and ignores late messages', async () => {
  let worker;
  class Worker { constructor(){worker=this;} terminate=vi.fn();postMessage=vi.fn(); }
  const progress=vi.fn(),job=runPianoNoteConversion(new Float32Array(5),.3,progress,{Worker});
  worker.onmessage({data:{type:'progress',value:.5}});expect(progress).toHaveBeenCalledWith(.5);
  worker.onmessage({data:{type:'result',notes:[note(60,0,1)]}});await expect(job.promise).resolves.toHaveLength(1);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  const cancelled=runPianoNoteConversion(new Float32Array(5),.3,progress,{Worker});
  cancelled.cancel();await expect(cancelled.promise).rejects.toMatchObject({name:'AbortError'});
  worker.onmessage({data:{type:'progress',value:1}});expect(progress).toHaveBeenCalledTimes(1);
  const failed=runPianoNoteConversion(new Float32Array(5),.3,progress,{Worker});worker.onerror();await expect(failed.promise).rejects.toThrow('could not start');
});
