import {apiUrl} from './api';
import {validateAudio} from './audio';

export const VOICE_ENGINES = {'omnivoice':'OmniVoice', 'chatterbox-turbo':'Chatterbox Turbo', 'qwen3-tts':'Qwen3-TTS 0.6B Base'};
export const VOICE_LANGUAGES = ['English','Chinese','Japanese','Korean','German','French','Russian','Portuguese','Spanish','Italian'];
export const VOICE_DEMO_TEXT = {
  English:'Hello! This is my cloned voice. I can now create speech in the Audio workspace.',
  Chinese:'你好！这是我克隆的声音。我现在可以在音频工作区中生成语音了。',
  Japanese:'こんにちは！これは私のクローン音声です。オーディオワークスペースで音声を作成できるようになりました。',
  Korean:'안녕하세요! 이것은 제 복제된 목소리입니다. 이제 오디오 작업 공간에서 음성을 만들 수 있습니다.',
  German:'Hallo! Das ist meine geklonte Stimme. Ich kann jetzt im Audiobereich Sprache erzeugen.',
  French:'Bonjour ! Voici ma voix clonée. Je peux maintenant créer de la parole dans mon espace audio.',
  Russian:'Привет! Это моя клонированная речь. Теперь я могу создавать речь в аудиостудии.',
  Portuguese:'Olá! Esta é a minha voz clonada. Agora posso criar fala no espaço de áudio.',
  Spanish:'¡Hola! Esta es mi voz clonada. Ahora puedo crear voz en el espacio de audio.',
  Italian:'Ciao! Questa è la mia voce clonata. Ora posso creare un parlato nello spazio audio.',
};

export function validateVoiceReference(file) {
  return validateAudio(file) || (file.size > 25 * 1024 * 1024 ? 'Reference recordings must be 25 MB or smaller.' : '');
}

export async function generateClonedVoice({engine, text, reference, referenceText, language, acceleration}) {
  const problem = validateVoiceReference(reference);
  if (problem) throw new Error(problem);
  const body = new FormData();
  for (const [key,value] of Object.entries({engine,text,reference,reference_text:referenceText,language,acceleration})) body.append(key,value);
  const response = await fetch(apiUrl('/audio/voices/synthesize'), {method:'POST',body});
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === 'string' ? error.detail : 'Voice generation failed.');
  }
  if (!response.headers.get('content-type')?.includes('audio/wav')) throw new Error('The voice engine returned an unexpected response.');
  let processing = {};
  try { processing = JSON.parse(response.headers.get('x-voice-processing') || '{}'); } catch { /* Audio is still usable. */ }
  return {blob:await response.blob(), processing, engine};
}
