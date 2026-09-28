import io
import wave
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from routes.audio import router
from services import audio


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def wav(seconds=0.1):
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(16000)
        out.writeframes(bytes(int(seconds * 16000) * 2))
    return buffer.getvalue()


def test_upload_cleanup_and_language(client, monkeypatch):
    seen = []
    def transcribe(path, language):
        seen.append(path)
        assert path.read_bytes() == wav()
        assert language == "en"
        return {"text": "Hello world", "segments": [], "language": "en", "duration": .1}
    monkeypatch.setattr(audio, "transcribe", transcribe)
    response = client.post('/audio/transcribe', files={'file': ('../../voice.wav', wav())}, data={'language':'en'})
    assert response.status_code == 200
    assert response.json()['text'] == 'Hello world'
    assert seen and not seen[0].exists()


@pytest.mark.parametrize('name,payload,language,code', [('x.exe', b'a', 'auto', 400), ('x.wav', b'', 'auto', 400), ('x.wav', b'a', 'invalid', 400)])
def test_invalid_inputs(client, name, payload, language, code):
    assert client.post('/audio/transcribe', files={'file':(name,payload)}, data={'language':language}).status_code == code


def test_upload_limit_and_failed_transcription_cleanup(client, monkeypatch):
    monkeypatch.setattr(audio, 'MAX_BYTES', 2)
    assert client.post('/audio/transcribe', files={'file':('x.wav', b'123')}).status_code == 413
    seen = []
    def fail(path, language):
        seen.append(path)
        raise audio.AudioError('Busy', 409)
    monkeypatch.setattr(audio, 'transcribe', fail)
    assert client.post('/audio/transcribe', files={'file':('x.wav', b'12')}).status_code == 409
    assert not seen[0].exists()


def test_decode_bounds_invalid_and_empty(tmp_path, monkeypatch):
    pytest.importorskip('av')
    path = tmp_path / 'clip.wav'
    path.write_bytes(wav())
    assert next(audio.iter_audio_chunks(path))['audio'].shape == (1600,)
    monkeypatch.setattr(audio, 'MAX_SECONDS', .01)
    with pytest.raises(audio.AudioError, match='2 hours'):
        list(audio.iter_audio_chunks(path))
    path.write_bytes(b'not audio')
    with pytest.raises(audio.AudioError, match='decode'):
        list(audio.iter_audio_chunks(path))
    path.write_bytes(wav(0))
    with pytest.raises(audio.AudioError, match='empty'):
        list(audio.iter_audio_chunks(path))


def test_missing_model_never_downloads(tmp_path, monkeypatch):
    monkeypatch.setattr(audio, 'MODEL_DIR', tmp_path)
    monkeypatch.setattr(audio, '_runtime', lambda: lambda *a, **kw: pytest.fail('must not load or download'))
    with pytest.raises(audio.AudioError, match='Set up'):
        audio.transcribe(tmp_path / 'input.wav')
    assert not audio._lock.locked()


def test_transcription_consumes_generator_locally(tmp_path, monkeypatch):
    monkeypatch.setattr(audio, 'MODEL_DIR', tmp_path)
    for name in ('model.bin','config.json','tokenizer.json'):
        (tmp_path / name).touch()
    monkeypatch.setattr(audio, '_model', None)
    monkeypatch.setattr(audio, 'iter_audio_chunks', lambda path: iter([{'audio': np.zeros(16000, dtype=np.float32), 'start':0, 'end':1, 'keep_start':0, 'keep_end':1}]))
    def factory(path, **kw):
        assert kw['local_files_only'] is True
        assert kw['device'] == 'cpu'
        class Model:
            def transcribe(self, waveform, **options):
                assert options['vad_filter'] and options['language'] is None
                return iter([SimpleNamespace(start=0,end=1,text=' Hello ')]), SimpleNamespace(language='en')
        return Model()
    monkeypatch.setattr(audio, '_runtime', lambda:factory)
    result = audio.transcribe(tmp_path / 'input.wav')
    assert {key:value for key,value in result.items() if key != 'processing'} == {'text':'Hello','segments':[{'start':0,'end':1,'text':'Hello'}], 'language':'en','duration':1.0, 'chunks':1}
    assert result['processing']['device'] == 'cpu'
    assert not audio._lock.locked()


@pytest.mark.parametrize('duration', [2, 5, 5.1, 8, 14])
def test_chunk_ownership_covers_entire_recording_once(tmp_path, monkeypatch, duration):
    pytest.importorskip('av')
    monkeypatch.setattr(audio, 'CHUNK_SECONDS', 5)
    path = tmp_path / 'long.wav'
    path.write_bytes(wav(duration))
    chunks = list(audio.iter_audio_chunks(path))
    assert chunks[0]['keep_start'] == 0
    assert chunks[-1]['keep_end'] == pytest.approx(duration)
    assert all(len(chunk['audio']) <= 5 * audio.SAMPLE_RATE for chunk in chunks)
    for previous, following in zip(chunks, chunks[1:]):
        assert previous['keep_end'] == following['keep_start']
        assert previous['end'] - following['start'] == 2


def test_overlap_retains_words_once_and_offsets_timestamps():
    def segment(offset):
        return SimpleNamespace(words=[SimpleNamespace(start=3.2-offset,end=3.8-offset,word=' before'),
                                      SimpleNamespace(start=4.2-offset,end=4.8-offset,word=' after')])
    left = audio.retained_segments([segment(0)], {'start':0, 'keep_start':0, 'keep_end':4})
    right = audio.retained_segments([segment(3)], {'start':3, 'keep_start':4, 'keep_end':8})
    assert left + right == [{'start':3.2, 'end':3.8, 'text':'before'}, {'start':4.2, 'end':4.8, 'text':'after'}]


def test_upload_above_old_limit_is_accepted_and_cleaned(client, monkeypatch):
    seen = []
    def fake(path, language):
        seen.append(path)
        assert path.stat().st_size == 26 * 1024 * 1024
        return {'text':'Long file accepted'}
    monkeypatch.setattr(audio, 'transcribe', fake)
    response = client.post('/audio/transcribe', files={'file':('long.m4a', bytes(26 * 1024 * 1024))})
    assert response.status_code == 200
    assert not seen[0].exists()


def test_busy_rejects_duplicate_work(tmp_path):
    with audio._lock:
        for operation in (audio.setup, lambda: audio.transcribe(tmp_path / 'x.wav')):
            with pytest.raises(audio.AudioError) as error:
                operation()
            assert error.value.status == 409


def test_setup_enables_network_only_in_child(tmp_path, monkeypatch):
    monkeypatch.setenv('HF_HUB_OFFLINE', '1')
    monkeypatch.setattr(audio, 'MODEL_DIR', tmp_path)
    monkeypatch.setattr(audio, '_model', None)
    monkeypatch.setattr(audio, '_runtime', lambda: lambda *args, **kwargs: object())
    calls = []
    def run(command, **kwargs):
        calls.append((command, kwargs))
    monkeypatch.setattr(audio.subprocess, 'run', run)
    audio.setup()
    assert calls[0][1]['env']['HF_HUB_OFFLINE'] == '0'
    assert audio.os.environ['HF_HUB_OFFLINE'] == '1'
    assert calls[0][1]['timeout'] == 600
    assert not audio._lock.locked()


def test_speaker_options_reach_backend(client, monkeypatch):
    seen = []
    def transcribe(path, language, diarize, count):
        seen.append((language, diarize, count))
        return {'text':'Voice test'}
    monkeypatch.setattr(audio, 'transcribe', transcribe)
    response = client.post('/audio/transcribe', files={'file':('test.wav',wav())}, data={'diarize':'true','num_speakers':'3'})
    assert response.status_code == 200
    assert seen == [('auto',True,3)]
    assert client.post('/audio/transcribe', files={'file':('test.wav',wav())}, data={'num_speakers':'21'}).status_code == 422


def test_selected_model_reaches_backend_and_rejects_arbitrary_paths(client, monkeypatch):
    seen = []
    monkeypatch.setattr(audio, 'transcribe', lambda *args: seen.append(args[1:]) or {'text':'ok'})
    response = client.post('/audio/transcribe', files={'file':('test.wav',wav())},
        data={'diarize':'true','num_speakers':'3','model_size':'small'})
    assert response.status_code == 200
    assert seen == [('auto',True,3,'small')]
    assert client.post('/audio/transcribe', files={'file':('test.wav',wav())},
        data={'model_size':'../../another-model'}).status_code == 400


def test_switching_models_reloads_the_selected_local_model(tmp_path, monkeypatch):
    for size in ('base','small'):
        directory = tmp_path / size
        directory.mkdir()
        for name in ('model.bin','config.json','tokenizer.json'): (directory / name).touch()
    monkeypatch.setattr(audio, 'MODEL_DIR', tmp_path / 'base')
    monkeypatch.setattr(audio, 'SMALL_MODEL_DIR', tmp_path / 'small')
    monkeypatch.setattr(audio, '_model', None)
    monkeypatch.setattr(audio, '_model_path', None)
    monkeypatch.setattr(audio, 'iter_audio_chunks', lambda path: iter([]))
    loaded = []
    monkeypatch.setattr(audio, '_runtime', lambda: lambda path, **kw: loaded.append(path) or object())
    for size in ('base','small','small','base'):
        audio.transcribe(tmp_path / 'unused.wav', model_size=size)
    assert loaded == [str(tmp_path / size) for size in ('base','small','base')]


def test_small_model_requires_explicit_setup_and_does_not_fall_back(tmp_path, monkeypatch):
    monkeypatch.setattr(audio, 'SMALL_MODEL_DIR', tmp_path)
    monkeypatch.setattr(audio, '_runtime', lambda: lambda *args, **kwargs: pytest.fail('No implicit download or fallback'))
    with pytest.raises(audio.AudioError, match='Set up'):
        audio.transcribe(tmp_path / 'unused.wav', model_size='small')


def test_acceleration_options_reach_backend_and_are_validated(client, monkeypatch):
    seen = []
    monkeypatch.setattr(audio, 'transcribe', lambda *args: seen.append(args[1:]) or {'text':'ok'})
    options = {'model_size':'turbo', 'acceleration':'auto', 'cpu_assistance':'balanced'}
    assert client.post('/audio/transcribe', files={'file':('test.wav',wav())}, data=options).status_code == 200
    assert seen == [('auto',False,0,'turbo','auto','balanced')]
    for key in ('acceleration','cpu_assistance'):
        assert client.post('/audio/transcribe', files={'file':('test.wav',wav())}, data={**options,key:'invalid'}).status_code == 400
