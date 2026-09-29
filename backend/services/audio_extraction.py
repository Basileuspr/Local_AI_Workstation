"""Bounded local audio extraction; video frames and source metadata are omitted."""
from functools import lru_cache
from fractions import Fraction
from pathlib import Path
import threading
import time

from services.audio import AudioError

MAX_INPUT_BYTES = 2 * 1024**3
MAX_OUTPUT_BYTES = 250 * 1024**2
MAX_SECONDS = 2 * 60 * 60
TIMEOUT_SECONDS = 15 * 60
EXTENSIONS = {
    '.mp4','.m4v','.mov','.mkv','.webm','.avi','.wmv','.flv','.mpg','.mpeg',
    '.ts','.mts','.m2ts','.3gp','.3g2','.vob','.ogv','.mxf',
    '.wav','.mp3','.m4a','.aac','.ogg','.oga','.flac','.opus','.wma','.aif','.aiff','.ac3','.mka','.amr','.caf',
}
DEMUXERS = 'mov,matroska,webm,avi,asf,flv,mpeg,mpegts,ogg,mxf,wav,mp3,aac,flac,aiff,ac3,amr,caf'
FORMATS = {
    'mp3': {'codec':'libmp3lame','container':'mp3','sample_format':'s16p','mime':'audio/mpeg'},
    'wav': {'codec':'pcm_s16le','container':'wav','sample_format':'s16','mime':'audio/wav'},
    'm4a': {'codec':'aac','container':'ipod','sample_format':'fltp','mime':'audio/mp4'},
    'flac': {'codec':'flac','container':'flac','sample_format':'s16','mime':'audio/flac'},
}
_lock = threading.Lock()
_progress = None


@lru_cache(maxsize=1)
def available_formats():
    try:
        import av
        available = []
        for name,spec in FORMATS.items():
            try:
                av.codec.Codec(spec['codec'], 'w')
                available.append(name)
            except (ValueError, RuntimeError):
                pass
        return available
    except (ImportError, OSError):
        return []


def status():
    return {'formats':available_formats(), 'busy':_lock.locked(), 'progress':_progress,
            'max_input_bytes':MAX_INPUT_BYTES,'max_output_bytes':MAX_OUTPUT_BYTES,'max_seconds':MAX_SECONDS}


def extract(source: Path, destination: Path, output_format: str, track: int, request_id: str, cancelled: threading.Event):
    global _progress
    if output_format not in FORMATS:
        raise AudioError('Choose MP3, WAV, M4A, or FLAC output.')
    if output_format not in available_formats():
        raise AudioError('Audio extraction runtime unavailable. Install requirements-audio.txt with the app Python, then restart.',503)
    if not _lock.acquire(blocking=False):
        raise AudioError('Audio extraction is busy. Wait for the current file to finish.',409)
    started = time.monotonic()
    spec = FORMATS[output_format]
    _progress = {'request_id':request_id,'stage':'Opening media','processed_seconds':0,'duration_seconds':None}
    try:
        import av
        def check():
            if cancelled.is_set():
                raise AudioError('Audio extraction cancelled.',499)
            if time.monotonic()-started > TIMEOUT_SECONDS:
                raise AudioError('Extraction exceeded 15 minutes. Try a shorter file.',504)
            if destination.exists() and destination.stat().st_size > MAX_OUTPUT_BYTES:
                raise AudioError('Extracted audio exceeds 250 MB. Choose MP3 or M4A, or use a shorter file.',413)
        check()
        with source.open('rb') as handle, av.open(handle, options={'format_whitelist':DEMUXERS,'protocol_whitelist':''}) as incoming:
            streams = list(incoming.streams.audio)
            if not streams:
                raise AudioError('This file has no audio track. Choose a video with sound.')
            if not 0 <= track < len(streams):
                raise AudioError(f'This file has {len(streams)} audio track(s). Choose a track from 1 to {len(streams)}.')
            stream = streams[track]
            stream.codec_context.thread_count = 2
            estimate = float(stream.duration * stream.time_base) if stream.duration and stream.time_base else (incoming.duration / av.time_base if incoming.duration else None)
            if estimate and estimate > MAX_SECONDS + 1:
                raise AudioError('Use a video or audio file of 2 hours or less.',413)
            # Preserve ordinary mono/stereo and 44.1/48 kHz. Surround is mixed
            # down for portable playback, and exotic sample rates become 48 kHz.
            rate = stream.codec_context.sample_rate or 48000
            if rate not in {8000,11025,12000,16000,22050,24000,32000,44100,48000}:
                rate = 48000
            layout = 'mono' if stream.codec_context.channels == 1 else 'stereo'
            samples = 0
            last_report = 0
            with av.open(str(destination),'w',format=spec['container']) as outgoing:
                encoded = outgoing.add_stream(spec['codec'],rate=rate)
                encoded.layout = layout
                encoded.codec_context.thread_count = 2
                encoded.codec_context.format = spec['sample_format']
                if output_format == 'mp3':
                    encoded.bit_rate = 192000 if rate >= 32000 else 96000 if rate >= 16000 else 48000
                elif output_format == 'm4a':
                    encoded.bit_rate = min(192000,rate * 5 * (1 if layout == 'mono' else 2))
                resampler = av.AudioResampler(format=spec['sample_format'],layout=layout,rate=rate)
                def write(frame):
                    nonlocal samples,last_report
                    global _progress
                    check()
                    frame.pts = samples
                    frame.time_base = Fraction(1,rate)
                    samples += frame.samples
                    if samples > MAX_SECONDS * rate:
                        raise AudioError('Use a video or audio file of 2 hours or less.',413)
                    for packet in encoded.encode(frame):
                        outgoing.mux(packet)
                    if time.monotonic()-last_report >= .25:
                        last_report = time.monotonic()
                        _progress = {'request_id':request_id,'stage':'Extracting audio','processed_seconds':round(samples/rate,1),'duration_seconds':estimate}
                # Selecting the stream here means video frames are never decoded.
                for frame in incoming.decode(stream):
                    check()
                    frame.pts = None
                    for converted in resampler.resample(frame):
                        write(converted)
                for converted in resampler.resample(None):
                    write(converted)
                for packet in encoded.encode(None):
                    outgoing.mux(packet)
            check()
            if not samples:
                raise AudioError('The selected audio track is empty.')
            return {'format':output_format,'duration':round(samples/rate,3),'sample_rate':rate,
                    'channels':1 if layout == 'mono' else 2,'track':track+1,'audio_tracks':len(streams),
                    'source_codec':stream.codec_context.name,'bytes':destination.stat().st_size,
                    'seconds':round(time.monotonic()-started,2)}
    except AudioError:
        raise
    except Exception as exc:
        raise AudioError('Could not extract audio. The file may be damaged, protected, or use an unsupported codec.') from exc
    finally:
        _progress = None
        _lock.release()
