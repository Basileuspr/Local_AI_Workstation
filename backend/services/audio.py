"""Optional local transcription with bounded CPU work and coordinated CUDA."""
from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import threading
import time
from contextlib import ExitStack, closing
from tempfile import TemporaryDirectory
from pathlib import Path

from config import settings
from services import speaker_diarization, audio_acceleration

MODEL_DIR = settings.models_dir / "audio" / "whisper-base"
SMALL_MODEL_DIR = settings.models_dir / "audio" / "whisper-small"
TURBO_MODEL_DIR = settings.models_dir / "audio" / "whisper-turbo"
MODELS = {'turbo': ('Whisper large-v3 Turbo · accuracy + GPU speed', 1600),
          'small': ('Whisper small · lighter CPU option', 500), 'base': ('Whisper base · lowest memory', 150)}
MAX_BYTES = 250 * 1024 * 1024
MAX_SECONDS = 2 * 60 * 60
SAMPLE_RATE = 16000
CHUNK_SECONDS = 8 * 60
OVERLAP_SECONDS = 2
LANGUAGES = {"auto", "en", "es", "fr", "de", "it", "pt", "ja", "ko", "zh", "ru", "ar", "hi", "uk"}
EXTENSIONS = {".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac", ".webm", ".mp4"}
_lock = threading.Lock()
_model = None
_model_path = None
_model_key = None
_progress = None


class AudioError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def model_directory(model_size):
    if model_size not in MODELS:
        raise AudioError('Choose a supported transcription model: base, small, or turbo.')
    return {'base':MODEL_DIR, 'small':SMALL_MODEL_DIR, 'turbo':TURBO_MODEL_DIR}[model_size]


def model_ready(directory):
    return all((directory / name).is_file() for name in ('model.bin', 'config.json', 'tokenizer.json'))


def status():
    installed = importlib.util.find_spec("faster_whisper") is not None
    ready = model_ready(MODEL_DIR)
    return {"installed": installed, "model_ready": ready, "ready": installed and ready,
            "busy": _lock.locked(), "model": "Whisper base (multilingual, CPU)",
            "max_bytes": MAX_BYTES, "max_seconds": MAX_SECONDS, "progress": _progress,
            "speakers": speaker_diarization.status(),
            "cuda_available": audio_acceleration.cuda_available(),
            "models": {key: {'model': label, 'download_mb': size,
                'model_ready': model_ready(model_directory(key)),
                'ready': installed and model_ready(model_directory(key))} for key, (label, size) in MODELS.items()}}


def _runtime():
    try:
        from faster_whisper import WhisperModel
        return WhisperModel
    except (ImportError, OSError) as exc:
        raise AudioError("Audio runtime unavailable. Install requirements-audio.txt with the app's Python, then restart the app.", 503) from exc


def setup(model_size='base'):
    global _model, _model_path, _model_key
    directory = model_directory(model_size)
    if not _lock.acquire(blocking=False):
        raise AudioError("Audio is busy. Wait for the current operation to finish.", 409)
    try:
        cls = _runtime()
        directory.mkdir(parents=True, exist_ok=True)
        # The app normally runs with Hugging Face offline. Enable downloads
        # only in this explicit setup subprocess, never in the shared server.
        subprocess.run([
            sys.executable, '-c',
            'import sys; from faster_whisper.utils import download_model; download_model(sys.argv[2], output_dir=sys.argv[1])',
            str(directory), model_size,
        ], env={**os.environ, 'HF_HUB_OFFLINE': '0'}, capture_output=True, text=True,
            timeout=600, check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        _model = cls(str(directory), device="cpu", compute_type="int8", cpu_threads=4, local_files_only=True)
        _model_path = directory
        _model_key = (directory, 'cpu', 4, 1)
    except AudioError:
        raise
    except Exception as exc:
        raise AudioError("Model setup failed. Check your internet connection and free disk space, then retry setup.", 503) from exc
    finally:
        _lock.release()
    return status()


def setup_speakers():
    if not _lock.acquire(blocking=False):
        raise AudioError('Audio is busy. Wait for the current operation to finish.', 409)
    try:
        speaker_diarization.setup()
    except speaker_diarization.SpeakerError as exc:
        raise AudioError(str(exc), exc.status) from exc
    finally:
        _lock.release()
    return status()


def iter_audio_chunks(path):
    """Decode into bounded buffers, counting samples rather than trusting metadata.

    Adjacent chunks overlap by two seconds. Each owns half of the overlap;
    word timestamps determine which text is retained at a join.
    """
    import av
    import numpy as np
    samples = 0
    capacity = int(CHUNK_SECONDS * SAMPLE_RATE)
    overlap = int(OVERLAP_SECONDS * SAMPLE_RATE)
    buffer = np.empty(capacity, dtype=np.int16)
    used = offset = 0

    def chunk(last):
        start = offset / SAMPLE_RATE
        end = (offset + used) / SAMPLE_RATE
        return {"audio": buffer[:used].astype(np.float32) / 32768.0,
                "start": start, "end": end,
                "keep_start": start + (OVERLAP_SECONDS / 2 if offset else 0),
                "keep_end": end - (0 if last else OVERLAP_SECONDS / 2)}

    try:
        with Path(path).open('rb') as handle, av.open(handle, options={
            'format_whitelist': 'wav,mp3,mov,aac,ogg,flac,matroska,webm',
            'protocol_whitelist': '',
        }) as source:
            if not source.streams.audio:
                raise AudioError("This file has no audio track.")
            resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)

            def decoded_arrays():
                # Only decoder time counts; transcription pauses this iterator.
                decoding_time = 0
                frames = iter(source.decode(audio=0))
                while True:
                    started = time.monotonic()
                    try:
                        frame = next(frames)
                    except StopIteration:
                        break
                    frame.pts = None
                    outputs = resampler.resample(frame)
                    decoding_time += time.monotonic() - started
                    if decoding_time > 120:
                        raise AudioError("Audio decoding took too long. Try converting the file to WAV or MP3.")
                    for output in outputs:
                        yield output.to_ndarray().reshape(-1)
                for output in resampler.resample(None):
                    yield output.to_ndarray().reshape(-1)

            for values in decoded_arrays():
                samples += len(values)
                if samples > MAX_SECONDS * SAMPLE_RATE:
                    raise AudioError("Audio uploads must be 2 hours or shorter.", 413)
                while len(values):
                    if used == capacity:
                        yield chunk(last=False)
                        buffer[:overlap] = buffer[used - overlap:used]
                        offset += used - overlap
                        used = overlap
                    take = min(capacity - used, len(values))
                    buffer[used:used + take] = values[:take]
                    used += take
                    values = values[take:]
            if not samples:
                raise AudioError("The audio file is empty.")
            yield chunk(last=True)
    except AudioError:
        raise
    except Exception as exc:
        raise AudioError("Could not decode this audio. Try a valid WAV, MP3, M4A, OGG, FLAC, or WebM file.") from exc


def retained_segments(segments, chunk, keep_words=False):
    """Trim overlapping words and retain original recording timestamps."""
    rows = []
    start, low, high = chunk['start'], chunk['keep_start'], chunk['keep_end']
    for segment in segments:
        words = getattr(segment, 'words', None)
        if words:
            kept = [word for word in words if low <= start + (word.start + word.end) / 2 < high]
            if not kept:
                continue
            text = ''.join(word.word for word in kept).strip()
            begin, end = start + kept[0].start, start + kept[-1].end
        else:
            if not low <= start + (segment.start + segment.end) / 2 < high:
                continue
            text = segment.text.strip()
            begin, end = start + segment.start, start + segment.end
        if text:
            row = {'start': round(begin, 2), 'end': round(end, 2), 'text': text}
            if keep_words and words:
                row['words'] = [{'start':round(start + word.start, 3), 'end':round(start + word.end, 3), 'text':word.word} for word in kept]
            rows.append(row)
    return rows


def speaker_windows(turns, duration):
    """Use acoustic speech regions, not a second VAD that can drop quiet voices.

    Limit ASR context to 28 seconds with a little padding. Each window owns
    a disjoint time range so words near a join are retained only once.
    """
    regions = []
    for turn in sorted(turns, key=lambda item: item['start']):
        start, end = max(0, turn['start'] - .3), min(duration, turn['end'] + .3)
        if end <= start:
            continue
        if regions and start <= regions[-1][1] + 1:
            regions[-1][1] = max(regions[-1][1], end)
        else:
            regions.append([start, end])
    for start, end in regions:
        while start < end:
            stop = min(start + 28, end)
            yield {'start': max(0, start - .3), 'end': min(duration, stop + .3),
                   'keep_start': start, 'keep_end': stop}
            start = stop


def speaker_audio_chunks(handle, turns, duration):
    import numpy as np
    for window in speaker_windows(turns, duration):
        left, right = round(window['start'] * SAMPLE_RATE), round(window['end'] * SAMPLE_RATE)
        handle.seek(left * 4)
        # Bounded byte buffer; no open memory map to prevent Windows cleanup.
        yield {**window, 'audio': np.frombuffer(handle.read((right - left) * 4), dtype='float32')}


def transcribe(path: Path, language="auto", diarize=False, num_speakers=0, model_size='base',
               acceleration='cpu', cpu_assistance=None):
    global _model, _model_path, _model_key, _progress
    directory = model_directory(model_size)
    if acceleration not in {'auto', 'cpu'}:
        raise AudioError('Processing must be Auto or CPU only.')
    try:
        cpu = audio_acceleration.cpu_plan(cpu_assistance or 'auto')
    except ValueError as exc:
        raise AudioError(str(exc)) from exc
    if cpu_assistance is None:  # Existing API callers retain their resource limits.
        cpu.update(workers=1, cpu_threads=4, speaker_threads=2)
    if language not in LANGUAGES:
        raise AudioError("Choose a supported language or Auto detect.")
    if not isinstance(num_speakers, int) or not 0 <= num_speakers <= 20:
        raise AudioError('Speaker count must be Auto detect or a number from 1 to 20.')
    if not _lock.acquire(blocking=False):
        raise AudioError("Audio is busy. Wait for the current operation to finish.", 409)
    started = time.perf_counter()
    timings = {'decode_seconds':0, 'speaker_seconds':0, 'transcribe_seconds':0}
    execution = None

    def release_gpu():
        global _model, _model_key
        if execution and execution['device'] == 'cuda' and execution.get('owner'):
            try:
                if _model_key and _model_key[1] == 'cuda':
                    audio_acceleration.unload_gpu_model(_model)
            except Exception:
                # Drop every owning model reference before releasing the lease.
                import gc
                _model = None
                _model_key = None
                gc.collect()
            finally:
                audio_acceleration.release_device(execution)

    def load_model():
        global _model, _model_path, _model_key
        key = (directory, execution['device'], execution['cpu_threads'], execution['workers'])
        if _model is None or _model_key != key:
            _model = None
            _model_key = None
            if execution['device'] == 'cuda':
                audio_acceleration.prepare_cuda_libraries()
            _model = cls(str(directory), device=execution['device'],
                compute_type='float16' if execution['device'] == 'cuda' else 'int8',
                cpu_threads=execution['cpu_threads'], num_workers=execution['workers'], local_files_only=True)
            _model_path, _model_key = directory, key
        elif execution['device'] == 'cuda':
            _model.model.load_model()

    try:
        cls = _runtime()
        if not model_ready(directory):
            raise AudioError("Set up the transcription model in the Audio workspace first.", 503)
        if diarize and not speaker_diarization.status()['ready']:
            raise AudioError('Set up speaker separation in the Audio workspace first.', 503)
        _progress = {"stage": "loading", "processed_seconds": 0}
        duration = 0
        with ExitStack() as stack:
            turns, speaker_failure = None, None
            incoming = None
            if diarize:
                decode_started = time.perf_counter()
                work = Path(stack.enter_context(TemporaryDirectory(prefix='law-speakers-')))
                pcm_path = work / 'audio.f32'
                with pcm_path.open('wb') as pcm:
                    for chunk in iter_audio_chunks(path):
                        # Preserve the original timeline, including silences.
                        left = round((chunk['keep_start'] - chunk['start']) * SAMPLE_RATE)
                        right = round((chunk['keep_end'] - chunk['start']) * SAMPLE_RATE)
                        chunk['audio'][left:right].tofile(pcm)
                        duration = chunk['end']
                        _progress = {'stage':'decoding', 'processed_seconds':round(duration, 2)}
                timings['decode_seconds'] = time.perf_counter() - decode_started
                def speaker_progress(fraction):
                    global _progress
                    _progress = {'stage':'diarizing', 'processed_seconds':duration, 'percent':round(max(0, min(1, fraction)) * 100)}
                speaker_progress(0)
                speaker_started = time.perf_counter()
                try:
                    if cpu_assistance is None:
                        turns = speaker_diarization.run(pcm_path, num_speakers, speaker_progress)
                    else:
                        turns = speaker_diarization.run(pcm_path, num_speakers, speaker_progress, cpu['speaker_threads'])
                    if not turns:
                        raise speaker_diarization.SpeakerError('No speaker turns were detected. Try another recording or turn off Separate speakers.')
                    incoming = stack.enter_context(pcm_path.open('rb'))
                except speaker_diarization.SpeakerError as exc:
                    speaker_failure = str(exc)
                finally:
                    timings['speaker_seconds'] = time.perf_counter() - speaker_started
            # Acquire VRAM only for inference, after all CPU speaker analysis.
            execution = audio_acceleration.choose_device(acceleration, model_size, cpu)
            asr_started = time.perf_counter()
            while True:
                try:
                    _progress = {'stage':'loading', 'processed_seconds':0,
                                 'device':execution['device'], 'workers':execution['workers'],
                                 'warnings':execution['warnings']}
                    load_model()
                    rows, chunks = [], 0
                    detected_language = None if language == 'auto' else language
                    inputs = speaker_audio_chunks(incoming, turns, duration) if incoming else iter_audio_chunks(path)

                    def recognize(chunk):
                        segments, info = _model.transcribe(chunk['audio'], language=detected_language,
                            beam_size=5, temperature=0, vad_filter=not bool(turns),
                            condition_on_previous_text=False, word_timestamps=True)
                        found = retained_segments(segments, chunk, keep_words=bool(turns))
                        return found, info.language, chunk['end'], chunk['keep_end']

                    def accept(value):
                        nonlocal chunks, detected_language, duration
                        global _progress
                        found, found_language, end, processed = value
                        rows.extend(found)
                        if found and detected_language is None:
                            detected_language = found_language
                        duration = max(duration, end)
                        chunks += 1
                        _progress = {'stage':'transcribing', 'processed_seconds':round(processed, 2),
                                     'device':execution['device'], 'workers':execution['workers'],
                                     'warnings':execution['warnings']}

                    with ExitStack() as input_stack:
                        if hasattr(inputs, 'close'):
                            input_stack.callback(inputs.close)
                        # Resolve language once before scheduling independent sections.
                        while detected_language is None:
                            first = next(inputs, None)
                            if first is None:
                                break
                            accept(recognize(first))
                        with closing(audio_acceleration.ordered_map(recognize, inputs, execution['workers'])) as completed:
                            for value in completed:
                                accept(value)
                    break
                except (ImportError, RuntimeError, OSError, MemoryError):
                    if execution['device'] != 'cuda':
                        raise
                    release_gpu()
                    execution = {**cpu, 'device':'cpu', 'owner':None, 'warnings':[
                        'GPU transcription failed; retried on CPU with the same model.']}
            timings['transcribe_seconds'] = time.perf_counter() - asr_started
            result = {"text": " ".join(s["text"] for s in rows).strip(), "segments": rows,
                      "language": detected_language, "duration": round(duration, 2), "chunks": chunks,
                      'processing': {key:value for key,value in execution.items() if key != 'owner'}}
            if turns:
                labeled, speakers = speaker_diarization.assign_speakers(rows, turns)
                result.update(segments=labeled, speakers=speakers, diarized=True)
            elif speaker_failure:
                result.update(diarized=False, speaker_error=speaker_failure)
            release_gpu()
            result['processing']['timings'] = {key:round(value, 3) for key,value in timings.items()}
            result['processing']['total_seconds'] = round(time.perf_counter() - started, 3)
            result['processing']['model_size'] = model_size
            return result
    except AudioError:
        raise
    except Exception as exc:
        raise AudioError("Transcription failed. Try a shorter file or run model setup again.", 500) from exc
    finally:
        release_gpu()
        _progress = None
        _lock.release()
