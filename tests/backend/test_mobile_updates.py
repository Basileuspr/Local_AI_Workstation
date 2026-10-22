import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
from types import SimpleNamespace

from fastapi.testclient import TestClient
import pytest

from services.mobile_access import MobileAccess
from services.mobile_api import create_mobile_api
from services.mobile_jobs import MobileJobs
from services.mobile_updates import MobileUpdates, PUBLIC

OLD, NEW = 'a' * 24, 'b' * 24
ORIGIN = 'https://desktop.example.ts.net'


def write_release(directory, version):
    directory.mkdir(parents=True, exist_ok=True)
    files = {}
    for name in [*PUBLIC, 'assets/app.js']:
        file = directory / name
        file.parent.mkdir(exist_ok=True)
        file.write_text(f'{version}:{name}', encoding='utf-8')
        files[name] = hashlib.sha256(file.read_bytes()).hexdigest()
    (directory / 'client-version.json').write_text(json.dumps({'version': version, 'files': files}))


@pytest.fixture
def setup(tmp_path, monkeypatch):
    project = tmp_path / 'project'
    for name in ['backend', 'src', 'scripts', 'mobile', 'node_modules/vite/bin']:
        (project / name).mkdir(parents=True)
    (project / 'backend/app.py').write_text('initial backend')
    (project / 'mobile/app.js').write_text('initial phone')
    (project / 'node_modules/vite/bin/vite.js').write_text('fixture builder')
    assets = project / 'dist/mobile'
    write_release(assets, OLD)
    monkeypatch.setattr('services.mobile_updates.shutil.which', lambda name: 'node-fixture')
    calls = []

    def run(args, **options):
        calls.append((args, options))
        write_release(Path(args[-1]), NEW)
        return SimpleNamespace(returncode=0, stdout='built', stderr='')

    updater = MobileUpdates(assets, tmp_path / 'private', project=project, runner=run)
    return updater, project, calls


def test_publish_is_atomic_and_keeps_old_release_accessible(setup):
    update, project, calls = setup
    started, finish = threading.Event(), threading.Event()
    run = update.runner

    def paused(*args, **kwargs):
        result = run(*args, **kwargs)
        started.set()
        assert finish.wait(5)
        return result

    update.runner = paused
    assert update.start()['phase'] == 'building'
    assert started.wait(5)
    assert update.current()[1] == OLD
    with pytest.raises(ValueError, match='already building'):
        update.start()
    finish.set()
    update.thread.join(5)
    assert update.status()['phase'] == 'ready'
    assert update.current()[1] == NEW
    assert update.resolve('assets/app.js', OLD).read_text().startswith(OLD)
    assert update.resolve('assets/app.js', NEW).read_text().startswith(NEW)
    assert update.resolve('../private') is None
    assert update.resolve('client-version.json', NEW) is None
    assert update.release('../../private') is None
    args, options = calls[0]
    assert args[0] == 'node-fixture' and args[2] == 'build'
    assert options.get('shell') is None
    assert options['timeout'] == 180
    restored = MobileUpdates(update.assets, project / 'private', project=project)
    assert restored.current()[1] == NEW


@pytest.mark.parametrize('failure', ['build', 'corrupt', 'edit', 'backend_edit'])
def test_failed_build_never_replaces_the_active_shell(setup, failure):
    update, project, _ = setup
    run = update.runner

    def broken(args, **options):
        result = run(args, **options)
        if failure == 'build':
            result.returncode = 1
        elif failure == 'corrupt':
            (Path(args[-1]) / 'assets/app.js').write_text('changed after manifest')
        elif failure == 'edit':
            (project / 'mobile/app.js').write_text('changed during compile')
        else:
            (project / 'backend/app.py').write_text('changed backend')
        return result

    update.runner = broken
    update.start()
    update.thread.join(5)
    assert update.status()['phase'] == 'error'
    assert update.current()[1] == OLD
    assert not update.pointer.exists()
    assert not list(update.assets.parent.glob('.mobile-build-*'))


def test_changed_running_backend_requires_restart(setup):
    update, project, calls = setup
    (project / 'backend/app.py').write_text('new backend')
    assert update.status()['restart_required']
    with pytest.raises(ValueError, match='Restart the desktop'):
        update.start()
    assert not calls


def test_mobile_reports_version_but_cannot_request_a_build(setup, tmp_path):
    update, project, calls = setup
    jobs = MobileJobs(tmp_path / 'jobs', 'http://127.0.0.1:8000', 'test-token')
    access = MobileAccess(jobs.store)
    app = create_mobile_api(jobs, access, ORIGIN, update.assets, updates=update)
    headers = {'Origin': ORIGIN, 'X-LAW-Mobile': '1', 'X-LAW-Client-Version': OLD}
    with TestClient(app, base_url=ORIGIN) as client:
        assert client.get('/api/state').status_code == 401
        invite = access.invitation()
        peer = client.post('/api/pair', json={'code': invite['code'], 'name': 'Fixture phone'}, headers=headers).json()['device']
        response = client.get('/api/state', headers=headers)
        assert response.json()['client_update'] == {'version': OLD}
        assert response.headers['cache-control'] == 'no-store'
        update.start()
        update.thread.join(5)
        assert client.get('/api/state', headers=headers).json()['client_update'] == {'version': NEW}
        device = update.devices(access.devices())[0]
        assert device['id'] == peer['id'] and device['client_version'] == OLD and device['last_seen'] > 0
        assert client.get('/').text.startswith(NEW)
        assert client.get(f'/releases/{OLD}/assets/app.js').text.startswith(OLD)
        assert client.get(f'/releases/{NEW}/assets/app.js').text.startswith(NEW)
        assert client.get(f'/releases/{NEW}/client-version.json').status_code == 404
        assert client.post('/mobile/client-update', json={}, headers=headers).status_code in (404, 405)
        assert len(calls) == 1
        assert client.get('/api/state', headers={**headers, 'X-LAW-Client-Version': NEW}).status_code == 200
        assert update.devices(access.devices())[0]['client_version'] == NEW


def test_malformed_pointer_does_not_select_arbitrary_files(setup, tmp_path):
    update, _, _ = setup
    for value in [{'version': '../../private'}, [], {'version': NEW}]:
        update.pointer.write_text(json.dumps(value))
        assert update.current()[1] == OLD


def test_desktop_route_runs_builder_without_changing_listener(setup, monkeypatch):
    from routes import mobile
    from fastapi import FastAPI
    update, _, _ = setup
    service = SimpleNamespace(updates=update, status=lambda: {'running': False, 'client_update': update.status()})
    monkeypatch.setattr(mobile, 'companion', lambda: service)
    app = FastAPI()
    app.include_router(mobile.router)
    with TestClient(app) as client:
        response = client.post('/mobile/client-update')
        assert response.status_code == 200 and response.json()['running'] is False
        update.thread.join(5)
        assert update.status()['phase'] == 'ready'


@pytest.mark.skipif(sys.platform != 'win32' or not shutil.which('node'), reason='Windows Node pipe regression')
def test_build_finishes_while_desktop_control_is_reading_stdin(setup):
    update, project, _ = setup
    # Vite inspects stdin. On Windows that can block on an inherited handle
    # while the desktop shutdown watcher has a pending read on that handle.
    builder = project / 'node_modules/vite/bin/vite.js'
    builder.write_text("const fs=require('fs'); process.stdin.isTTY; "
                       f"fs.cpSync({json.dumps(str(update.assets))},process.argv.at(-1),{{recursive:true}});")
    helper = '''
import os, subprocess, sys, threading, time
from pathlib import Path
from services.mobile_updates import MobileUpdates
threading.Thread(target=lambda: os.read(0, 1), daemon=True).start()
time.sleep(.1)
def run(*args, **kwargs):
    kwargs['timeout'] = 3
    return subprocess.run(*args, **kwargs)
project = Path(sys.argv[1])
update = MobileUpdates(project / 'dist/mobile', project / 'private', project=project, runner=run)
update.build()
print(update.status()['phase'], flush=True)
'''
    environment = {**os.environ, 'PYTHONPATH': str(Path(__file__).resolve().parents[2] / 'backend')}
    with subprocess.Popen([sys.executable, '-c', helper, str(project)], stdin=subprocess.PIPE,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=environment) as child:
        try:
            # Keep the parent's control pipe open until the build completes.
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
            raise
        output, errors = child.communicate()
    assert child.returncode == 0, errors
    assert output.strip() == 'ready', output + errors
    assert update.current()[1] == OLD
