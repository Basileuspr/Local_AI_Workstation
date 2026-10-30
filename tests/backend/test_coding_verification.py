import asyncio
import json
from pathlib import Path
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.coding_coordinator import CodingCoordinator
from services.coding_project import Project, git, run_check
from services.coding_verification import VerificationStore, applies, discover, prepare, refresh
from test_coding_coordinator import project, FakeModel, call


def custom(project):
    return prepare(project, [], [{'name': 'Arithmetic', 'argv': [sys.executable, 'check.py'], 'timeout_seconds': 5}])


async def pending(manager):
    for _ in range(300):
        await asyncio.sleep(.01)
        if manager._active:
            run = manager.get(manager._active)
            if run.get('pending_approval'):
                return run
        if manager._task.done():
            raise AssertionError('Task ended before asking for approval')
    raise AssertionError('No approval request')


def test_discovery_reads_manifests_without_executing_scripts(project, monkeypatch):
    monkeypatch.setattr('services.coding_verification._npm', lambda: (['node', 'npm-cli.js'], ''))
    (project / 'package.json').write_text(json.dumps({'scripts': {'test': 'node malicious.js', 'pretest': 'echo pre',
        'lint': 'eslint .', 'build': 'vite build', 'dev': 'vite', 'test:watch': 'vitest --watch'},
        'devDependencies': {'typescript': '5'}}))
    (project / 'pytest.ini').write_text('[pytest]\n')
    (project / 'malicious.js').write_text("require('fs').writeFileSync('SHOULD_NOT_EXIST', 'bad')")
    result = discover(project)
    assert set(result['environments']) == {'Python', 'JavaScript / Node.js', 'TypeScript'}
    assert not (project / 'SHOULD_NOT_EXIST').exists()
    test = next(c for c in result['checks'] if c['name'] == 'test · .')
    assert 'pretest' in test['definition'] and test['category'] == 'tests'
    assert next(c for c in result['checks'] if c['name'] == 'test:watch · .')['unavailable']
    assert not any(c['name'] == 'dev · .' for c in result['checks'])
    assert next(c for c in result['checks'] if c['name'] == 'build · .')['recommended'] is False


def test_nested_projects_invalid_manifests_and_change_selection(project, monkeypatch):
    monkeypatch.setattr('services.coding_verification._npm', lambda: (['node', 'npm-cli.js'], ''))
    (project / 'web').mkdir()
    (project / 'web/package.json').write_text('{"scripts":{"test":"vitest run"}}')
    (project / 'pyproject.toml').write_text('[tool.pytest.ini_options]\n[tool.ruff]\n')
    (project / 'bad').mkdir()
    (project / 'bad/package.json').write_text('{bad')
    (project / 'bad/pytest.ini').write_text('missing section header')
    result = discover(project)
    assert any('bad/package.json' in w for w in result['warnings'])
    assert any('bad/pytest.ini' in w for w in result['warnings'])
    web = next(c for c in result['checks'] if c['source'] == 'web/package.json')
    python = next(c for c in result['checks'] if c['category'] == 'tests' and c['language'] == 'python')
    assert web['cwd'] == 'web'
    assert applies(web, ['web/src/App.tsx']) and not applies(web, ['calc.py'])
    assert applies(python, ['calc.py']) and not applies(python, ['web/src/App.tsx'])
    assert applies(web, ['web/package.json'])


def test_rust_and_go_recipes_are_fixed_and_missing_tools_visible(project, monkeypatch):
    (project / 'Cargo.toml').write_text('[package]\nname="fixture"\nversion="0.1.0"\n')
    (project / 'go.mod').write_text('module fixture\n')
    result = discover(project)
    rust = [c for c in result['checks'] if c['language'] == 'rust']
    go = [c for c in result['checks'] if c['language'] == 'go']
    assert len(rust) == len(go) == 3
    assert all(c['argv'][-1] == '--offline' for c in rust)
    assert all(c['argv'][-1] == './...' for c in go)


def test_profiles_and_grants_are_separate_and_definition_changes_invalidate(project, tmp_path):
    checks = custom(project)
    store = VerificationStore(tmp_path / 'settings')
    store.update(project, profile={'name': 'Daily', 'selected_checks': [], 'checks': [], 'verification_mode': 'approved'})
    assert not store.approved(project, checks[0])
    store.update(project, checks=checks)
    assert VerificationStore(tmp_path / 'settings').approved(project, checks[0])
    (project / 'check.py').write_text('print("changed command source")')
    changed = refresh(Project(project), checks[0])
    assert changed['fingerprint'] != checks[0]['fingerprint']
    assert not store.approved(project, changed)
    store.update(project, revoke=True)
    assert not store.read(project)['grants'] and 'Daily' in store.read(project)['profiles']
    path = next((tmp_path / 'settings').glob('*.json'))
    path.write_text('{broken')
    with pytest.raises(ValueError, match='retained'):
        store.update(project, checks=checks)
    assert path.read_text() == '{broken'
    for broken in [[], {'root': str(project), 'version': 1, 'profiles': {}, 'grants': {'test': []}}]:
        path.write_text(json.dumps(broken))
        with pytest.raises(ValueError, match='retained'):
            store.inspect(project)


@pytest.mark.parametrize('approve', [True, False])
def test_execution_waits_for_approval_and_denial_is_not_a_pass(project, tmp_path, approve):
    async def exercise():
        manager = CodingCoordinator(tmp_path / 'runs', FakeModel())
        row = await manager.start(str(project), 'Fix addition', 'local', custom(project), verification_mode='ask')
        run = await pending(manager)
        assert run['check_results'] == []
        assert run['pending_approval']['checks'][0]['cwd'] == str(project)
        request = run['pending_approval']['id']
        await manager.approve_verification(row['id'], request, approve, remember=True)
        with pytest.raises(ValueError, match='stale'):
            await manager.approve_verification(row['id'], request, approve)
        await manager._task
        result = manager.get(row['id'])
        assert result['status'] == ('completed' if approve else 'needs_review'), result
        check = result['check_results'][-1]
        assert check['status'] == ('passed' if approve else 'not_run')
        assert check['exit_code'] == (0 if approve else None)
        assert bool(manager.verification.read(project)['grants']) == approve
    asyncio.run(exercise())


def test_saved_approval_runs_without_prompt_and_manual_mode_still_waits(project, tmp_path):
    async def exercise():
        manager = CodingCoordinator(tmp_path / 'runs', FakeModel())
        checks = custom(project)
        manager.verification.update(project, checks=checks)
        first = await manager.start(str(project), 'Fix', 'local', checks, verification_mode='approved')
        await asyncio.wait_for(manager._task, 10)
        assert manager.get(first['id'])['status'] == 'completed'
        manager.provider = FakeModel(fix=False)
        second = await manager.start(str(project), 'Verify', 'local', checks, verification_mode='manual')
        run = await pending(manager)
        assert run['status'] == 'awaiting_verification'
        await manager.approve_verification(second['id'], run['pending_approval']['id'], False)
        await manager._task
        result = manager.get(second['id'])
        assert result['status'] == 'needs_review'
        assert result['check_results'][-1]['status'] == 'not_run'
    asyncio.run(exercise())


def test_manual_execution_and_pause_while_waiting(project, tmp_path):
    async def exercise():
        manager = CodingCoordinator(tmp_path / 'runs', FakeModel())
        row = await manager.start(str(project), 'Fix', 'local', custom(project), verification_mode='manual')
        run = await pending(manager)
        await manager.approve_verification(row['id'], run['pending_approval']['id'], True)
        await manager._task
        assert manager.get(row['id'])['status'] == 'completed'
        manager.provider = FakeModel(fix=False)
        row = await manager.start(str(project), 'Verify', 'local', custom(project), verification_mode='ask')
        await pending(manager)
        await manager.stop(row['id'], pause=True)
        await manager._task
        assert manager.get(row['id'])['status'] == 'paused'
        assert manager.get(row['id'])['pending_approval'] is None
    asyncio.run(exercise())


def test_manual_policy_blocks_model_requested_execution(project, tmp_path):
    class RequestCheck(FakeModel):
        async def complete(self, run, messages, contracts, cancel, phase):
            if phase == 'implementer' and run['rounds'] == 3:
                message = call('run_check')
                message['tool_calls'][0]['function']['arguments'] = {'name': 'Arithmetic'}
                return message, {}
            return await super().complete(run, messages, contracts, cancel, phase)

    async def exercise():
        manager = CodingCoordinator(tmp_path / 'runs', RequestCheck())
        row = await manager.start(str(project), 'Fix addition', 'local', custom(project), verification_mode='manual')
        run = await pending(manager)
        assert run['status'] == 'awaiting_verification'
        assert len(run['check_results']) == 1
        assert run['check_results'][0]['status'] == 'not_run'
        assert run['check_results'][0]['exit_code'] is None
        await manager.approve_verification(row['id'], run['pending_approval']['id'], True)
        await manager._task
        result = manager.get(row['id'])
        assert result['status'] == 'completed'
        assert result['check_results'][-1]['status'] == 'passed'
    asyncio.run(exercise())


def test_model_change_to_approved_check_requires_new_execution_approval(project, tmp_path):
    class ChangeCheck(FakeModel):
        async def complete(self, run, messages, contracts, cancel, phase):
            if phase == 'reviewer':
                return await super().complete(run, messages, contracts, cancel, phase)
            if run['rounds'] == 0:
                result = call('set_plan', steps=['Inspect the check', 'Update its message'])
            elif run['rounds'] == 1:
                result = call('read_file', path='check.py', start=1, lines=30)
            elif run['rounds'] == 2:
                result = call('replace_text', path='check.py', expected_hash=run['read_hashes']['check.py'], old='addition passed', new='addition verified')
            else:
                result = call('finish', summary='Check text updated')
            return result, {}
    async def exercise():
        manager = CodingCoordinator(tmp_path / 'runs', ChangeCheck())
        checks = custom(project)
        manager.verification.update(project, checks=checks)
        row = await manager.start(str(project), 'Update check message', 'local', checks, verification_mode='approved')
        run = await pending(manager)
        assert run['check_results'] == []
        assert 'changed' in run['pending_approval']['reason']
        await manager.approve_verification(row['id'], run['pending_approval']['id'], False)
        await manager._task
        assert manager.get(row['id'])['status'] == 'needs_review'
    asyncio.run(exercise())


def test_detected_npm_check_runs_with_actual_exit_and_nested_working_directory(project):
    import threading
    (project / 'web').mkdir()
    (project / 'web/package.json').write_text(json.dumps({'scripts': {'test': 'node -e "console.log(process.cwd()); process.exit(7)"'}}))
    check = next(c for c in discover(project)['checks'] if c['source'] == 'web/package.json')
    if check['unavailable']:
        pytest.skip(check['unavailable'])
    result = run_check(project / 'web', check, threading.Event(), lambda _: None)
    assert result['exit_code'] == 7 and result['status'] == 'failed'
    assert str(project / 'web') in result['output']
    assert Path(result['runtime_directory']).is_dir()


def test_routes_bind_approvals_to_displayed_definition_and_require_desktop(project, tmp_path, monkeypatch):
    from routes import coding_coordinator as routes
    monkeypatch.setenv('LAW_LOCAL_FILES_TOKEN', 'native-fixture')
    manager = CodingCoordinator(tmp_path / 'runs', FakeModel())
    monkeypatch.setattr(routes, 'manager', lambda: manager)
    app = FastAPI(); app.include_router(routes.router)
    client = TestClient(app)
    for route in ['inspect', 'revoke']:
        assert client.post('/coding/projects/' + route, json={'root': str(project)}).status_code == 403
    body = {'root': str(project), 'checks': [{'name': 'Arithmetic', 'argv': [sys.executable, 'check.py'], 'timeout_seconds': 5}]}
    headers = {'x-local-files': 'native-fixture'}
    assert client.post('/coding/projects/approve', json=body, headers=headers).status_code == 400
    check = custom(project)[0]
    body['expected_fingerprints'] = {check['id']: check['fingerprint']}
    assert client.post('/coding/projects/approve', json=body, headers=headers).status_code == 200
    (project / 'check.py').write_text('print("changed")')
    assert client.post('/coding/projects/approve', json=body, headers=headers).status_code == 400
    assert client.post('/coding/runs/' + 'a'*32 + '/verification-approval', json={'request_id': 'b'*32, 'approved': True}).status_code == 403
