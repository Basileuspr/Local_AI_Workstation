import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from services.coding_project import Project, digest, git, run_check, check_arguments
from services.coding_coordinator import CodingCoordinator, TOOLS, validate_call


@pytest.fixture
def project(tmp_path):
    root = tmp_path / 'project'
    root.mkdir()
    git(root, 'init')
    git(root, 'config', 'user.name', 'Coding fixture')
    git(root, 'config', 'user.email', 'fixture@example.invalid')
    (root / 'calc.py').write_text('def add(a, b):\n    return a - b\n', encoding='utf-8')
    (root / 'check.py').write_text('from calc import add\nassert add(2, 3) == 5\nprint("addition passed")\n', encoding='utf-8')
    (root / 'notes.txt').write_text('original\n', encoding='utf-8')
    (root / 'AGENTS.md').write_text('Preserve the public add function.\n', encoding='utf-8')
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'Fixture')
    return root


def test_scoped_edit_preserves_dirty_staged_and_untracked_files(project):
    (project / 'notes.txt').write_text('user edit\n')
    (project / 'draft.txt').write_text('user draft\n')
    git(project, 'add', 'notes.txt')
    workspace = Project(project)
    for name in ['notes.txt', 'draft.txt', 'AGENTS.md', '../outside.py', '.git/config', '.env', 'C:/outside.py', 'a/../calc.py', 'a//b.py', 'notes.txt ', 'notes.txt.', 'NUL']:
        with pytest.raises(ValueError):
            workspace.path(name, writing=True)
    before = (project / 'calc.py').read_bytes()
    with pytest.raises(ValueError, match='Stale'):
        workspace.replace('calc.py', 'wrong', 'a - b', 'a + b', lambda *_: None)
    receipts = []
    workspace.replace('calc.py', digest(before), 'a - b', 'a + b', lambda *value: receipts.append(value))
    assert len(receipts) == 1
    assert 'a + b' in (project / 'calc.py').read_text()
    assert (project / 'notes.txt').read_text() == 'user edit\n'
    assert (project / 'draft.txt').read_text() == 'user draft\n'
    workspace.verify()
    (project / 'calc.py').write_text('external edit\n')
    with pytest.raises(RuntimeError, match='outside'):
        workspace.verify()


def test_external_changes_and_nested_instructions(project):
    (project / 'src' / 'inner').mkdir(parents=True)
    (project / 'src' / 'AGENTS.md').write_text('Nested rules')
    workspace = Project(project)
    assert [item['path'] for item in workspace.instructions('src/inner/new.py')] == ['AGENTS.md', 'src/AGENTS.md']
    (project / 'notes.txt').write_text('another writer')
    with pytest.raises(RuntimeError, match='Another writer'):
        workspace.verify()


def test_new_file_and_interrupted_prewrite_have_distinct_absent_hash(project):
    workspace = Project(project)
    assert workspace.stamp('new.py') is None
    workspace.replace('new.py', None, '', 'value = 3', lambda *_: None)
    workspace.verify()
    assert (project / 'new.py').read_text() == 'value = 3'
    diff = CodingCoordinator.file_diff('new.py', workspace.changes['new.py'])
    assert '\\ No newline at end of file' in diff


def test_hardlink_and_symlink_rejected(project, tmp_path):
    outside = tmp_path / 'outside.py'
    outside.write_text('keep')
    os.link(outside, project / 'linked.py')
    workspace = Project(project)
    with pytest.raises(ValueError):
        workspace.path('linked.py', writing=True)
    try:
        (project / 'link').symlink_to(tmp_path, target_is_directory=True)
    except OSError:
        return  # Windows may disallow symlink creation; hardlink assertion still ran.
    with pytest.raises(ValueError, match='Links'):
        workspace.path('link/outside.py')


def test_checks_capture_exit_timeout_and_strip_credentials(project, monkeypatch):
    monkeypatch.setenv('LAW_SESSION_TOKEN', 'private-test-value')
    cancel = threading.Event()
    emitted = []
    result = run_check(project, {'name': 'environment', 'argv': [sys.executable, '-c',
        'import os; assert "LAW_SESSION_TOKEN" not in os.environ; print("safe")'], 'timeout_seconds': 5}, cancel, emitted.append)
    assert result['passed'] and 'safe' in result['output'] and emitted
    failed = run_check(project, {'name': 'failure', 'argv': [sys.executable, '-c', 'raise SystemExit(7)'], 'timeout_seconds': 5}, cancel, lambda _: None)
    assert failed['exit_code'] == 7 and not failed['passed']
    timed = run_check(project, {'name': 'timeout', 'argv': [sys.executable, '-c', 'import time; time.sleep(20)'], 'timeout_seconds': .15}, cancel, lambda _: None)
    assert timed['timed_out'] and not timed['passed']
    timer = threading.Timer(.15, cancel.set)
    timer.start()
    result = run_check(project, {'name': 'cancel', 'argv': [sys.executable, '-c', 'import time; time.sleep(20)'], 'timeout_seconds': 10}, cancel, lambda _: None)
    timer.join()
    assert result['cancelled'] and not result['passed']


def call(name, **args):
    return {'role': 'assistant', 'content': '', 'thinking': 'fixture', 'tool_calls': [{'function': {'name': name, 'arguments': args}}]}


class FakeModel:
    def __init__(self, *, fix=True, approve=True):
        self.fix, self.approve = fix, approve
        self.calls = []

    async def describe(self, model):
        return {'capabilities': ['tools']}

    async def complete(self, run, messages, contracts, cancel, phase):
        self.calls.append((run['model'], phase))
        if phase == 'reviewer':
            return call('submit_review', approved=self.approve, summary='Independent fixture review.'), {'eval_count': 5}
        step = run['rounds']
        if step == 0:
            result = call('set_plan', steps=['Inspect arithmetic', 'Fix addition', 'Run the configured check'])
        elif step == 1:
            result = call('read_file', path='calc.py', start=1, lines=30)
        elif step == 2 and self.fix:
            result = call('replace_text', path='calc.py', expected_hash=run['read_hashes']['calc.py'], old='a - b', new='a + b')
        else:
            result = call('finish', summary='Prepared addition change.')
        return result, {'eval_count': 10}


def test_end_to_end_other_model_actual_checks_and_preserved_changes(project, tmp_path):
    (project / 'notes.txt').write_text('user work')
    before_head = git(project, 'rev-parse', 'HEAD')
    async def exercise():
        provider = FakeModel()
        manager = CodingCoordinator(tmp_path / 'runs', provider)
        result = await manager.start(str(project), 'Fix addition', 'another-tool-model',
                                     [{'name': 'arithmetic', 'argv': [sys.executable, 'check.py'], 'timeout_seconds': 5}])
        await manager._task
        run = manager.get(result['id'])
        assert run['status'] == 'completed', run
        assert run['check_results'][-1]['passed']
        assert run['review']['approved']
        assert 'a + b' in run['changes'][0]['diff']
        assert run['protected_files'] == ['notes.txt']
        assert all(model == 'another-tool-model' for model, _ in provider.calls)
        assert provider.calls[-1][1] == 'reviewer'
        assert 'messages' not in run
        assert CodingCoordinator(tmp_path / 'runs', provider).get(result['id'])['status'] == 'completed'
    asyncio.run(exercise())
    assert (project / 'notes.txt').read_text() == 'user work'
    assert git(project, 'rev-parse', 'HEAD') == before_head


@pytest.mark.parametrize('fix,approve', [(False, True), (True, False)])
def test_failing_check_or_review_never_completes(project, tmp_path, fix, approve):
    async def exercise():
        manager = CodingCoordinator(tmp_path / 'runs', FakeModel(fix=fix, approve=approve))
        run = await manager.start(str(project), 'Fix addition', 'gpt-oss:20b',
                                  [{'name': 'check', 'argv': [sys.executable, 'check.py'], 'timeout_seconds': 5}])
        await manager._task
        assert manager.get(run['id'])['status'] == 'needs_review'
    asyncio.run(exercise())


def test_pause_resume_and_interrupted_write_are_reconciled(project, tmp_path):
    class Waiting(FakeModel):
        async def complete(self, run, messages, contracts, cancel, phase):
            while not cancel.is_set():
                await asyncio.sleep(.01)
            from services.request_queue import QueueCancelled
            raise QueueCancelled()
    async def exercise():
        manager = CodingCoordinator(tmp_path / 'runs', Waiting())
        row = await manager.start(str(project), 'Fix addition', 'local',
                                  [{'name': 'check', 'argv': [sys.executable, 'check.py'], 'timeout_seconds': 5}])
        await asyncio.sleep(.04)
        await manager.stop(row['id'], pause=True)
        await manager._task
        assert manager.get(row['id'])['status'] == 'paused'
        manager.provider = FakeModel()
        await manager.resume(row['id'])
        await manager._task
        assert manager.get(row['id'])['status'] == 'completed'
        saved = manager.get(row['id'], True)
        saved.update(status='running', pending_write={'path': 'calc.py', 'change': saved['changes']['calc.py'], 'expected_hash': 'old'})
        manager.save(saved)
        recovered = CodingCoordinator(tmp_path / 'runs', FakeModel(fix=False))
        assert recovered.get(row['id'])['status'] == 'interrupted'
        await recovered.resume(row['id'])
        await recovered._task
        assert recovered.get(row['id'])['status'] == 'completed'
    asyncio.run(exercise())


def test_unknown_tools_and_extra_arguments_rejected():
    for message in [call('shell', command='whoami'), call('read_file', path='a', start=1, lines=1, root='elsewhere')]:
        with pytest.raises(ValueError):
            validate_call(message['tool_calls'][0], TOOLS)
    with pytest.raises(ValueError, match='Python or Node'):
        check_arguments({'argv': ['git', 'push']})


@pytest.mark.skipif(os.name != 'nt', reason='Windows job-object containment')
def test_check_reaps_descendants_after_parent_exits(project):
    import psutil
    check = {'name': 'child', 'argv': [sys.executable, '-c',
        'import subprocess,sys; p=subprocess.Popen([sys.executable,"-c","import time;time.sleep(30)"]);print(p.pid,flush=True)'], 'timeout_seconds': 5}
    result = run_check(project, check, threading.Event(), lambda _: None)
    assert result['passed'], result
    child = int(result['output'].strip())
    for _ in range(50):
        if not psutil.pid_exists(child):
            break
        time.sleep(.02)
    assert not psutil.pid_exists(child)


def test_concurrent_start_and_project_lock(project, tmp_path):
    class Waiting(FakeModel):
        async def complete(self, run, messages, contracts, cancel, phase):
            while not cancel.is_set():
                await asyncio.sleep(.01)
            from services.request_queue import QueueCancelled
            raise QueueCancelled()
    async def exercise():
        first = CodingCoordinator(tmp_path / 'one', Waiting())
        checks = [{'name': 'check', 'argv': [sys.executable, 'check.py'], 'timeout_seconds': 5}]
        requests = await asyncio.gather(first.start(str(project), 'Fix', 'local', checks), first.start(str(project), 'Fix', 'local', checks), return_exceptions=True)
        assert sum(isinstance(item, RuntimeError) for item in requests) == 1
        second = CodingCoordinator(tmp_path / 'two', Waiting())
        await asyncio.sleep(.05)
        row = await second.start(str(project), 'Fix', 'local', checks)
        await second._task
        assert second.get(row['id'])['status'] == 'failed'
        await first.close()
    asyncio.run(exercise())


def test_routes_require_native_authority_and_valid_checks(monkeypatch):
    from routes.coding_coordinator import router
    monkeypatch.setenv('LAW_LOCAL_FILES_TOKEN', 'native-fixture')
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    body = {'root': 'ignored', 'goal': 'Fix it', 'model': 'local', 'checks': [{'name': 'check', 'argv': ['python']}], 'trusted_checks': True}
    assert client.post('/coding/runs', json=body).status_code == 403
    assert client.post('/coding/runs/' + 'a' * 32 + '/resume').status_code == 403
    assert client.post('/coding/runs', json={**body, 'trusted_checks': False}, headers={'x-local-files': 'native-fixture'}).status_code == 400
    assert client.post('/coding/runs', json={**body, 'checks': []}, headers={'x-local-files': 'native-fixture'}).status_code == 422


def test_corrupt_task_does_not_prevent_startup_or_get_discarded(tmp_path):
    directory = tmp_path / 'runs'
    directory.mkdir()
    path = directory / ('a' * 32 + '.json')
    path.write_text('{broken')
    manager = CodingCoordinator(directory, FakeModel())
    assert manager.listing()['warnings']
    assert manager.listing()['runs'] == []
    assert path.read_text() == '{broken'


@pytest.mark.parametrize('family,think', [('gptoss', 'low'), ('qwen35', True)])
def test_ollama_adapter_preserves_tool_stream_and_model_specific_thinking(monkeypatch, family, think):
    import httpx
    from services import coding_coordinator as module
    from services.request_queue import RequestQueue
    captured = []
    def handler(request):
        if request.url.path == '/api/show':
            return httpx.Response(200, json={'capabilities': ['tools', 'thinking'], 'details': {'family': family}})
        captured.append(json.loads(request.content))
        return httpx.Response(200, content=(json.dumps({'message': {'thinking': 'reason', 'tool_calls': call('list_files', contains='')['tool_calls']}, 'done': False}) + '\n' + json.dumps({'done': True, 'eval_count': 5}) + '\n').encode())
    real_client = httpx.AsyncClient
    monkeypatch.setattr(module.httpx, 'AsyncClient', lambda **kwargs: real_client(transport=httpx.MockTransport(handler)))
    async def prepare(*_args): pass
    async def handoff(*_args, **_kwargs):
        yield {}
    monkeypatch.setattr(module, 'prepare_runtime', prepare)
    monkeypatch.setattr(module, 'prepare_chat_model', handoff)
    isolated_queue = RequestQueue()
    monkeypatch.setattr(module, 'queue', isolated_queue)
    async def exercise():
        message, usage = await module.OllamaCodingModel('http://127.0.0.1:11434').complete(
            {'model': 'renamed-local-model', 'context_tokens': 8192}, [{'role': 'user', 'content': 'Inspect'}], TOOLS, threading.Event(), 'test')
        assert message['thinking'] == 'reason'
        assert message['tool_calls'][0]['function']['name'] == 'list_files'
        assert usage['eval_count'] == 5
        assert captured[0]['think'] == think
        assert captured[0]['model'] == 'renamed-local-model'
        assert isolated_queue.active is None
    asyncio.run(exercise())


def test_cancelling_ollama_stream_closes_it_before_releasing_gpu(monkeypatch):
    import httpx
    from services import coding_coordinator as module
    from services.request_queue import RequestQueue, QueueCancelled
    cancel = threading.Event()
    isolated_queue = RequestQueue()
    state = {'closed': False}
    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            cancel.set()
            await asyncio.sleep(60)
            yield b'never'
        async def aclose(self):
            assert isolated_queue.active is not None
            state['closed'] = True
    def handler(request):
        if request.url.path == '/api/show':
            return httpx.Response(200, json={'capabilities': ['tools']})
        return httpx.Response(200, stream=Stream())
    real_client = httpx.AsyncClient
    monkeypatch.setattr(module.httpx, 'AsyncClient', lambda **kwargs: real_client(transport=httpx.MockTransport(handler)))
    async def prepare(*_args): pass
    async def handoff(*_args, **_kwargs): yield {}
    monkeypatch.setattr(module, 'prepare_runtime', prepare)
    monkeypatch.setattr(module, 'prepare_chat_model', handoff)
    monkeypatch.setattr(module, 'queue', isolated_queue)
    async def exercise():
        with pytest.raises(QueueCancelled):
            await module.OllamaCodingModel('http://127.0.0.1:11434').complete(
                {'model': 'local', 'context_tokens': 8192}, [], TOOLS, cancel, 'test')
        assert state['closed'] and isolated_queue.active is None
        assert isolated_queue.jobs[-1].status == 'cancelled'
    asyncio.run(exercise())
