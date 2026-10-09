"""Native-only verification of authenticated browser media; no remote fetching.

The browser owns network/session authority. This service accepts a random
workflow ID, never a caller-selected filesystem path, URL, header or cookie.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import threading
import time

from services import local_video
from services.request_queue import QueueCancelled

MAX_BYTES = 256 * 1024**2
MAX_CACHE_BYTES = 512 * 1024**2
_running = {}
_lock = threading.RLock()


def directory(identifier):
    if not re.fullmatch(r'[a-f0-9]{32}', identifier):
        raise ValueError('Invalid browser media reference.')
    configured = os.environ.get('LAW_BROWSER_WORKFLOW_DIR')
    if not configured:
        raise ValueError('Browser workflow storage is unavailable.')
    root = Path(configured)
    target = root / identifier
    if any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (root, target)):
        raise ValueError('Browser media cannot use linked directories.')
    root = root.resolve(strict=True)
    target = target.resolve(strict=True)
    if target.parent != root:
        raise ValueError('Browser media escapes workflow storage.')
    return target


def asset(identifier, kind, *, verified=True):
    names = {'video': 'video.bin', 'audio': 'audio.m4a', 'captions': 'captions.json'}
    if kind not in names:
        raise ValueError('Browser media asset not found.')
    folder = directory(identifier)
    if verified:
        manifest = folder / 'verified.json'
        if manifest.is_symlink() or not manifest.is_file() or manifest.stat().st_size > 16000:
            raise ValueError('Browser media has not completed verification.')
        record = json.loads(manifest.read_text(encoding='utf8'))
        if record.get('completeness') != 'complete':
            raise ValueError('Browser media has not completed verification.')
    file = folder / names[kind]
    if file.is_symlink() or not file.is_file() or file.resolve().parent != folder:
        raise ValueError('Browser media asset is unavailable. Reacquire it in Browser.')
    return file


def resolve_reference(reference):
    match = re.fullmatch(r'browser-media:([a-f0-9]{32}):(video|audio|captions)', reference)
    if not match:
        raise ValueError('Invalid browser media reference.')
    return asset(*match.groups())


def register(identifier):
    with _lock:
        if identifier in _running:
            raise ValueError('Browser media is already being verified.')
        cancel = threading.Event()
        _running[identifier] = cancel
        return cancel


def cancel(identifier):
    with _lock:
        event = _running.get(identifier)
        if event:
            event.set()
        return bool(event)


def release(identifier):
    with _lock:
        _running.pop(identifier, None)


def verify(identifier, expected, cancel, report=lambda _: None):
    folder = directory(identifier)
    source = asset(identifier, 'video', verified=False)
    audio = folder / 'audio.m4a'
    started = time.monotonic()

    def check():
        if cancel.is_set():
            raise QueueCancelled('Browser media verification cancelled.')
        if time.monotonic() - started > 100:
            raise ValueError('Browser media verification timed out.')

    try:
        check()
        if not 0 < source.stat().st_size <= MAX_BYTES or source.stat().st_size != expected['bytes']:
            raise ValueError('Incomplete browser media transfer.')
        digest = hashlib.sha256()
        with source.open('rb') as handle:
            while chunk := handle.read(1024 * 1024):
                check(); digest.update(chunk)
        if digest.hexdigest() != expected['sha256']:
            raise ValueError('Browser media changed before verification.')
        info = local_video.metadata(source)
        if not 0 < info['duration'] <= 600 or abs(info['duration'] - expected['duration']) > max(.5, expected['duration'] * .01):
            raise ValueError('Browser video duration does not match the selected media.')
        report('Decoding the complete video and audio')
        video_frames = 0
        ends = {}
        audio_seconds = {}
        with local_video.decoder(source) as (media, stream):
            streams = [stream, *list(media.streams.audio)]
            for s in streams:
                s.codec_context.thread_count = 2
                s.codec_context.options = {'err_detect': 'explode'}
            # Demux the entire file, including audio. Sampling a few frames or
            # reading container metadata does not establish completeness.
            for packet in media.demux(streams):
                check()
                s = packet.stream
                for frame in packet.decode():
                    check()
                    if s.type == 'video':
                        video_frames += 1
                        if frame.width * frame.height > 34000000:
                            raise ValueError('Browser video exceeds the frame size limit.')
                    length = frame.samples / frame.sample_rate if s.type == 'audio' else 1 / (info['fps'] or 30)
                    if s.type == 'audio':
                        audio_seconds[s.index] = audio_seconds.get(s.index, 0) + length
                        if audio_seconds[s.index] > 601:
                            raise ValueError('Browser audio exceeds the ten-minute acquisition limit.')
                    if frame.pts is not None and frame.time_base:
                        start = float((s.start_time or 0) * s.time_base)
                        ends[s.index] = max(ends.get(s.index, 0), float(frame.pts * frame.time_base) - start + length)
            for s in streams:
                duration = float(s.duration * s.time_base) if s.duration and s.time_base else info['duration']
                tolerance = max(.25, 2 / (info['fps'] or 30)) if s.type == 'video' else .25
                if ends.get(s.index, 0) < duration - tolerance:
                    raise ValueError('The selected media has an incomplete video or audio stream.')
                if ends.get(s.index, 0) > info['duration'] + .5:
                    raise ValueError('The decoded media exceeds its advertised duration.')
        if not video_frames:
            raise ValueError('The selected media contains no decodable video.')
        check()
        audio_ref = None
        if info['audio']:
            if info['audio_tracks'] != 1:
                raise ValueError('Multiple audio tracks require an explicit acquisition adapter.')
            report('Extracting the complete audio with the existing audio service')
            extracted = local_video.extract_audio(source, folder, cancel)
            check()
            extracted.replace(audio)
            audio_ref = f'browser-media:{identifier}:audio'
        captions = json.loads(asset(identifier, 'captions', verified=False).read_text(encoding='utf8'))
        if captions.get('status') not in {'complete', 'absent'} or not isinstance(captions.get('tracks'), list):
            raise ValueError('Browser caption acquisition is incomplete.')
        if sum(p.stat().st_size for p in folder.iterdir() if p.is_file()) > MAX_CACHE_BYTES:
            raise ValueError('Browser media exceeds the workspace size limit.')
        check()
        result = {'completeness': 'complete', 'videoRef': f'browser-media:{identifier}:video',
                'audioRef': audio_ref, 'captionRef': f'browser-media:{identifier}:captions',
                'audio': 'complete' if audio_ref else 'absent', 'metadata': info,
                'sha256': digest.hexdigest(), 'decodedFrames': video_frames}
        pending = folder / 'verified.json.pending'
        pending.write_text(json.dumps(result), encoding='utf8')
        pending.replace(folder / 'verified.json')
        return result
    except BaseException:
        (folder / 'verified.json').unlink(missing_ok=True)
        (folder / 'verified.json.pending').unlink(missing_ok=True)
        audio.unlink(missing_ok=True)
        # extract_audio cleans its own partial outputs; cancellation at the
        # worker boundary can leave a completed random-name extraction.
        for output in folder.glob('*.m4a'):
            output.unlink(missing_ok=True)
        raise
