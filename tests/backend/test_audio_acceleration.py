from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock
from types import SimpleNamespace

import numpy as np
import pytest

from services import audio, audio_acceleration as acceleration
from services.gpu_coordination import GpuCoordinator


def test_cpu_plan_bounds_cores_and_memory(monkeypatch):
    monkeypatch.setattr(acceleration.psutil, 'cpu_count', lambda **kw: 12)
    monkeypatch.setattr(acceleration.psutil, 'virtual_memory', lambda: SimpleNamespace(available=16 * 1024**3))
    assert acceleration.cpu_plan('auto') == {'workers':2, 'cpu_threads':4, 'speaker_threads':4, 'assistance':'auto'}
    assert acceleration.cpu_plan('light')['workers'] == 1
    assert acceleration.cpu_plan('balanced')['workers'] == 4
    monkeypatch.setattr(acceleration.psutil, 'virtual_memory', lambda: SimpleNamespace(available=4 * 1024**3))
    assert acceleration.cpu_plan('balanced')['workers'] == 1
    monkeypatch.setattr(acceleration.psutil, 'cpu_count', lambda **kw: 2)
    assert acceleration.cpu_plan('auto')['cpu_threads'] == 1
    assert acceleration.cpu_plan('auto')['speaker_threads'] == 1
    with pytest.raises(ValueError):
        acceleration.cpu_plan('unlimited')


@pytest.fixture
def gpu(monkeypatch):
    coordinator = GpuCoordinator()
    monkeypatch.setattr(acceleration, 'gpu_coordinator', coordinator)
    monkeypatch.setattr(acceleration, 'cuda_available', lambda: True)
    monkeypatch.setattr(acceleration, 'free_gpu_mb', lambda: 7000)
    monkeypatch.setattr(acceleration, 'prepare_cuda_libraries', lambda: None)
    monkeypatch.setattr(acceleration, 'free_idle_gpu_memory', lambda: None)
    return coordinator


def test_gpu_lease_and_busy_or_low_memory_fallback(gpu, monkeypatch):
    plan = acceleration.cpu_plan('auto')
    gpu.acquire('image-generation')
    result = acceleration.choose_device('auto', 'turbo', plan)
    assert result['device'] == 'cpu' and 'busy' in result['warnings'][0]
    assert gpu.current_owner() == 'image-generation'
    gpu.release('image-generation')
    monkeypatch.setattr(acceleration, 'free_gpu_mb', lambda: 1000)
    assert acceleration.choose_device('auto', 'turbo', plan)['device'] == 'cpu'
    assert gpu.current_owner() is None
    monkeypatch.setattr(acceleration, 'free_gpu_mb', lambda: 7000)
    result = acceleration.choose_device('auto', 'turbo', plan)
    assert result['device'] == 'cuda' and result['workers'] <= 2
    assert gpu.current_owner() == result['owner']
    acceleration.release_device(result)
    assert gpu.current_owner() is None


def test_parallel_map_is_bounded_and_keeps_source_order():
    release = Event()
    entered = Event()
    gate = Lock()
    active = maximum = consumed = 0
    def source():
        nonlocal consumed
        for i in range(20):
            consumed += 1
            yield i
    def task(i):
        nonlocal active, maximum
        with gate:
            active += 1
            maximum = max(maximum, active)
            if active == 2:
                entered.set()
        assert release.wait(5)
        with gate:
            active -= 1
        return i
    with ThreadPoolExecutor(max_workers=1) as observer:
        future = observer.submit(lambda: list(acceleration.ordered_map(task, source(), 2)))
        try:
            assert entered.wait(5)
            assert consumed <= 4
        finally:
            release.set()
        assert future.result(timeout=5) == list(range(20))
    assert maximum == 2 and active == 0


def test_idle_models_are_parked_only_under_gpu_lease(gpu, monkeypatch):
    memory = iter([1800, 6500])
    monkeypatch.setattr(acceleration, 'free_gpu_mb', lambda: next(memory))
    def handoff():
        assert gpu.current_owner().startswith('audio:')
    monkeypatch.setattr(acceleration, 'free_idle_gpu_memory', handoff)
    result = acceleration.choose_device('auto', 'turbo', acceleration.cpu_plan())
    assert result['device'] == 'cuda'
    acceleration.release_device(result)
    monkeypatch.setattr(acceleration, 'free_gpu_mb', lambda: 1800)
    def fail():
        assert gpu.current_owner().startswith('audio:')
        raise RuntimeError('Provider handoff failed')
    monkeypatch.setattr(acceleration, 'free_idle_gpu_memory', fail)
    result = acceleration.choose_device('auto', 'turbo', acceleration.cpu_plan())
    assert result['device'] == 'cpu' and result['warnings']
    assert gpu.current_owner() is None


def test_parallel_failure_waits_for_running_work_before_returning():
    started, release, finished = Event(), Event(), Event()
    def task(i):
        if i == 0:
            assert started.wait(5)
            raise RuntimeError('inference failure')
        started.set()
        assert release.wait(5)
        finished.set()
        return i
    with ThreadPoolExecutor(max_workers=1) as observer:
        future = observer.submit(lambda: list(acceleration.ordered_map(task, range(2), 2)))
        try:
            assert started.wait(5)
            assert not future.done()
        finally:
            release.set()
        with pytest.raises(RuntimeError, match='inference failure'):
            future.result(timeout=5)
    assert finished.is_set()


@pytest.fixture
def local_audio(tmp_path, monkeypatch):
    monkeypatch.setattr(audio, 'TURBO_MODEL_DIR', tmp_path)
    for name in ('model.bin','config.json','tokenizer.json'):
        (tmp_path / name).touch()
    monkeypatch.setattr(audio, '_model', None)
    monkeypatch.setattr(audio, '_model_key', None)
    monkeypatch.setattr(audio, '_model_path', None)
    def chunks(path):
        for i in range(6):
            yield {'audio':np.array([i],dtype='float32'), 'start':i, 'end':i+1, 'keep_start':i, 'keep_end':i+1}
    monkeypatch.setattr(audio, 'iter_audio_chunks', chunks)
    return tmp_path / 'voice.wav'


def test_gpu_failure_retries_same_model_without_duplicate_text(local_audio, gpu, monkeypatch):
    loaded, events = [], []
    def factory(path, **options):
        loaded.append((path, options['device']))
        class Model:
            def __init__(self):
                self.model = self
            def unload_model(self, **kw):
                assert gpu.current_owner().startswith('audio:')
                events.append('unloaded')
            def transcribe(self, waveform, **kw):
                if options['device'] == 'cuda' and waveform[0] == 2:
                    raise RuntimeError('GPU memory exhausted')
                return iter([SimpleNamespace(start=0,end=1,text=str(int(waveform[0])))]), SimpleNamespace(language='en')
        return Model()
    monkeypatch.setattr(audio, '_runtime', lambda: factory)
    result = audio.transcribe(local_audio, language='en', model_size='turbo', acceleration='auto', cpu_assistance='auto')
    assert [device for _,device in loaded] == ['cuda','cpu']
    assert all(path == str(local_audio.parent) for path,_ in loaded)
    assert result['text'] == '0 1 2 3 4 5'
    assert result['chunks'] == 6 and result['processing']['device'] == 'cpu'
    assert 'same model' in result['processing']['warnings'][0]
    assert events == ['unloaded'] and gpu.current_owner() is None and not audio._lock.locked()


def test_cached_gpu_weights_reload_and_unload_before_lease_release(local_audio, gpu, monkeypatch):
    events = []
    def factory(path, **options):
        events.append('constructed')
        class Model:
            def __init__(self):
                self.model = self
            def load_model(self):
                assert gpu.current_owner().startswith('audio:')
                events.append('reloaded')
            def unload_model(self, **kw):
                assert kw == {'to_cpu':True}
                assert gpu.current_owner().startswith('audio:')
                events.append('unloaded')
            def transcribe(self, waveform, **kw):
                return iter([SimpleNamespace(start=0,end=1,text='word')]), SimpleNamespace(language='en')
        return Model()
    monkeypatch.setattr(audio, '_runtime', lambda: factory)
    for _ in range(2):
        assert audio.transcribe(local_audio, model_size='turbo', acceleration='auto', cpu_assistance='auto')['processing']['device'] == 'cuda'
        assert gpu.current_owner() is None
    assert events == ['constructed','unloaded','reloaded','unloaded']


def test_missing_cuda_libraries_fall_back_without_losing_gpu_lease(local_audio, gpu, monkeypatch):
    def missing():
        raise ImportError('Missing CUDA DLL')
    monkeypatch.setattr(acceleration, 'prepare_cuda_libraries', missing)
    def factory(path, **options):
        assert options['device'] == 'cpu'
        assert gpu.current_owner() is None
        return SimpleNamespace(transcribe=lambda *args, **kw: (iter([]), SimpleNamespace(language='en')))
    monkeypatch.setattr(audio, '_runtime', lambda: factory)
    result = audio.transcribe(local_audio, model_size='turbo', acceleration='auto', cpu_assistance='auto')
    assert result['processing']['device'] == 'cpu' and result['processing']['warnings']
    assert gpu.current_owner() is None and not audio._lock.locked()
