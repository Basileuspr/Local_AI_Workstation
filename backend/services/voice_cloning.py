"""Local voice synthesis through isolated, explicitly installed runtimes."""
from __future__ import annotations

import json
import importlib.util
import logging
import os
from pathlib import Path
import subprocess
import threading
import time
import wave

from config import settings
from services import audio_acceleration
from services.audio import AudioError

ROOT = settings.models_dir / 'audio' / 'voice-cloning'
WORKER = Path(__file__).with_name('voice_worker.py')
MAX_REFERENCE_BYTES = 25 * 1024 * 1024
MAX_TEXT = 1500
LANGUAGES = ['English', 'Chinese', 'Japanese', 'Korean', 'German', 'French', 'Russian', 'Portuguese', 'Spanish', 'Italian']
ENGINES = {
    'omnivoice': {'label':'OmniVoice', 'folder':'omnivoice', 'runtime':'omnivoice',
        'repository':'https://huggingface.co/k2-fsa/OmniVoice', 'transcript_required':True,
        'files':['config.json','model.safetensors','tokenizer.json','audio_tokenizer/model.safetensors']},
    'chatterbox-turbo': {'label':'Chatterbox Turbo', 'folder':'chatterbox-turbo', 'runtime':'chatterbox',
        'repository':'https://huggingface.co/ResembleAI/chatterbox-turbo', 'transcript_required':False,
        'files':['ve.safetensors','t3_turbo_v1.safetensors','s3gen_meanflow.safetensors','tokenizer_config.json','vocab.json']},
    'qwen3-tts': {'label':'Qwen3-TTS 0.6B Base', 'folder':'qwen3-tts-0.6b', 'runtime':'qwen3-tts',
        'repository':'https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base', 'transcript_required':True,
        'files':['config.json','model.safetensors','speech_tokenizer/model.safetensors','tokenizer_config.json','vocab.json']},
}
_lock = threading.Lock()
_progress = None


def engine_spec(engine):
    if engine not in ENGINES:
        raise AudioError('Choose OmniVoice, Chatterbox Turbo, or Qwen3-TTS.')
    return ENGINES[engine]


def runtime_python(spec):
    return ROOT / 'runtimes' / spec['runtime'] / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')


def status():
    engines = {}
    reference_ready = all(importlib.util.find_spec(name) is not None for name in ('av','numpy'))
    for key, spec in ENGINES.items():
        downloaded = all((ROOT / spec['folder'] / name).is_file() for name in spec['files'])
        try:
            receipt = json.loads((ROOT / 'runtimes' / spec['runtime'] / 'installed.json').read_text(encoding='utf-8-sig'))
            installed = runtime_python(spec).is_file() and receipt.get('state') == 'ready'
        except (OSError, ValueError):
            installed = False
        engines[key] = {key:value for key,value in spec.items() if key not in {'files','runtime','folder'}}
        engines[key].update(model_ready=downloaded, runtime_ready=installed, ready=downloaded and installed and reference_ready)
    return {'engines':engines, 'reference_ready':reference_ready, 'busy':_lock.locked(), 'progress':_progress, 'max_text':MAX_TEXT}


def validate(engine, text, reference_text, language, acceleration):
    spec = engine_spec(engine)
    if not text.strip() or len(text) > MAX_TEXT:
        raise AudioError(f'Enter between 1 and {MAX_TEXT} characters to speak.')
    if len(reference_text) > 4000:
        raise AudioError('Reference transcript must be 4,000 characters or shorter.')
    if spec['transcript_required'] and not reference_text.strip():
        raise AudioError('Enter or transcribe the exact words in the reference recording.')
    if language not in LANGUAGES or (engine == 'chatterbox-turbo' and language != 'English'):
        raise AudioError('Choose a supported language. Chatterbox Turbo supports English.')
    if acceleration not in {'auto','cpu'}:
        raise AudioError('Processing must be Auto or CPU only.')
    return spec


def prepare_reference(source, destination):
    """Decode untrusted uploads with no external protocols and a strict time bound."""
    try:
        import av
        import numpy as np
    except (ImportError, OSError) as exc:
        raise AudioError('Audio decoder unavailable. Install requirements-audio.txt with the app Python, then restart.', 503) from exc
    arrays, count = [], 0
    started = time.monotonic()
    try:
        with source.open('rb') as handle, av.open(handle, options={
            'format_whitelist':'wav,mp3,mov,aac,ogg,flac,matroska,webm', 'protocol_whitelist':''}) as container:
            if not container.streams.audio:
                raise AudioError('Reference file has no audio track.')
            resampler = av.AudioResampler(format='s16', layout='mono', rate=24000)
            def frames():
                for frame in container.decode(audio=0):
                    frame.pts = None
                    yield from resampler.resample(frame)
                yield from resampler.resample(None)
            for frame in frames():
                values = frame.to_ndarray().reshape(-1)
                count += len(values)
                if count > 30 * 24000:
                    raise AudioError('Use a reference clip between 6 and 30 seconds, with one clear voice.')
                if time.monotonic() - started > 30:
                    raise AudioError('Reference decoding took too long. Try a WAV file.')
                arrays.append(values)
        if count < 6 * 24000:
            raise AudioError('Use a reference clip between 6 and 30 seconds, with one clear voice.')
        samples = np.concatenate(arrays)
        if np.max(np.abs(samples.astype('float32'))) < 32:
            raise AudioError('The reference appears silent. Choose a clear voice recording.')
        with wave.open(str(destination), 'wb') as output:
            output.setnchannels(1); output.setsampwidth(2); output.setframerate(24000)
            output.writeframes(samples.tobytes())
        return count / 24000
    except AudioError:
        raise
    except Exception as exc:
        raise AudioError('Could not decode the reference. Try a valid WAV, MP3, or M4A file.') from exc


def stop_worker(process):
    import psutil
    try:
        children = psutil.Process(process.pid).children(recursive=True)
    except psutil.NoSuchProcess:
        children = []
    for child in reversed(children):
        try:
            child.kill()
        except psutil.NoSuchProcess:
            pass
    if process.poll() is None:
        process.kill()
    psutil.wait_procs(children, timeout=5)
    process.wait()


def synthesize(engine, text, reference, reference_text, language, acceleration, directory):
    global _progress
    spec = validate(engine, text, reference_text, language, acceleration)
    if not status()['engines'][engine]['ready']:
        raise AudioError('Voice engine installation is incomplete. Run scripts/install-voice-models.ps1.', 503)
    if not _lock.acquire(blocking=False):
        raise AudioError('Voice generation is busy. Wait for the current result.', 409)
    execution = None
    started = time.perf_counter()
    try:
        _progress = {'stage':'Preparing reference', 'engine':engine}
        prepared = directory / 'reference.wav'
        prepare_reference(reference, prepared)
        execution = audio_acceleration.choose_device(acceleration, 'turbo', audio_acceleration.cpu_plan('light'))
        request = {'engine':engine, 'model':str(ROOT / spec['folder']), 'text':text.strip(),
                   'reference':str(prepared), 'reference_text':reference_text.strip(), 'language':language,
                   'device':execution['device'], 'threads':execution['cpu_threads'], 'output':str(directory / 'voice.wav')}
        request_path = directory / 'request.json'
        request_path.write_text(json.dumps(request), encoding='utf-8')
        _progress = {'stage':'Loading voice model and generating speech', 'engine':engine,
                     'device':execution['device'], 'warnings':execution['warnings']}
        environment = {**os.environ, 'HF_HOME':str(ROOT / 'cache'), 'HF_HUB_OFFLINE':'1',
            'TRANSFORMERS_OFFLINE':'1', 'HF_HUB_DISABLE_TELEMETRY':'1', 'DO_NOT_TRACK':'1',
            'GRADIO_ANALYTICS_ENABLED':'False', 'PYTHONUTF8':'1'}
        process = subprocess.Popen([str(runtime_python(spec)), str(WORKER), str(request_path)],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace',
            env=environment, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        try:
            output, _ = process.communicate(timeout=600)
        except subprocess.TimeoutExpired as exc:
            stop_worker(process)
            raise AudioError('Voice generation exceeded ten minutes. Try shorter text or an available GPU.', 504) from exc
        finally:
            if process.poll() is None:
                stop_worker(process)
        if process.returncode:
            logging.getLogger(__name__).warning('Voice worker %s failed: %s', engine, output[-5000:])
            message = 'Voice generation failed. Try shorter text or CPU only processing.'
            if 'out of memory' in output.lower():
                message = 'GPU memory ran out. Try CPU only processing or shorter text.'
            raise AudioError(message, 500)
        waveform = directory / 'voice.wav'
        if not waveform.is_file() or not 44 < waveform.stat().st_size <= 30 * 1024 * 1024:
            raise AudioError('The voice model did not return a valid audio file.', 500)
        with wave.open(str(waveform), 'rb') as result:
            duration = result.getnframes() / result.getframerate()
        return waveform.read_bytes(), {'seconds':round(time.perf_counter()-started, 2),
            'duration':round(duration, 2), 'device':execution['device'], 'warnings':execution['warnings']}
    finally:
        # The worker has exited before another app task can claim its VRAM.
        if execution:
            audio_acceleration.release_device(execution)
        _progress = None
        _lock.release()
