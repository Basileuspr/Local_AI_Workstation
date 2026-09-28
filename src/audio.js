import { apiUrl } from './api';

export const AUDIO_ACCEPT = '.wav,.mp3,.m4a,.aac,.ogg,.flac,.webm,.mp4';
export const AUDIO_MAX_BYTES = 250 * 1024 * 1024;
export const AUDIO_RECORDING_MAX_BYTES = 25 * 1024 * 1024;
export const AUDIO_MAX_SECONDS = 600;
export const AUDIO_LANGUAGES = {auto:'Auto detect', en:'English', es:'Spanish', fr:'French', de:'German', it:'Italian', pt:'Portuguese', ja:'Japanese', ko:'Korean', zh:'Chinese', ru:'Russian', ar:'Arabic', hi:'Hindi', uk:'Ukrainian'};

export function validateAudio(file) {
  if (!file?.size) return 'Choose a nonempty audio file.';
  if (file.size > AUDIO_MAX_BYTES) return 'Audio files must be 250 MB or smaller.';
  if (!AUDIO_ACCEPT.split(',').some(ext => file.name.toLowerCase().endsWith(ext))) return 'Choose a WAV, MP3, M4A, AAC, OGG, FLAC, WebM, or MP4 audio file.';
  return '';
}

export async function audioRequest(path, options = {}) {
  const response = await fetch(apiUrl(`/audio/${path}`), options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Audio request failed (${response.status}).`);
  return data;
}

export function transcribeAudio(file, language, {diarize = false, numSpeakers = 0, modelSize = 'turbo', acceleration = 'auto', cpuAssistance = 'auto'} = {}) {
  const problem = validateAudio(file);
  if (problem) throw new Error(problem);
  const body = new FormData(); body.append('file', file); body.append('language', language);
  body.append('diarize', String(diarize)); body.append('num_speakers', String(numSpeakers));
  body.append('model_size', modelSize);
  body.append('acceleration', acceleration); body.append('cpu_assistance', cpuAssistance);
  return audioRequest('transcribe', {method:'POST', body});
}

export function audioTimestamp(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return [Math.floor(value / 3600), Math.floor(value / 60) % 60, value % 60].map(part => String(part).padStart(2, '0')).join(':');
}

export function formatAudioTranscript(result) {
  if (!result?.diarized) return result?.text || '';
  return (result.segments || []).map(turn => `[${audioTimestamp(turn.start)} – ${audioTimestamp(turn.end)}] ${turn.speaker}\n${turn.text}`).join('\n\n');
}

export function renameAudioSpeakers(text, replacements) {
  return text.replace(/^(\[[^\]\r\n]+\] )([^\r\n]+)$/gm,
    (line, timestamp, label) => Object.hasOwn(replacements, label) ? timestamp + replacements[label] : line);
}

// Capture is created only by a button press. Cancellation also handles a late
// getUserMedia result after navigating away while the permission prompt is open.
export function createAudioCapture({onRecording, onFile, onError, maxSeconds = AUDIO_MAX_SECONDS}, env = globalThis) {
  let cancelled = false, recorder, stream, timer, bytes = 0;
  const chunks = [];
  const release = () => { env.clearTimeout(timer); stream?.getTracks().forEach(track => track.stop()); };
  const stop = () => { if (recorder?.state === 'recording') recorder.stop(); release(); };
  const cancel = () => { cancelled = true; stop(); };
  const ready = (async () => {
    await Promise.resolve();
    if (cancelled) return;
    try {
      if (!env.navigator?.mediaDevices?.getUserMedia || !env.MediaRecorder) throw new Error('Microphone recording is unavailable. Use the desktop app or upload an audio file.');
      stream = await env.navigator.mediaDevices.getUserMedia({audio:true, video:false});
      if (cancelled) { release(); return; }
      const mimeType = ['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(type => env.MediaRecorder.isTypeSupported(type));
      recorder = new env.MediaRecorder(stream, mimeType ? {mimeType} : undefined);
      recorder.ondataavailable = event => {
        if (event.data.size) { chunks.push(event.data); bytes += event.data.size; }
        if (bytes > AUDIO_RECORDING_MAX_BYTES) { cancel(); onError('Recording exceeded 25 MB. Record a shorter clip.'); }
      };
      recorder.onerror = () => { cancel(); onError('Microphone recording failed. Check the selected input device and try again.'); };
      recorder.onstop = () => {
        release(); onRecording(false);
        if (cancelled) return;
        const type = recorder.mimeType || chunks[0]?.type || 'audio/webm';
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        onFile(new env.File(chunks, `Recording.${ext}`, {type}));
      };
      stream.getAudioTracks().forEach(track => { track.onended = stop; });
      recorder.start(1000); onRecording(true);
      timer = env.setTimeout(stop, Math.min(AUDIO_MAX_SECONDS, Math.max(1, Number(maxSeconds) || AUDIO_MAX_SECONDS)) * 1000);
    } catch (error) {
      release();
      if (!cancelled) onError(error.name === 'NotAllowedError' ? 'Microphone access was denied. Allow microphone access in Windows privacy settings, then retry.' : error.message);
    }
  })();
  return {ready, stop, cancel};
}
