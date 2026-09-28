import {afterEach, expect, it, vi} from 'vitest';
import {generateClonedVoice,validateVoiceReference} from '../../src/voiceCloning';
afterEach(() => vi.unstubAllGlobals());

it('requires a bounded reference audio file', () => {
  expect(validateVoiceReference(null)).toMatch('nonempty');
  expect(validateVoiceReference({name:'voice.m4a',size:12})).toBe('');
  expect(validateVoiceReference({name:'voice.m4a',size:26*1024*1024})).toMatch('25 MB');
});
it('uploads the chosen engine and reference and returns playable audio',async()=>{
  const fetch=vi.fn(async()=>new Response(new Blob(['RIFF'],{type:'audio/wav'}),{headers:{'content-type':'audio/wav','x-voice-processing':'{"device":"cuda"}'}}));
  vi.stubGlobal('fetch',fetch);
  const result=await generateClonedVoice({engine:'qwen3-tts',text:'Hello',reference:new File(['sample'],'voice.wav'),referenceText:'Sample',language:'English',acceleration:'auto'});
  const body=fetch.mock.calls[0][1].body;
  expect(body.get('engine')).toBe('qwen3-tts');expect(body.get('reference').name).toBe('voice.wav');expect(body.get('reference_text')).toBe('Sample');
  expect(result.blob.type).toBe('audio/wav');expect(result.processing.device).toBe('cuda');
});
it('does not treat an API failure as generated audio',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('{"detail":"Voice generation is busy."}',{status:409,headers:{'content-type':'application/json'}})));
  await expect(generateClonedVoice({reference:new File(['sample'],'voice.wav')})).rejects.toThrow('busy');
});
