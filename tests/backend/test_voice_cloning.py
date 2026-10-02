import io
import json
from pathlib import Path
from types import SimpleNamespace
import wave
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from routes.audio import router
from services import voice_cloning as voices
from services.audio import AudioError


def wav(seconds=6.1, silent=False):
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as handle:
        handle.setnchannels(1); handle.setsampwidth(2); handle.setframerate(24000)
        values = np.zeros(int(seconds*24000)) if silent else np.sin(np.arange(int(seconds*24000)) * .12) * 8000
        handle.writeframes(values.astype('int16').tobytes())
    return buffer.getvalue()


@pytest.fixture
def client():
    app = FastAPI(); app.include_router(router)
    return TestClient(app)


def test_engine_status_needs_files_and_successful_runtime_receipt(tmp_path, monkeypatch):
    monkeypatch.setattr(voices, 'ROOT', tmp_path)
    spec = voices.engine_spec('omnivoice')
    for name in spec['files']:
        target = tmp_path / spec['folder'] / name
        target.parent.mkdir(parents=True, exist_ok=True); target.touch()
    python = voices.runtime_python(spec)
    python.parent.mkdir(parents=True); python.touch()
    receipt = tmp_path / 'runtimes/omnivoice/installed.json'
    assert not voices.status()['engines']['omnivoice']['ready']
    receipt.write_text('{"state":"installing"}')
    assert not voices.status()['engines']['omnivoice']['ready']
    receipt.write_text('{"state":"ready"}', encoding='utf-8-sig')
    assert voices.status()['engines']['omnivoice']['ready']
    find_spec = voices.importlib.util.find_spec
    monkeypatch.setattr(voices.importlib.util,'find_spec',lambda name:None if name == 'av' else find_spec(name))
    missing = voices.status()
    assert not missing['reference_ready'] and not missing['engines']['omnivoice']['ready']
    assert missing['engines']['omnivoice']['model_ready'] and missing['engines']['omnivoice']['runtime_ready']


@pytest.mark.parametrize('change', [
    {'engine':'../other'}, {'text':''}, {'text':'x'*1501}, {'language':'invalid'},
    {'acceleration':'shell'}, {'engine':'omnivoice','reference_text':''},
    {'engine':'chatterbox-turbo','language':'French'},
])
def test_invalid_options_are_rejected(change):
    with pytest.raises(AudioError):
        voices.validate(**{**dict(engine='qwen3-tts',text='Hello',reference_text='Sample',language='English',acceleration='auto'), **change})


@pytest.mark.parametrize('seconds,silent,message', [(2,False,'6 and 30'), (31,False,'6 and 30'), (7,True,'silent')])
def test_reference_bounds(tmp_path, seconds, silent, message):
    source = tmp_path/'reference.wav'; source.write_bytes(wav(seconds,silent))
    with pytest.raises(AudioError, match=message):
        voices.prepare_reference(source,tmp_path/'out.wav')


def test_reference_decode_preserves_source(tmp_path):
    source = tmp_path/'ref.wav'; original=wav(); source.write_bytes(original)
    destination = tmp_path/'out.wav'
    assert voices.prepare_reference(source,destination) == pytest.approx(6.1)
    assert source.read_bytes() == original
    with wave.open(str(destination)) as handle:
        assert handle.getnchannels() == 1 and handle.getframerate() == 24000


def test_uploaded_reference_is_temporary_and_result_is_wav(client, monkeypatch):
    seen = []
    def generate(engine,text,reference,reference_text,language,acceleration,directory):
        seen.append(directory)
        assert reference.read_bytes() == b'reference'
        assert engine == 'qwen3-tts' and reference_text == 'Sample'
        return wav(.1), {'device':'cpu','seconds':1,'warnings':[]}
    monkeypatch.setattr(voices,'synthesize',generate)
    response = client.post('/audio/voices/synthesize', files={'reference':('../../voice.wav',b'reference')},
        data={'engine':'qwen3-tts','text':'Hello','reference_text':'Sample'})
    assert response.status_code == 200 and response.content.startswith(b'RIFF')
    assert response.headers['content-type'] == 'audio/wav'
    assert json.loads(response.headers['x-voice-processing'])['device'] == 'cpu'
    assert not seen[0].exists()
    monkeypatch.setattr(voices,'MAX_REFERENCE_BYTES',2)
    assert client.post('/audio/voices/synthesize', files={'reference':('voice.wav',b'large')},
        data={'engine':'chatterbox-turbo','text':'Hello'}).status_code == 413


@pytest.mark.parametrize('returncode', [0,1])
def test_worker_is_offline_and_gpu_lease_lasts_until_exit(tmp_path,monkeypatch,returncode):
    monkeypatch.setattr(voices,'status',lambda:{'engines':{'chatterbox-turbo':{'ready':True}}})
    monkeypatch.setattr(voices,'prepare_reference',lambda *args:6.1)
    execution={'device':'cuda','cpu_threads':2,'warnings':[],'owner':'audio:test'}
    monkeypatch.setattr(voices.audio_acceleration,'choose_device',lambda *args:execution)
    events=[]
    def release(plan):
        assert events[-1] == 'exited'
        events.append('released')
    monkeypatch.setattr(voices.audio_acceleration,'release_device',release)
    class Process:
        def __init__(self, command, **options):
            self.returncode=None
            assert options['env']['HF_HUB_OFFLINE']=='1'
            assert options['env']['TRANSFORMERS_OFFLINE']=='1'
            request=json.loads(Path(command[-1]).read_text())
            assert request['device']=='cuda' and request['engine']=='chatterbox-turbo'
            Path(request['output']).write_bytes(wav(.1))
        def communicate(self, timeout):
            assert timeout == 600
            self.returncode=returncode; events.append('exited')
            return 'Model error' if returncode else '',None
        def poll(self): return self.returncode
    monkeypatch.setattr(voices.subprocess,'Popen',Process)
    args=('chatterbox-turbo','Hello',tmp_path/'unused.wav','','English','auto',tmp_path)
    if returncode:
        with pytest.raises(AudioError,match='generation failed'): voices.synthesize(*args)
    else:
        audio,info=voices.synthesize(*args)
        assert audio.startswith(b'RIFF') and info['device']=='cuda'
    assert events==['exited','released'] and not voices._lock.locked()


def test_saving_a_chat_reference_reuses_the_shared_library(client, tmp_path, monkeypatch):
    from services import character_resources, image_vault
    monkeypatch.setattr(character_resources.bank, 'ROOT', tmp_path / 'bank')
    monkeypatch.setattr(image_vault, 'ROOT', tmp_path / 'vault')
    payload = wav()
    response = client.post('/audio/voices/references', files={'reference':('../../Reference.wav', payload)})
    assert response.status_code == 201
    saved = response.json()
    assert saved['name'] == 'Reference.wav' and saved['category'] == 'audio'
    assert character_resources.asset_path(saved['id'], 'blob').read_bytes() == payload
    assert character_resources.catalog('file') == [saved]
    assert client.post('/audio/voices/references', files={'reference':('Reference.wav', wav(2))}).status_code == 400
    assert len(character_resources.catalog('file')) == 1


def test_chat_stop_cancels_the_existing_synthesis_request_and_cleans_temporary_files(client, monkeypatch):
    started = threading.Event()
    directories = []
    def generate(*args, cancel_event):
        directories.append(args[-1]); started.set()
        assert cancel_event.wait(5)
        voices.check_cancelled(cancel_event)
    monkeypatch.setattr(voices, 'synthesize', generate)
    request_id = str(uuid.uuid4())
    with ThreadPoolExecutor() as pool:
        pending = pool.submit(client.post, '/audio/voices/synthesize',
            files={'reference':('Reference.wav', b'reference')},
            data={'engine':'chatterbox-turbo', 'text':'Hello', 'request_id':request_id})
        assert started.wait(5)
        assert client.post('/audio/voices/stop/' + request_id).json() == {'stopped':True}
        assert pending.result(timeout=5).status_code == 499
    assert not directories[0].exists()
    assert client.post('/audio/voices/stop/' + request_id).json() == {'stopped':False}


def test_cancellation_waits_for_voice_worker_exit_before_releasing_gpu(tmp_path, monkeypatch):
    monkeypatch.setattr(voices,'status',lambda:{'engines':{'chatterbox-turbo':{'ready':True}}})
    monkeypatch.setattr(voices,'prepare_reference',lambda *args:6.1)
    execution={'device':'cuda','cpu_threads':2,'warnings':[]}
    monkeypatch.setattr(voices.audio_acceleration,'choose_device',lambda *args:execution)
    cancelled = threading.Event(); events = []
    class Process:
        returncode = None
        def __init__(self,*args,**kwargs): pass
        def communicate(self, timeout):
            assert timeout <= .25
            cancelled.set()
            raise voices.subprocess.TimeoutExpired('voice-worker',timeout)
        def poll(self): return self.returncode
    def kill(process):
        process.returncode = -1; events.append('exited')
    monkeypatch.setattr(voices.subprocess,'Popen',Process)
    monkeypatch.setattr(voices,'stop_worker',kill)
    monkeypatch.setattr(voices.audio_acceleration,'release_device',lambda plan:events.append('released'))
    with pytest.raises(AudioError,match='cancelled'):
        voices.synthesize('chatterbox-turbo','Hello',tmp_path/'unused.wav','','English','auto',tmp_path,cancelled)
    assert events == ['exited','released'] and not voices._lock.locked()
