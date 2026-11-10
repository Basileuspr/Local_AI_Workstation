import asyncio
import importlib.util
import json
import hashlib
from pathlib import Path
import sys
import threading
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from services import media_generation as media
from services.request_queue import QueueCancelled
from routes.media_generation import MediaRequest, router


@pytest.fixture
def installed(tmp_path, monkeypatch):
    monkeypatch.setattr(media, 'MODELS_DIR', tmp_path / 'models')
    monkeypatch.setattr(media, 'OUTPUT_DIR', tmp_path / 'outputs')
    catalog = json.loads(json.dumps(media.CATALOG))
    for identifier, spec in catalog['models'].items():
        files = {}
        for role, asset in spec['files'].items():
            asset['size'] = 1
            relative = 'sdcpp/shared/' + asset['repo'].replace('/', '--') + '/' + asset['revision'] + '/' + asset['file']
            target = media.MODELS_DIR / relative; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(b'x')
            files[role] = relative
        folder = media.MODELS_DIR / 'sdcpp' / identifier; folder.mkdir(parents=True)
        (folder / 'installation-manifest.json').write_text(json.dumps({'spec': spec, 'files': files}))
    monkeypatch.setattr(media, 'CATALOG', catalog)
    exe = media.runtime_path(); exe.parent.mkdir(parents=True); exe.write_bytes(b'x')
    (exe.parent / 'cuda.dll').write_bytes(b'x')
    (exe.parent / 'installation-manifest.json').write_text(json.dumps({
        'spec': catalog['runtime'], 'files': {'sd-cli.exe': {'size': 1}, 'cuda.dll': {'size': 1}},
    }))
    return catalog


def request(identifier='qwen-image-2.1-turbo-q4', **kwargs):
    kwargs.setdefault('steps', media.CATALOG['models'].get(identifier, {}).get('steps', 20))
    return MediaRequest(model_id=identifier, prompt='A ceramic cup', **kwargs).model_dump()


def test_catalog_only_marks_complete_pinned_models_ready(installed):
    assert all(item['ready'] for item in media.catalog()['models'])
    _, files = media.model_files('qwen-image-2.1-turbo-q4')
    files['vision'].unlink()
    assert not media.catalog()['models'][0]['ready']


def test_runtime_requires_complete_installation_receipt_and_libraries(installed):
    assert media.catalog()['runtime_ready']
    (media.runtime_path().parent / 'cuda.dll').unlink()
    assert not media.catalog()['runtime_ready']
    with pytest.raises(ValueError, match='CUDA runtime'):
        media.validate_request(request())


def test_corrupt_model_receipt_is_reported_as_unavailable(installed):
    path = media.MODELS_DIR / 'sdcpp/qwen-image-2.1-turbo-q4/installation-manifest.json'
    path.write_text('[]')
    assert not media.catalog()['models'][0]['ready']


def test_missing_video_decoder_blocks_video_before_generation(installed, monkeypatch):
    monkeypatch.setitem(sys.modules, 'av', None)
    models = media.catalog()['models']
    assert models[0]['ready'] and not models[1]['ready']
    with pytest.raises(ValueError, match='requirements-audio.txt'):
        media.validate_request(request('wan2.2-ti2v-5b-q4'))


def test_manifest_cannot_redirect_model_to_arbitrary_file(installed):
    path = media.MODELS_DIR / 'sdcpp/qwen-image-2.1-turbo-q4/installation-manifest.json'
    data = json.loads(path.read_text()); data['files']['diffusion'] = '../secret'
    path.write_text(json.dumps(data))
    with pytest.raises(ValueError, match='inventory'): media.model_files('qwen-image-2.1-turbo-q4')


def test_path_traversal_rejected(installed):
    with pytest.raises(ValueError, match='outside'): media.local_path('../outside')


def test_wan_requires_reference_and_valid_temporal_shape(installed, monkeypatch):
    from services import generation_reference
    monkeypatch.setattr(generation_reference, 'reference_bytes', lambda reference: b'checked')
    with pytest.raises(ValueError, match='one'): media.validate_request(request('wan2.2-i2v-14b-uncensored'))
    with pytest.raises(ValueError, match='8n'): media.validate_request(request('wan2.2-ti2v-5b-q4', frames=10))
    assert media.validate_request(request('wan2.2-ti2v-5b-q4', frames=17))['kind'] == 'video'


def test_image_reference_count_and_alignment(installed):
    with pytest.raises(ValueError, match='multiples of 32'): media.validate_request(request(width=520))
    with pytest.raises(ValueError, match='at most 4'): media.validate_request(request(references=['x']*5))


def test_qwen_command_has_vision_and_multiple_ordered_references(installed, tmp_path):
    data = request(); data['seed'] = 7; data['prompt'] = 'quoted " text; --backend rpc'
    args = media.command(data, tmp_path/'out.png', [tmp_path/'first.png', tmp_path/'second.png'])
    assert args[args.index('-p')+1] == data['prompt']
    assert '--llm_vision' in args and '--mmap' in args and '--auto-fit' in args
    assert args[args.index('--sigmas')+1] == 'qwen-image-2.1-turbo'
    assert '--disable-image-metadata' in args
    assert [args[i+1] for i, item in enumerate(args) if item == '-r'] == [str(tmp_path/'first.png'), str(tmp_path/'second.png')]


def test_turbo_rejects_steps_that_do_not_match_its_schedule(installed):
    with pytest.raises(ValueError, match='exactly 8 steps'):
        media.validate_request(request(steps=20))


def test_wan_14b_uses_both_experts_video_mode_and_init_image(installed, tmp_path):
    data = request('wan2.2-i2v-14b-uncensored'); data['seed'] = 3
    args = media.command(data, tmp_path/'out.webm', [tmp_path/'ref.png'])
    assert args[args.index('-M')+1] == 'vid_gen'
    assert '--high-noise-diffusion-model' in args and '--high-noise-steps' in args
    assert '-i' in args and '-r' not in args
    assert '--disable-image-metadata' in args and '--sigmas' not in args


def test_stop_terminates_runtime_during_silent_loading(tmp_path):
    cancel = threading.Event()
    timer = threading.Timer(.4, cancel.set); timer.start(); start = time.monotonic()
    try:
        with pytest.raises(QueueCancelled):
            media.run_process([sys.executable, '-c', 'import time; time.sleep(30)'], tmp_path, cancel, lambda *_: None)
    finally: timer.cancel()
    assert time.monotonic() - start < 8


def test_runtime_failure_does_not_echo_prompt(tmp_path):
    with pytest.raises(RuntimeError) as error:
        media.run_process([sys.executable, '-c', 'print("PRIVATE PROMPT"); raise SystemExit(9)'], tmp_path, threading.Event(), lambda *_: None)
    assert 'PRIVATE' not in str(error.value) and '9' in str(error.value)


def test_exit_zero_without_output_is_failure(installed, tmp_path, monkeypatch):
    monkeypatch.setattr(media, 'run_process', lambda *args: None)
    with pytest.raises(RuntimeError, match='without a complete output'):
        media.generate(request(), tmp_path, threading.Event(), lambda *_: None)


def test_reference_access_rechecked_at_execution(installed, tmp_path, monkeypatch):
    from services import generation_reference
    monkeypatch.setattr(generation_reference, 'reference_bytes', lambda _: (_ for _ in ()).throw(ValueError('locked')))
    with pytest.raises(ValueError, match='locked'):
        media.generate(request(references=['blob:x']), tmp_path, threading.Event(), lambda *_: None)


def test_backend_restart_marks_unfinished_jobs_failed(tmp_path, monkeypatch):
    monkeypatch.setattr(media, 'OUTPUT_DIR', tmp_path)
    identifier = 'a'*32; folder = tmp_path/identifier; folder.mkdir()
    (folder/'job.json').write_text(json.dumps({'id':identifier,'status':'running','created_at':1,
                                            'kind':'image','request':{'prompt':'test'}}))
    manager = media.MediaJobs()
    assert manager.snapshots()[0]['status'] == 'failed'
    assert not manager.tasks


def test_history_skips_malformed_receipts(tmp_path, monkeypatch):
    monkeypatch.setattr(media, 'OUTPUT_DIR', tmp_path)
    for index, value in enumerate([[], {'id': 123}, {'id': 'a'*32, 'created_at': 1}]):
        folder = tmp_path / str(index); folder.mkdir()
        (folder / 'job.json').write_text(json.dumps(value))
    assert media.MediaJobs().snapshots() == []


def test_generated_media_belongs_to_media_reset_section():
    from services.reset_scope import section_for
    assert section_for('generated_media') == 'media'


def test_api_rejects_uninstalled_models_and_nonfinite_settings(installed):
    app = FastAPI(); app.include_router(router)
    with TestClient(app) as client:
        response = client.post('/media-generation/jobs', json=request('missing'))
        assert response.status_code == 400
        assert client.post('/media-generation/jobs', json=dict(request(), guidance='NaN')).status_code == 422
        assert client.get('/media-generation/jobs/unknown/output').status_code == 404


def test_job_history_and_output_require_session_credential(installed):
    from services.session_guard import SessionGuard
    app = FastAPI(); app.include_router(router); app.add_middleware(SessionGuard)
    with TestClient(app, base_url='http://127.0.0.1:8000') as client:
        for path in ['/models', '/jobs', '/jobs/' + 'a'*32 + '/output']:
            assert client.get('/media-generation' + path).status_code == 403
        assert client.get('/media-generation/models', headers={'X-LAW-Session':'test-session-token'}).status_code == 200


def test_installer_rejects_paths_and_changed_hash(tmp_path):
    spec = importlib.util.spec_from_file_location('media_installer', Path(__file__).resolve().parents[2]/'scripts/install-media-models.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    for path in ['../x', 'C:/x', '/x', 'x\\y']:
        with pytest.raises(ValueError): module.checked_path(tmp_path, path)
    data = tmp_path/'model'; data.write_bytes(b'bad')
    with pytest.raises(ValueError, match='SHA-256'): module.verify(data, {'size':3, 'sha256':'0'*64})


def test_installer_all_and_runtime_only_options(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location('media_installer', Path(__file__).resolve().parents[2]/'scripts/install-media-models.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    calls = []
    monkeypatch.setenv('LAW_MEDIA_MODELS_DIR', str(tmp_path))
    monkeypatch.setattr(module, 'install_runtime', lambda root, cache: calls.append(('runtime', root)))
    monkeypatch.setattr(module, 'install_model', lambda name, root: calls.append((name, root)))
    monkeypatch.setattr(sys, 'argv', ['installer', '--runtime', '--all'])
    assert module.main() == 0
    assert calls == [('runtime', tmp_path), *[(name, tmp_path) for name in module.CATALOG['models']]]
    calls.clear()
    monkeypatch.setattr(sys, 'argv', ['installer', '--runtime'])
    assert module.main() == 0 and calls == [('runtime', tmp_path)]


def test_model_installer_recovers_pending_receipt_without_downloading(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location('media_installer', Path(__file__).resolve().parents[2]/'scripts/install-media-models.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    asset = {'repo':'test/model', 'revision':'pinned', 'file':'model.gguf', 'size':1,
             'sha256':hashlib.sha256(b'x').hexdigest()}
    monkeypatch.setattr(module, 'CATALOG', {'models':{'test':{'files':{'diffusion':asset}}}})
    directory = tmp_path / 'sdcpp/test'; directory.mkdir(parents=True)
    (directory / 'installation-manifest.part').write_text('{')
    target = tmp_path / 'sdcpp/shared/test--model/pinned/model.gguf'
    target.parent.mkdir(parents=True); target.write_bytes(b'x')
    module.install_model('test', tmp_path)
    assert json.loads((directory / 'installation-manifest.json').read_text())['files']['diffusion'].endswith('model.gguf')
    assert not (directory / 'installation-manifest.part').exists()


def test_runtime_installer_recovers_partial_file_and_checks_existing_files(tmp_path, monkeypatch):
    import zipfile
    spec = importlib.util.spec_from_file_location('media_installer', Path(__file__).resolve().parents[2]/'scripts/install-media-models.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    cache = tmp_path / 'cache'; cache.mkdir()
    archive = cache / 'runtime.zip'
    with zipfile.ZipFile(archive, 'w') as zipped:
        zipped.writestr('sd-cli.exe', b'complete')
    asset = {'file':archive.name, 'size':archive.stat().st_size,
             'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}
    monkeypatch.setattr(module, 'CATALOG', {'runtime':{'release':'test', 'assets':[asset]}})
    target = tmp_path / 'runtimes/sd-cpp/test'; target.mkdir(parents=True)
    (target / 'sd-cli.exe.part').write_bytes(b'partial')
    module.install_runtime(tmp_path, cache)
    assert (target / 'sd-cli.exe').read_bytes() == b'complete'
    assert (target / 'installation-manifest.json').is_file()
    (target / 'sd-cli.exe').write_bytes(b'other')
    with pytest.raises(ValueError, match='size mismatch'):
        module.install_runtime(tmp_path, cache)
    assert (target / 'sd-cli.exe').read_bytes() == b'other'


def test_runtime_log_stays_bounded_for_long_output_lines(tmp_path):
    media.run_process([sys.executable, '-c', "print('x' * (6 * 1024**2))"],
                      tmp_path, threading.Event(), lambda *_: None)
    assert (tmp_path / 'runtime.log').stat().st_size <= 5 * 1024**2


def test_queue_keeps_gpu_reserved_until_cancelled_process_exits(installed, monkeypatch):
    from services.gpu_coordination import GpuCoordinator
    from services.request_queue import RequestQueue
    from services.image_generation import manager as image_manager
    coordinator = GpuCoordinator(); task_queue = RequestQueue(coordinator)
    monkeypatch.setattr(media, 'queue', task_queue)
    async def prepare(_): pass
    monkeypatch.setattr(media, 'prepare_runtime', prepare)
    monkeypatch.setattr(image_manager, 'unload_for_training', lambda: None)
    started = threading.Event(); exited = threading.Event()
    def worker(request, directory, cancel, progress):
        started.set(); cancel.wait(10)
        assert coordinator.current_owner() is not None
        exited.set(); raise QueueCancelled()
    monkeypatch.setattr(media, 'generate', worker)
    async def exercise():
        manager = media.MediaJobs()
        identifier = await manager.submit(request())
        for _ in range(100):
            if started.is_set(): break
            await asyncio.sleep(.01)
        assert started.is_set()
        task = manager.tasks[identifier]
        await manager.cancel(identifier)
        await task
        assert exited.is_set() and coordinator.current_owner() is None
        assert manager.snapshots()[0]['status'] == 'cancelled'
        assert task_queue.active is None
    asyncio.run(exercise())


def test_cancel_after_provider_returns_does_not_publish_output(installed, monkeypatch):
    from services.gpu_coordination import GpuCoordinator
    from services.request_queue import RequestQueue
    from services.image_generation import manager as image_manager
    task_queue = RequestQueue(GpuCoordinator())
    monkeypatch.setattr(media, 'queue', task_queue)
    async def prepare(_): pass
    monkeypatch.setattr(media, 'prepare_runtime', prepare)
    monkeypatch.setattr(image_manager, 'unload_for_training', lambda: None)
    def worker(request, directory, cancel, progress):
        cancel.set()
        return 'output.png'
    monkeypatch.setattr(media, 'generate', worker)
    async def exercise():
        manager = media.MediaJobs()
        identifier = await manager.submit(request())
        await manager.tasks[identifier]
        item = manager.snapshots()[0]
        assert item['status'] == 'cancelled' and item['url'] is None
        assert task_queue.active is None
    asyncio.run(exercise())
