"""Bounded media inspection, sampling and adapters to existing audio/vision."""
import asyncio
from contextlib import contextmanager
import math
import time
from uuid import uuid4

from services.request_queue import queue, prepare_runtime, QueueCancelled

PRESETS = {'quick': (12, 3), 'balanced': (36, 6), 'detailed': (120, 12), 'custom': (120, 12)}


@contextmanager
def decoder(path):
    try:
        import av
        # An already-open file and restricted demuxers cannot follow media URLs/playlists.
        with path.open('rb') as source, av.open(source, options={
            'format_whitelist': 'mov,matroska,webm,avi', 'protocol_whitelist': ''}) as media:
            if not media.streams.video: raise ValueError('This file contains no video stream.')
            stream = media.streams.video[0]
            stream.codec_context.thread_count = 2
            if stream.width * stream.height > 34000000:
                raise ValueError('Video exceeds the 34-megapixel frame limit.')
            yield media, stream
    except ImportError as exc:
        raise ValueError('Video decoder unavailable. Install the existing requirements-audio.txt runtime.') from exc


def metadata(path):
    with decoder(path) as (media, stream):
        duration = float(stream.duration * stream.time_base) if stream.duration and stream.time_base else float(media.duration or 0) / 1000000
        return {'duration': max(0, duration), 'width': stream.width, 'height': stream.height,
                'fps': float(stream.average_rate or 0), 'codec': stream.codec_context.name,
                'audio': bool(media.streams.audio), 'audio_tracks': len(media.streams.audio),
                'container': media.format.name}


def sample(path, directory, info, preset='quick', interval=10, keyframes=False, cancel=None, report=lambda _: None, thumbnail=False):
    if preset not in PRESETS or not math.isfinite(interval) or not .1 <= interval <= 3600:
        raise ValueError('Choose a workload and an interval between 0.1 and 3,600 seconds.')
    duration = info['duration']
    if not 0 < duration <= 24 * 60 * 60:
        raise ValueError('Sampling needs a known duration of at most 24 hours.')
    limit = PRESETS[preset][0]
    step = max(interval if preset == 'custom' else duration / limit, duration / limit, .1)
    targets = [index * step for index in range(min(limit, math.ceil(duration / step)))]
    if thumbnail: targets = [0]
    frames = []; seen = set(); started = time.monotonic(); created = []
    def check():
        if cancel and cancel.is_set(): raise QueueCancelled('Video sampling cancelled.')
        if time.monotonic() - started > 180: raise ValueError('Frame sampling exceeded three minutes. Try Quick Scan or a shorter video.')
    try:
        with decoder(path) as (media, stream):
            start = float((stream.start_time or 0) * stream.time_base)
            if keyframes: stream.codec_context.skip_frame = 'NONKEY'
            for index, target in enumerate(targets):
                check(); report(f'Sampling frame {index + 1} of {len(targets)}')
                media.seek(int((start + target) / stream.time_base), stream=stream, backward=True, any_frame=False)
                for decoded in media.decode(stream):
                    check()
                    if decoded.width * decoded.height > 34000000: raise ValueError('Decoded video frame exceeds the pixel limit.')
                    stamp = float(decoded.pts * stream.time_base) - start if decoded.pts is not None else target
                    if not keyframes and stamp + .001 < target: continue
                    stamp = max(0, stamp)
                    if round(stamp, 5) in seen: break
                    seen.add(round(stamp, 5))
                    identifier = uuid4().hex + '.jpg'; output = directory / identifier
                    picture = decoded.to_image()
                    try:
                        picture.thumbnail((1280, 720)); picture.save(output, 'JPEG', quality=82)
                    finally: picture.close()
                    created.append(output)
                    frames.append({'id': identifier, 'time': round(stamp, 5), 'keyframe': bool(decoded.key_frame), 'observation': ''})
                    break
        if not frames: raise ValueError('The decoder could not produce any frames.')
        note = 'Sampled frames can miss events between timestamps.'
        if keyframes:
            note += (f' Extracted {len(frames)} unique codec keyframe(s). These are compression keyframes, not scene changes; '
                     'a long clip may contain only one. Turn off Keyframes only to sample across the video.')
        return {'frames': frames, 'interval': step, 'requested_interval': interval if preset == 'custom' else None,
                'sampling': 'keyframes' if keyframes else 'timed', 'note': note}
    except BaseException:
        for output in created: output.unlink(missing_ok=True)
        raise


async def vision(frames, directory, model, limit, cancel, report, focus='', transcript=None, analysis=None):
    from services import video_analysis
    from config import settings
    import httpx
    if not model: raise ValueError('Choose an installed vision model first.')
    if not frames: raise ValueError('No sampled frames are available for analysis.')
    analysis = analysis if analysis is not None else {}
    analysis.update(status='running', model=model, focus=focus, observations=[], summary='',
                    note='Based on sampled stills; events between samples may be missed.')
    job = queue.enqueue('video-vision', 'Video: selected frame observations', model=model)
    failure = None; acquired = False
    async def monitor():
        while True:
            if cancel.is_set(): await queue.cancel(job); return
            if job.cancel_event.is_set(): cancel.set(); return
            await asyncio.sleep(.2)
    watcher = asyncio.create_task(monitor())
    try:
        await queue.wait(job)
        acquired = True
        if cancel.is_set() or job.cancel_event.is_set(): raise QueueCancelled('Vision stopped.')
        await prepare_runtime('analysis')
        async with httpx.AsyncClient(timeout=15, trust_env=False) as client:
            info = await client.post(settings.ollama_base_url + '/api/show', json={'model': model})
            info.raise_for_status()
            if 'vision' not in info.json().get('capabilities', []): raise ValueError('Choose an installed vision-capable model.')
        count = min(limit, len(frames))
        chosen = [frames[round(i * (len(frames) - 1) / max(1, count - 1))] for i in range(count)]
        for index, frame in enumerate(chosen):
            if cancel.is_set() or job.cancel_event.is_set(): raise QueueCancelled('Vision stopped.')
            report(f'Analyzing frame {index + 1} of {count} at {frame["time"]:.1f}s')
            frame['observation'] = await video_analysis.describe((directory / frame['id']).read_bytes(), model, cancel, frame['time'], focus)
            frame['model'] = model
            analysis['observations'].append({'id': frame['id'], 'time': frame['time'], 'text': frame['observation']})
        report('Writing video summary and comparing observations…')
        analysis['summary'] = await video_analysis.summarize(analysis['observations'], model, cancel, focus, transcript)
        analysis['status'] = 'complete'
        return analysis
    except BaseException as exc:
        analysis['status'] = 'cancelled' if isinstance(exc, (QueueCancelled, asyncio.CancelledError)) else 'failed'
        failure = str(exc); raise
    finally:
        watcher.cancel()
        await asyncio.gather(watcher, return_exceptions=True)
        if acquired:
            try:
                async with httpx.AsyncClient(timeout=30, trust_env=False) as client:
                    await client.post(settings.ollama_base_url + '/api/generate', json={'model': model, 'keep_alive': 0})
            finally: queue.finish(job, failure)
        else: queue.finish(job, failure)


def extract_audio(path, directory, cancel):
    from services import audio_extraction
    target = directory / (uuid4().hex + '.m4a')
    try:
        audio_extraction.extract(path, target, 'm4a', 0, uuid4().hex, cancel)
        return target
    except BaseException:
        target.unlink(missing_ok=True); raise


def transcribe(path, model_size='base'):
    from services import audio
    if not audio.status()['models'].get(model_size, {}).get('ready'):
        raise ValueError('This transcription model is not installed. Set it up in Audio, or use metadata/frame extraction.')
    # Existing Whisper service retains its bounded CPU model cache and chunking.
    return audio.transcribe(path, model_size=model_size, acceleration='cpu')
