import {afterEach,expect,it,vi} from 'vitest';
import {extractAudio,validateExtractionInput,EXTRACTION_MAX_BYTES} from '../../src/audioExtraction';

afterEach(() => vi.unstubAllGlobals());
it('accepts common video and audio inputs while bounding uploads',() => {
  for (const name of ['VIDEO.MP4','clip.mov','movie.mkv','capture.webm','clip.avi','sound.wav','song.flac','sound.m4a']) expect(validateExtractionInput({name,size:10})).toBe('');
  expect(validateExtractionInput({name:'empty.mp4',size:0})).toMatch('nonempty');
  expect(validateExtractionInput({name:'large.mp4',size:EXTRACTION_MAX_BYTES+1})).toMatch('2 GB');
  expect(validateExtractionInput({name:'fake.mp4.exe',size:10})).toMatch('supported');
});
it('sends the selected track, format and cancellation signal, returning a named audio file',async() => {
  const fetch = vi.fn(async() => new Response(new Blob(['wave'],{type:'audio/wav'}),{headers:{'X-Audio-Extraction':JSON.stringify({audio_tracks:2,track:2})}}));
  vi.stubGlobal('fetch',fetch);
  const controller = new AbortController(), onReceiving = vi.fn();
  const result = await extractAudio(new File(['video'],'Scene: take 2.MP4'),{format:'wav',track:2,requestId:'request-id',signal:controller.signal,onReceiving});
  const [url,options] = fetch.mock.calls[0];
  expect(url).toContain('/audio/extract'); expect(options.signal).toBe(controller.signal);
  expect(options.body.get('track')).toBe('2'); expect(options.body.get('output_format')).toBe('wav'); expect(options.body.get('request_id')).toBe('request-id');
  expect(options.body.get('file').name).toBe('Scene: take 2.MP4');
  expect(result.file.name).toBe('Scene_ take 2-audio.wav'); expect(result.file.type).toBe('audio/wav');
  expect(await result.file.text()).toBe('wave'); expect(result.info.track).toBe(2); expect(onReceiving).toHaveBeenCalledOnce();
});
it('preserves useful server errors and refuses invalid or empty downloads',async() => {
  const file = new File(['video'],'silent.mp4');
  vi.stubGlobal('fetch',vi.fn(async() => new Response(JSON.stringify({detail:'This file has no audio track.'}),{status:400})));
  await expect(extractAudio(file)).rejects.toThrow('no audio track');
  vi.stubGlobal('fetch',vi.fn(async() => new Response('<html>Error</html>',{headers:{'Content-Type':'text/html'}})));
  await expect(extractAudio(file)).rejects.toThrow('unexpected response');
  vi.stubGlobal('fetch',vi.fn(async() => new Response('',{headers:{'Content-Type':'audio/mpeg'}})));
  await expect(extractAudio(file)).rejects.toThrow('empty audio');
});
it('still returns usable audio if optional statistics are absent or invalid',async() => {
  vi.stubGlobal('fetch',vi.fn(async() => new Response('audio',{headers:{'Content-Type':'audio/mpeg','X-Audio-Extraction':'not-json'}})));
  const result = await extractAudio(new File(['video'],'clip.mp4'),{format:'mp3'});
  expect(result.info).toEqual({}); expect(result.file.size).toBe(5);
});
