import asyncio
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import zipfile

import httpx
import pytest

from services import app_updates, context_awareness as context, dependency_management as deps, environment_awareness as env


def manifests(root):
    (root / 'requirements.txt').write_text('psutil>=7.2,<8\nSQLAlchemy>=2,<3\ndiffusers>=0.35,<1\n')
    (root / 'requirements-core.txt').write_text('psutil==7.2.2\n')
    (root / 'requirements.lock.txt').write_text('psutil==7.2.2\n')
    (root / 'package.json').write_text(json.dumps({'version':'1.0.1-dev','dependencies':{'react':'^19.0.0'}}))


@pytest.mark.parametrize('latest,status', [('1.0.1','update_available'),('1.0.1-dev','up_to_date'),('0.9.0','up_to_date'),('invalid version','unable_to_check')])
def test_release_check(tmp_path, latest, status):
    manifests(tmp_path)
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request:httpx.Response(200,json={'version':latest}))) as client:
            return await app_updates.check_updates(tmp_path,'https://updates.example/manifest.json',client)
    result = asyncio.run(check())
    assert result['status'] == status
    assert result['automatic_update'] is False


def test_release_offline_and_missing_feed(tmp_path):
    manifests(tmp_path)
    def offline(request):
        raise httpx.ConnectError('offline')
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(offline)) as client:
            return await app_updates.check_updates(tmp_path,'https://updates.example/manifest.json',client)
    assert asyncio.run(check())['status'] == 'unable_to_check'
    assert asyncio.run(app_updates.check_updates(tmp_path,''))['latest_version'] is None
    assert asyncio.run(app_updates.check_updates(tmp_path,'http://example.com'))['status'] == 'unable_to_check'


def test_context_receipt_distinguishes_provider_counts_and_estimates():
    payload = {'model':'local','options':{'num_ctx':4096,'num_predict':1024},'messages':[
        {'role':'system','content':'Rolling session context from earlier in this chat. Summary'},
        {'role':'user','content':'Hello','images':['image']}]}
    estimate = context.payload_usage(payload)
    assert estimate['count_kind'] == 'estimate'
    assert estimate['system_tokens_estimate'] > 0 and estimate['image_tokens_estimate'] == 700
    assert estimate['summarization_occurred'] is True
    exact = context.payload_usage(payload, {'prompt_eval_count':300,'eval_count':20})
    assert exact['count_kind'] == 'provider_reported'
    assert exact['remaining_tokens'] == 3776
    assert exact['provider_trimming'] == 'unknown'
    assert context.payload_usage(payload, {'prompt_eval_count':-1})['count_kind'] == 'estimate'


def test_context_model_limit_matches_runtime_config(monkeypatch):
    monkeypatch.setattr(context, '_limits', {})
    limit = context.remember_limit('tiny', {'x.context_length':1024})
    assert limit == min(1024, context.settings.num_ctx)
    assert asyncio.run(context.model_limit('tiny')) == limit
    assert context.remember_limit('unknown', {}) == context.settings.num_ctx


def test_environment_missing_info_and_cache(monkeypatch):
    monkeypatch.setattr(env, '_static', None)
    monkeypatch.setattr(env.system_stats, 'read_hardware', lambda:{'system':{'os_name':'Test'},'warnings':['Unavailable details']})
    calls = []
    monkeypatch.setattr(env.system_stats, 'read_gpus', lambda:(calls.append(1) or [], 'No GPU info'))
    monkeypatch.setattr(env, 'package_version', lambda name:None)
    monkeypatch.setattr(env.system_stats, 'run_command', lambda args:(_ for _ in ()).throw(OSError('missing')))
    first = env.static_snapshot()
    assert first['pytorch']['cuda_available'] is None
    assert first['desktop_installed']['node'] is None
    assert first['gpus'] == [] and first['warnings']
    assert env.static_snapshot() is first and len(calls) == 1
    env.static_snapshot(refresh=True)
    assert len(calls) == 2


def test_dependency_constraints_profiles_missing_and_conflicting(tmp_path, monkeypatch):
    manifests(tmp_path)
    monkeypatch.setattr(deps, 'transitive_conflicts', lambda versions=None:[])
    report = deps.check_compatibility(tmp_path, {'psutil':'7.2.1','sqlalchemy':'3.0.0'})
    active = {row['name']:row for row in report['dependencies'] if row.get('profile') == 'requirements.txt'}
    assert active['psutil']['status'] == 'compatible'
    assert active['psutil']['updatable'] is True
    assert active['sqlalchemy']['status'] == 'conflict'
    assert active['diffusers']['status'] == 'missing'
    assert active['diffusers']['upgrade_risk'] == 'manual_review'
    baseline = [row for row in report['dependencies'] if row.get('profile') == 'requirements-core.txt']
    assert baseline[0]['status'] == 'conflict'
    with pytest.raises(ValueError): deps.check_compatibility(tmp_path, {}, 'unknown')


def update_plan(root, monkeypatch):
    manifests(root)
    wheel = root / 'target.whl'
    wheel.write_bytes(b'target')
    previous = root / 'old.whl'
    previous.write_bytes(b'old')
    versions = {'psutil':'7.2.1'}
    monkeypatch.setattr(deps, 'installed_versions', lambda:dict(versions))
    monkeypatch.setattr(deps, 'transitive_conflicts', lambda versions=None:[])
    record = lambda path:{'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    return {'name':'psutil','current':'7.2.1','target':'7.2.2','profile':'requirements.txt',
            'expires_at':__import__('time').time()+600,'fingerprint':deps.fingerprint(root,versions),
            'wheel':record(wheel),'rollback':record(previous)}, versions


def test_update_requires_approval_and_rejects_changed_environment(tmp_path, monkeypatch):
    plan, versions = update_plan(tmp_path, monkeypatch)
    calls = []
    monkeypatch.setattr(deps, 'run', lambda args: calls.append(args))
    with pytest.raises(ValueError): deps.apply_update(plan, False, tmp_path)
    versions['another'] = '1.0'
    with pytest.raises(ValueError): deps.apply_update(plan, True, tmp_path)
    assert not calls


def test_update_expiry_and_tampered_wheel(tmp_path, monkeypatch):
    plan, versions = update_plan(tmp_path, monkeypatch)
    plan['expires_at'] = 0
    with pytest.raises(ValueError): deps.apply_update(plan, True, tmp_path)
    plan['expires_at'] = __import__('time').time()+600
    Path(plan['wheel']['path']).write_bytes(b'tampered')
    with pytest.raises(ValueError): deps.apply_update(plan, True, tmp_path)


def test_failed_update_verifies_rollback(tmp_path, monkeypatch):
    plan, versions = update_plan(tmp_path, monkeypatch)
    calls = []
    def fail_then_restore(args):
        calls.append(args)
        if len(calls) == 1:
            versions['psutil'] = 'broken'
            raise RuntimeError('installation failed')
        versions['psutil'] = '7.2.1'
    monkeypatch.setattr(deps, 'run', fail_then_restore)
    result = deps.apply_update(plan, True, tmp_path)
    assert result['status'] == 'failed' and result['rollback_verified'] is True
    assert len(calls) == 2 and '--no-deps' in calls[0] and '--no-index' in calls[0]


def test_risky_target_refused(tmp_path):
    manifests(tmp_path)
    with pytest.raises(ValueError): deps.validate_target(tmp_path,'torch','2.11.0','requirements.txt')
    with pytest.raises(ValueError): deps.validate_target(tmp_path,'psutil','8.0','requirements.txt')


def make_wheel(folder, version):
    path = folder / f'psutil-{version}-py3-none-any.whl'
    dist = f'psutil-{version}.dist-info'
    with zipfile.ZipFile(path,'w') as archive:
        archive.writestr('psutil/__init__.py',f'__version__ = "{version}"\n')
        archive.writestr(f'{dist}/METADATA',f'Metadata-Version: 2.1\nName: psutil\nVersion: {version}\nRequires-Python: >=3.9\n')
        archive.writestr(f'{dist}/WHEEL','Wheel-Version: 1.0\nGenerator: test\nRoot-Is-Purelib: true\nTag: py3-none-any\n')
        archive.writestr(f'{dist}/RECORD','')
    return path


def test_actual_pip_update_in_isolated_environment(tmp_path, monkeypatch):
    """Exercise installation, scoped replacement and verification without network/user venv changes."""
    import sys
    from importlib import metadata
    root = tmp_path / 'project'; root.mkdir()
    manifests(root)
    (root / 'requirements.txt').write_text('psutil>=7.2,<8\n')
    venv = tmp_path / 'venv'
    subprocess.run([sys.executable,'-m','venv',str(venv)],check=True,capture_output=True,timeout=60)
    python = venv / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
    site = venv / ('Lib/site-packages' if sys.platform == 'win32' else f'lib/python{sys.version_info.major}.{sys.version_info.minor}/site-packages')
    before, after = make_wheel(tmp_path,'7.2.1'), make_wheel(tmp_path,'7.2.2')
    subprocess.run([str(python),'-m','pip','--isolated','--disable-pip-version-check','install','--no-index','--no-deps',str(before)],check=True,capture_output=True,timeout=45)
    original_dist = metadata.distributions
    monkeypatch.setattr(deps.metadata,'distributions',lambda:original_dist(path=[str(site)]))
    monkeypatch.setattr(deps.sys,'executable',str(python))
    real_run = deps.run
    def offline_download(args, timeout=120):
        if 'download' in args:
            destination = Path(args[args.index('--dest')+1])
            shutil.copy2(after if args[-1].endswith('7.2.2') else before,destination)
            return ''
        return real_run(args,timeout)
    monkeypatch.setattr(deps,'run',offline_download)
    plan = deps.prepare_update('psutil','requirements.txt',root)
    try:
        assert plan['status'] == 'approval_required'
        result = deps.apply_update(plan,True,root)
        assert result['status'] == 'success'
        assert deps.installed_versions() == {'psutil':'7.2.2','pip':deps.installed_versions()['pip']}
    finally:
        deps.discard(plan)


def test_awareness_http_contract_and_auth(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routes.system_stats import router
    from services.session_guard import SessionGuard
    from conftest import AUTH_HEADERS, API_BASE_URL
    from services import environment_awareness
    async def limit(model): return 1024
    monkeypatch.setattr(context, 'model_limit', limit)
    monkeypatch.setattr(environment_awareness, 'static_snapshot', lambda refresh=False:{'os':{},'gpus':[], 'warnings':['missing']})
    application = FastAPI()
    application.include_router(router)
    application.add_middleware(SessionGuard)
    with TestClient(application, base_url=API_BASE_URL) as client:
        assert client.get('/system/environment').status_code == 403
        assert client.post('/system/context',json={'model':'local','messages':[]},headers=AUTH_HEADERS).json()['configured_context_limit'] == 1024
        result = client.get('/system/environment',headers=AUTH_HEADERS).json()
        assert 'resources' not in result and 'services' not in result
        assert result['static']['gpus'] == []
        assert client.post('/system/context',json={'model':''},headers=AUTH_HEADERS).status_code == 422


def test_new_session_identity_preserves_previous_history(sessions_dir):
    from services import session_store
    first = session_store.create_session('Old chat')
    session_store.append_messages(first['id'], [{'id':'old','role':'user','content':'Keep this'}])
    second = session_store.create_session()
    assert second['id'] != first['id'] and len(second['id']) == 32
    assert second['messages'] == []
    assert session_store.get_session(first['id'])['messages'][0]['content'] == 'Keep this'
