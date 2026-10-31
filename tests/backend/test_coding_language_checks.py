import asyncio
import json
from pathlib import Path
import subprocess
import threading

import pytest

from services.coding_coordinator import CodingCoordinator
from services.coding_project import Project, git, run_check, check_arguments
from services.coding_verification import discover, refresh, applies, VerificationStore
from services import coding_toolchains
from test_coding_coordinator import project, FakeModel, call
from test_coding_verification import pending


CASES = [
    ('sql', 'query.sql', 'SELECT 1 AS value;', 'SELECT FROM WHERE;'),
    ('html', 'index.html', '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Test</title></head><body><p>Hello</p></body></html>',
     '<!DOCTYPE html><html lang="en"><head><title>Test</title></head><body><div><span></div></body></html>'),
    ('css', 'style.css', '.fixture {\n  color: red;\n}\n', '.fixture {\n  colro: red;\n}\n'),
    ('javascript', 'view.jsx', 'export const View = () => <div>Hello</div>;', 'export const = <div>;'),
    ('typescript', 'types.ts', 'const value: number = 1;', 'const value: number = "wrong";'),
    ('java', 'Example.java', 'public class Example { public static int value() { return 1; } }', 'public class Example { public static int value() { return "wrong"; } }'),
    ('c', 'sample.c', '#include <stdio.h>\nint value(void) { return 1; }', '#include <stdio.h>\nint value(void) { return missing; }'),
    ('cpp', 'sample.cpp', '#include <vector>\nint value() { std::vector<int> values{1}; return values[0]; }', '#include <vector>\nint value() { return missing; }'),
    ('python', 'sample.py', 'value = 1\n', 'return 1\n'),
]


def selected(root, kind):
    return next(c for c in discover(root)['checks'] if len(c['argv']) > 3 and c['argv'][3] == kind)


@pytest.mark.parametrize('kind,name,good,bad', CASES, ids=[case[0] for case in CASES])
def test_actual_language_runner_accepts_valid_and_rejects_invalid_source(project, kind, name, good, bad):
    file = project / name
    file.write_text(good, encoding='utf-8')
    check = selected(project, kind)
    if check['unavailable']:
        pytest.skip(check['unavailable'])
    before = (project / 'notes.txt').read_bytes()
    result = run_check(project, check, threading.Event(), lambda _: None)
    assert result['passed'], result['output']
    file.write_text(bad, encoding='utf-8')
    result = run_check(project, refresh(Project(project), check), threading.Event(), lambda _: None)
    assert result['status'] == 'failed' and result['exit_code'] != 0, result
    assert file.read_text() == bad
    assert (project / 'notes.txt').read_bytes() == before
    assert result['cwd'] == str(project)


def test_source_check_identity_survives_new_files_and_dialect_invalidates_approval(project, tmp_path):
    (project / 'z.sql').write_text('SELECT 1;')
    first = selected(project, 'sql')
    store = VerificationStore(tmp_path / 'grants')
    store.update(project, checks=[first])
    (project / 'a.sql').write_text('SELECT 2;')
    again = refresh(Project(project), first)
    assert again['id'] == first['id'] and again['fingerprint'] == first['fingerprint']
    (project / '.law-verification.json').write_text('{"sql_dialect":"postgres"}')
    changed = refresh(Project(project), first)
    assert 'postgres' in changed['definition']
    assert not store.approved(project, changed)
    assert applies(changed, ['new.sql']) and not applies(changed, ['other.java'])


def test_missing_tools_remain_visible_and_discovery_never_executes_config(project, monkeypatch):
    fake = {key: '' for key in coding_toolchains.installed()}
    fake['root'] = str(project / 'absent-tools')
    monkeypatch.setattr('services.coding_language_checks.installed', lambda: fake)
    monkeypatch.setattr('services.coding_language_checks.node_package', lambda *_: '')
    (project / 'query.sql').write_text('SELECT 1;')
    (project / 'Example.java').write_text('public class Example {}')
    (project / 'build.gradle').write_text('throw new RuntimeException("Do not execute discovery")')
    (project / 'sample.cpp').write_text('int value() { return 1; }')
    catalog = discover(project)
    for kind in ['sql', 'gradle-test', 'cpp']:
        row = next(c for c in catalog['checks'] if len(c['argv']) > 3 and c['argv'][3] == kind)
        assert row['unavailable'].startswith('Missing ')
    assert 'Java / JVM (Gradle)' in catalog['environments']


def test_manifest_recipes_and_language_selection(project):
    for directory, name, text in [
        ('jvm', 'pom.xml', '<project/>'), ('kotlin', 'build.gradle.kts', 'plugins { kotlin("jvm") version "2.2.20" }'),
        ('native', 'CMakeLists.txt', 'project(Fixture C CXX)'), ('dotnet', 'Fixture.csproj', '<Project><IsTestProject>true</IsTestProject></Project>')]:
        (project / directory).mkdir()
        (project / directory / name).write_text(text)
    checks = discover(project)['checks']
    for kind, changed in [('maven-test', 'jvm/Main.java'), ('gradle-test', 'kotlin/Main.kt'), ('cmake-test', 'native/main.cpp'), ('dotnet-test', 'dotnet/Main.cs')]:
        check = next(c for c in checks if len(c['argv']) > 3 and c['argv'][3] == kind)
        assert applies(check, [changed]) and not applies(check, ['elsewhere/Main.java'])
        assert check['timeout_seconds'] == 300
    with pytest.raises(ValueError, match='Python or Node'):
        check_arguments({'argv': [coding_toolchains.installed()['java'], '-version']})


def test_invalid_explicit_configuration_is_reported(project):
    (project / 'query.sql').write_text('SELECT 1;')
    (project / '.law-verification.json').write_text('{"sql_dialect": "ansi; drop database"}')
    catalog = discover(project)
    assert any('Verification settings' in warning for warning in catalog['warnings'])
    assert not any(len(c['argv']) > 3 and c['argv'][3] == 'sql' for c in catalog['checks'])


def test_wrapper_version_is_enforced_without_execution(project, monkeypatch, tmp_path):
    installed = dict(coding_toolchains.installed())
    home = tmp_path / 'gradle-8.13'
    (home / 'lib').mkdir(parents=True)
    (home / 'lib/gradle-core-8.13.jar').write_bytes(b'fixture')
    installed['gradle'] = str(home)
    monkeypatch.setattr('services.coding_language_checks.installed', lambda: installed)
    (project / 'build.gradle').write_text('plugins { id "java" }')
    wrapper = project / 'gradle/wrapper/gradle-wrapper.properties'
    wrapper.parent.mkdir(parents=True)
    wrapper.write_text('distributionUrl=https\\://services.gradle.org/distributions/gradle-8.13-bin.zip')
    check = selected(project, 'gradle-test')
    assert not check['unavailable']
    fingerprint = check['fingerprint']
    wrapper.write_text('distributionUrl=https\\://services.gradle.org/distributions/gradle-0.0.0-bin.zip')
    with pytest.raises(ValueError, match='no longer available'):
        refresh(Project(project), check)
    changed = selected(project, 'gradle-test')
    assert '0.0.0 is required' in changed['unavailable']
    assert changed['fingerprint'] != fingerprint


def test_dotnet_projects_in_same_folder_have_distinct_names(project):
    for name in ['One.csproj', 'Two.csproj']:
        (project / name).write_text('<Project/>')
    checks = [c for c in discover(project)['checks'] if c['language'] == 'dotnet']
    assert len(checks) == len({c['name'] for c in checks}) == len({c['id'] for c in checks}) == 2


def test_large_ignored_sql_cannot_silently_pass(project):
    (project / 'query.sql').write_text('-- ' + 'large comment ' * 2000 + '\nSELECT FROM WHERE;')
    (project / '.sqlfluffignore').write_text('query.sql\n')
    check = selected(project, 'sql')
    if check['unavailable']:
        pytest.skip(check['unavailable'])
    result = run_check(project, check, threading.Event(), lambda _: None)
    assert not result['passed'] and 'SQL verification failed' in result['output'], result


def test_cmake_recipe_builds_and_runs_real_tests(project):
    (project / 'CMakeLists.txt').write_text('cmake_minimum_required(VERSION 3.20)\nproject(Fixture C)\nenable_testing()\nadd_executable(check main.c)\nadd_test(NAME arithmetic COMMAND check)\n')
    (project / 'main.c').write_text('int main(void) { return 0; }')
    check = selected(project, 'cmake-test')
    if check['unavailable'] or not coding_toolchains.installed()['zig']:
        pytest.skip('CMake and portable compiler are needed for live native acceptance.')
    result = run_check(project, check, threading.Event(), lambda _: None)
    assert result['passed'] and '100% tests passed' in result['output'], result['output']
    assert not (project / 'build').exists()
    (project / 'main.c').write_text('int main(void) { return 1; }')
    result = run_check(project, refresh(Project(project), check), threading.Event(), lambda _: None)
    assert not result['passed'] and 'tests failed' in result['output'], result['output']


def test_java_coding_task_waits_for_permission_and_preserves_user_edit(project, tmp_path):
    (project / 'Example.java').write_text('public class Example { public static int value() { return "wrong"; } }')
    git(project, 'add', 'Example.java'); git(project, 'commit', '-m', 'Java fixture')
    (project / 'notes.txt').write_text('Keep this user draft.')
    check = selected(project, 'java')
    if check['unavailable']:
        pytest.skip(check['unavailable'])

    class JavaModel(FakeModel):
        async def complete(self, run, messages, contracts, cancel, phase):
            if phase == 'reviewer':
                return await super().complete(run, messages, contracts, cancel, phase)
            step = run['rounds']
            if step == 0: message = call('set_plan', steps=['Fix Java return type', 'Compile Java'])
            elif step == 1: message = call('read_file', path='Example.java', start=1, lines=10)
            elif step == 2: message = call('replace_text', path='Example.java', expected_hash=run['read_hashes']['Example.java'], old='"wrong"', new='1')
            else: message = call('finish', summary='Fixed return value.')
            return message, {}

    async def exercise():
        manager = CodingCoordinator(tmp_path / 'runs', JavaModel())
        row = await manager.start(str(project), 'Fix Java compilation', 'local', [check], verification_mode='ask')
        waiting = await pending(manager)
        assert not waiting['check_results']
        await manager.approve_verification(row['id'], waiting['pending_approval']['id'], True)
        await manager._task
        result = manager.get(row['id'])
        assert result['status'] == 'completed', result
        assert result['check_results'][-1]['exit_code'] == 0
        assert (project / 'notes.txt').read_text() == 'Keep this user draft.'
    asyncio.run(exercise())
