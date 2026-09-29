import {apiUrl} from './api';

export const MEDIA_AUDIO_ACCEPT = '.mp4,.m4v,.mov,.mkv,.webm,.avi,.wmv,.flv,.mpg,.mpeg,.ts,.mts,.m2ts,.3gp,.3g2,.vob,.ogv,.mxf,.wav,.mp3,.m4a,.aac,.ogg,.oga,.flac,.opus,.wma,.aif,.aiff,.ac3,.mka,.amr,.caf';
export const EXTRACTION_FORMATS = {mp3:'MP3 · compact',wav:'WAV · uncompressed',m4a:'M4A · compact',flac:'FLAC · compressed PCM'};
export const EXTRACTION_MAX_BYTES = 2 * 1024 ** 3;

export function validateExtractionInput(file) {
  if (!file?.size) return 'Choose a nonempty video or audio file.';
  if (file.size > EXTRACTION_MAX_BYTES) return 'Video and audio inputs must be 2 GB or smaller.';
  if (!MEDIA_AUDIO_ACCEPT.split(',').some(ext => file.name.toLowerCase().endsWith(ext))) return 'Choose a supported video or audio file, such as MP4, MOV, MKV, WebM, MP3, or WAV.';
  return '';
}

export async function extractAudio(file, {format = 'mp3',track = 1,requestId,signal,onReceiving} = {}) {
  const problem = validateExtractionInput(file);
  if (problem) throw new Error(problem);
  const body = new FormData();
  body.append('file',file); body.append('output_format',format); body.append('track',String(track)); body.append('request_id',requestId);
  const response = await fetch(apiUrl('/audio/extract'),{method:'POST',body,signal});
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === 'string' ? error.detail : 'Audio extraction failed. Try another file.');
  }
  if (!response.headers.get('content-type')?.startsWith('audio/')) throw new Error('The extractor returned an unexpected response.');
  onReceiving?.();
  let info = {};
  try {info = JSON.parse(response.headers.get('x-audio-extraction') || '{}');} catch { /* Audio remains usable without optional statistics. */ }
  const blob = await response.blob();
  if (!blob.size) throw new Error('The extractor returned empty audio. Try another file.');
  const stem = file.name.replace(/\.[^.]+$/,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,100).trim() || 'Extracted';
  return {file:new File([blob],`${stem}-audio.${format}`,{type:blob.type}),info,sourceName:file.name};
}
