export const PLAYBACK_MAX_SECONDS = 300;
export const PLAYBACK_MAX_BYTES = 64 * 1024 ** 2;
export const PLAYBACK_SIGNAL_THRESHOLD = 0.00025;

export function playbackAvailability(env = globalThis) {
  if (!env.workstationDesktop?.requestPlaybackCapture || !env.workstationDesktop?.cancelPlaybackCapture) {
    return 'Recording requires the Windows desktop app. Browser preview cannot capture playback.';
  }
  if (!env.workstationDesktop?.playbackCaptureStatus) return 'Restart the desktop app to load the updated playback recorder.';
  if (!env.navigator?.mediaDevices?.getDisplayMedia || !env.MediaRecorder || !env.MediaStream) {
    return 'Playback recording is unavailable in this window. Restart the Windows desktop app.';
  }
  return '';
}

export function playbackCaptureError(error, source = 'system') {
  if (error?.name === 'InvalidStateError') return 'Click Start playback recording while this desktop window is active and the desktop is unlocked.';
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return 'Playback access was denied. Fully restart the desktop app, then click Start playback recording again.';
  if (error?.name === 'NotFoundError') return 'Windows did not provide a capture source. Keep the desktop unlocked and retry.';
  if (error?.name === 'NotReadableError') return source === 'spotify'
    ? 'The embedded player audio could not start. Reopen its player, press Play, then retry.'
    : 'Windows could not open system playback audio. Check Sound settings and Volume mixer: use the same default output for Spotify and this app. Try another output and retry, or choose Embedded Spotify player as the recording source.';
  return error?.message || 'Playback recording failed. Stop playback preview and try again.';
}

export function playbackSignal(samples) {
  let sum = 0, peak = 0;
  for (const sample of samples) { sum += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return {rms, level: Math.min(1, peak), audible: rms >= PLAYBACK_SIGNAL_THRESHOLD};
}

// No microphone request or audio-to-speaker connection. Keep the recording in
// memory until the user explicitly saves it. Cancellation also owns late streams.
export function createPlaybackCapture({source = 'system', onRecording, onFile, onError, onSignal,
  maxSeconds = PLAYBACK_MAX_SECONDS}, env = globalThis) {
  let cancelled = false, finished = false, stream, recorder, context, audioSource, analyser, monitor, timer;
  let bytes = 0, signalDetected = false, signalMonitored = false, reason = 'stopped', started = 0;
  const chunks = [];
  const revoke = () => { try { Promise.resolve(env.workstationDesktop?.cancelPlaybackCapture?.()).catch(() => {}); } catch {} };
  const release = () => {
    env.clearInterval(monitor); env.clearTimeout(timer);
    stream?.getTracks().forEach(track => track.stop());
    audioSource?.disconnect(); analyser?.disconnect();
    if (context) { try { Promise.resolve(context.close()).catch(() => {}); } catch {} context = null; }
  };
  function stop() {
    if (finished) return;
    if (!recorder || !started) { cancelled = true; revoke(); release(); return; }
    if (recorder.state !== 'inactive') recorder.stop();
    release();
  }
  function cancel() { cancelled = true; revoke(); if (recorder) stop(); else release(); }
  const ready = (async () => {
    await Promise.resolve();
    if (cancelled) return;
    try {
      const unavailable = playbackAvailability(env);
      if (unavailable) throw Error(unavailable);
      if (!['system', 'spotify'].includes(source)) throw Error('Choose a playback recording source.');
      const grant = await env.workstationDesktop.requestPlaybackCapture({source});
      if (cancelled) return;
      if (!grant?.ready) throw Error(grant?.error || 'The desktop did not authorize playback capture. Restart it and retry.');
      stream = await env.navigator.mediaDevices.getDisplayMedia({video: {frameRate: 1},
        audio: {echoCancellation: false, noiseSuppression: false, autoGainControl: false}, systemAudio: 'include'});
      if (cancelled) { release(); return; }
      const tracks = stream.getAudioTracks().filter(track => track.readyState !== 'ended');
      if (!tracks.length) throw Error('No playback audio track was provided. Try another Windows output, or the embedded Spotify player source.');
      // DisplayMedia requires video; the recorder receives only audio. Release the
      // unused video track immediately, rather than capturing the screen for 5 min.
      stream.getVideoTracks().forEach(track => track.stop());
      const audio = new env.MediaStream(tracks);
      const mime = ['audio/webm;codecs=opus', 'audio/webm'].find(type => env.MediaRecorder.isTypeSupported(type));
      recorder = new env.MediaRecorder(audio, mime ? {mimeType: mime} : undefined);
      recorder.ondataavailable = event => {
        if (event.data.size) { chunks.push(event.data); bytes += event.data.size; }
        if (bytes >= PLAYBACK_MAX_BYTES) { reason = 'size-limit'; stop(); }
      };
      recorder.onerror = () => { cancel(); onError?.('Playback recording failed. The previous recording is still available. Retry with another recording source.'); };
      recorder.onstop = () => {
        if (finished) return;
        finished = true; release(); onRecording?.(false);
        if (cancelled) return;
        if (!chunks.length) { onError?.('No audio data was recorded. Start playback before recording and try again.'); return; }
        const blob = new env.Blob(chunks, {type: recorder.mimeType || 'audio/webm'});
        onFile?.(blob, {source, signalDetected, signalMonitored, reason, seconds: (Date.now() - started) / 1000});
      };
      tracks.forEach(track => track.addEventListener('ended', () => { reason = 'source-ended'; stop(); }, {once: true}));
      if (env.AudioContext) {
        try {
          context = new env.AudioContext(); analyser = context.createAnalyser(); analyser.fftSize = 2048;
          audioSource = context.createMediaStreamSource(audio); audioSource.connect(analyser);
          await context.resume();
          if (cancelled) { release(); return; }
          const samples = new Float32Array(analyser.fftSize);
          monitor = env.setInterval(() => {
            analyser.getFloatTimeDomainData(samples);
            const signal = playbackSignal(samples); signalDetected ||= signal.audible;
            signalMonitored = true;
            onSignal?.({...signal, signalDetected, monitored: true});
          }, 250);
        } catch { onSignal?.({level: 0, signalDetected: false, monitored: false}); }
      } else onSignal?.({level: 0, signalDetected: false, monitored: false});
      if (cancelled) { release(); return; }
      started = Date.now(); recorder.start(1000); onRecording?.(true);
      timer = env.setTimeout(() => { reason = 'time-limit'; stop(); }, Math.min(PLAYBACK_MAX_SECONDS, Math.max(1, Number(maxSeconds) || PLAYBACK_MAX_SECONDS)) * 1000);
    } catch (error) {
      const wasCancelled = cancelled;
      cancelled = true; if (recorder?.state === 'recording') recorder.stop(); release(); onRecording?.(false);
      if (!wasCancelled) {
        let detail = playbackCaptureError(error, source);
        try { const status = await env.workstationDesktop?.playbackCaptureStatus?.(); detail = status?.error || detail; } catch {}
        onError?.(detail);
      }
    } finally { revoke(); }
  })();
  return {ready, stop, cancel};
}
