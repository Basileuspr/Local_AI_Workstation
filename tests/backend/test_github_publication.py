"""Real disposable Git remotes verify privacy/history; validation tools are mocked."""
import importlib.util
import hashlib
import json
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('github_publication_worker', ROOT / 'scripts/publish-github.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), '-c', 'user.name=Test', '-c', 'user.email=test@localhost', *args], stderr=subprocess.DEVNULL).decode().strip()


@pytest.fixture
def repositories(tmp_path, monkeypatch):
    remote, seed, source, storage = [tmp_path / name for name in ('remote.git', 'seed', 'private-source', 'jobs')]
    remote.mkdir(); seed.mkdir(); source.mkdir(); storage.mkdir()
    git(remote, 'init', '--bare', '--initial-branch=main')
    git(seed, 'init', '--initial-branch=main')
    (seed / 'src').mkdir()
    (seed / 'src/ready.js').write_text('const version = 1;\n')
    (seed / '.gitignore').write_text('node_modules/\ndata/\n.env\n')
    git(seed, 'add', '.'); git(seed, 'commit', '-m', 'Public baseline')
    git(seed, 'remote', 'add', 'origin', str(remote)); git(seed, 'push', 'origin', 'main')
    git(source, 'init', '--initial-branch=private-development')
    (source / 'src').mkdir()
    (source / 'src/ready.js').write_text('const version = 1;\n')
    (source / 'PRIVATE_HANDOFF.md').write_text('Private historical note.\n')
    (source / '.gitignore').write_text('node_modules/\ndata/\n.env\n')
    git(source, 'add', '.'); git(source, 'commit', '-m', 'Private history must stay local')
    git(source, 'remote', 'add', 'origin', str(remote))
    (source / 'src/ready.js').write_text('const version = 2;\n')
    (source / 'src/unfinished.js').write_text('const unfinished = true;\n')
    (source / 'src/credential.js').write_text('const token = "ghp_" + "x".repeat(40);\n'.replace('"ghp_" + "x".repeat(40)', '"ghp_' + 'x' * 40 + '"'))
    (source / 'data').mkdir(); (source / 'data/chat.json').write_text('{"content":"private"}')
    (source / 'docs/application-review/snapshots').mkdir(parents=True)
    (source / 'docs/application-review/snapshots/private.json').write_text('{"commits":["private"]}')
    monkeypatch.setattr(publisher, 'remote_url', lambda value: 'https://github.com/example/app')
    original_run = publisher.subprocess.run
    checks = []
    def isolated_checks(command, **kwargs):
        if command[0] == 'git':
            return original_run(command, **kwargs)
        checks.append((command, kwargs))
        return subprocess.CompletedProcess(command, 0)
    monkeypatch.setattr(publisher.subprocess, 'run', isolated_checks)
    # Supply portable fake runtime discovery; no dependency installation is run.
    npm = tmp_path / 'runtime/npm.cmd'
    cli = npm.parent / 'node_modules/npm/bin/npm-cli.js'
    cli.parent.mkdir(parents=True); cli.write_text('')
    monkeypatch.setattr(publisher.shutil, 'which', lambda name: str(npm) if name.startswith('npm') else str(npm.parent / 'node.exe'))
    return source, seed, remote, storage, checks


@pytest.mark.parametrize('path', ['data/chat.json', 'models/weights.txt', '.env', '.env.production', 'src/.env', 'src/../../private.txt', '/absolute.py', 'C:/private.py', 'PRIVATE_HANDOFF.md', 'docs/application-review/snapshots/private.json', 'node_modules/pkg/index.js', 'src/output.wav'])
def test_private_and_escaping_paths_excluded(path):
    assert not publisher.allowed(path)


def test_source_snapshot_keeps_bundled_asset_licenses(repositories):
    source, _, _, storage, _ = repositories
    for name in ('src/fonts/LICENSE', 'src/fonts/NOTICE', 'data/fonts/LICENSE', 'node_modules/font/LICENSE'):
        target = source / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text('Copyright and redistribution notice.\n')
    result = publisher.prepare(source, storage)
    paths = {item['path'] for item in result['preview']['changes']}
    assert {'src/fonts/LICENSE', 'src/fonts/NOTICE'} <= paths
    assert not {'data/fonts/LICENSE', 'node_modules/font/LICENSE'} & paths
    capture = Path(result['folder']) / 'capture'
    assert (capture / 'src/fonts/LICENSE').read_text() == 'Copyright and redistribution notice.\n'


def test_verified_bundled_binary_is_preserved_and_tampering_is_blocked(repositories, monkeypatch):
    source, _, remote, storage, _ = repositories
    name = 'src/assets/piano-model/basic-pitch.bin'
    raw = b'\x00verified\r\nasset\xff'
    monkeypatch.setattr(publisher, 'BUNDLED_ASSETS', {name: (len(raw), hashlib.sha256(raw).hexdigest())})
    target = source / name
    target.parent.mkdir(parents=True)
    target.write_bytes(raw)
    with (source / '.gitignore').open('a') as handle:
        handle.write('*.bin\n!' + name + '\n')
    assert publisher.allowed(name)
    assert not publisher.allowed('src/assets/piano-model/other.bin')
    assert publisher.privacy_problem(name, raw + b'changed')
    result = publisher.prepare(source, storage)
    folder = Path(result['folder'])
    assert (folder / 'capture' / name).read_bytes() == raw
    publisher.publish(source, folder, ['.gitignore', name], 'Include verified bundled dependency')
    assert subprocess.check_output(['git', '-C', str(remote), 'show', 'main:' + name]) == raw
    target.write_bytes(raw + b'changed')
    rejected = publisher.prepare(source, storage)['preview']
    assert name not in {item['path'] for item in rejected['changes']}
    assert any(item['path'] == name and 'checksum' in item['reason'] for item in rejected['blocked'])


def test_generated_public_snapshots_survive_shared_local_excludes(repositories, monkeypatch):
    source, _, remote, storage, _ = repositories
    with (source / '.git/info/exclude').open('a') as handle:
        handle.write('\n/docs/application-review/snapshots/\n')
    result = publisher.prepare(source, storage)
    original_run = publisher.subprocess.run
    def public_metadata(command, **options):
        if command[-1] == 'build':
            docs = Path(options['cwd']) / 'docs/application-review'
            (docs / 'snapshots').mkdir(parents=True)
            (docs / 'review.json').write_text('{}')
            (docs / 'snapshots/generated.json').write_text(json.dumps({
                'commits': [{'hash': result['preview']['base']}], 'git': {'head': result['preview']['base']},
                'committed_baseline': {'git': {'head': result['preview']['base']}}
            }))
        return original_run(command, **options)
    monkeypatch.setattr(publisher.subprocess, 'run', public_metadata)
    publisher.publish(source, Path(result['folder']), ['src/ready.js'], 'Publish public reader snapshot')
    assert 'snapshots/generated.json' in git(remote, 'ls-tree', '-r', '--name-only', 'main')
    assert '/docs/application-review/snapshots/' in (source / '.git/info/exclude').read_text()


def test_source_snapshot_blocks_credentials_and_excludes_private_history(repositories):
    source, _, _, storage, _ = repositories
    result = publisher.prepare(source, storage)
    assert {item['path'] for item in result['preview']['changes']} == {'src/ready.js', 'src/unfinished.js'}
    assert result['preview']['blocked'] == [{'path': 'src/credential.js', 'reason': 'Possible credential or private key'}]
    capture = Path(result['folder']) / 'capture'
    assert not (capture / 'data').exists()
    assert not (capture / 'PRIVATE_HANDOFF.md').exists()
    assert not (capture / 'docs/application-review/snapshots').exists()
    with pytest.raises(ValueError, match='Selection'):
        publisher.selected_changes(result['preview'], ['src/credential.js'])


def test_selected_frozen_source_pushes_only_public_ancestry_and_preserves_live_edits(repositories):
    source, _, remote, storage, checks = repositories
    before = git(source, 'status', '--porcelain')
    original_head = git(source, 'rev-parse', 'HEAD')
    original_index = git(source, 'ls-files', '-s')
    result = publisher.prepare(source, storage)
    git(source, 'config', 'push.followTags', 'true')
    git(source, 'tag', '-a', 'local-sensitive-label', result['preview']['base'], '-m', 'Local tag must stay private')
    (source / 'src/ready.js').write_text('const version = 3;\n')
    published = publisher.publish(source, Path(result['folder']), ['src/ready.js'], 'Publish selected ready source')
    assert git(remote, 'rev-parse', 'main') == published['commit']
    assert git(remote, 'show', 'main:src/ready.js') == 'const version = 2;'
    assert git(remote, 'rev-parse', 'main^') == result['preview']['base']
    names = git(remote, 'ls-tree', '-r', '--name-only', 'main')
    assert 'PRIVATE_HANDOFF' not in names and 'unfinished' not in names and 'credential' not in names
    assert original_head not in git(remote, 'rev-list', 'main')
    assert not git(remote, 'tag', '--list')
    assert git(source, 'rev-parse', 'HEAD') == original_head
    assert git(source, 'ls-files', '-s') == original_index
    assert git(source, 'status', '--porcelain') == before
    assert (source / 'src/ready.js').read_text() == 'const version = 3;\n'
    assert len(checks) == 7
    assert all(Path(options['cwd']) != source and Path(options['cwd']).parent == Path(result['folder']) for _, options in checks)
    assert all(options['env']['LAW_DATA_DIR'].startswith(result['folder']) for _, options in checks)
    assert not Path(published['worktree']).exists()


def test_validation_and_local_commit_do_not_push_and_push_uses_the_same_commit(repositories):
    source, _, remote, storage, checks = repositories
    original_head = git(source, 'rev-parse', 'HEAD')
    original_index = git(source, 'ls-files', '-s')
    result = publisher.prepare(source, storage)
    folder, base = Path(result['folder']), result['preview']['base']
    with pytest.raises(ValueError, match='Validate'):
        publisher.commit_selected(source, folder, 'Update')
    with pytest.raises(ValueError, match='Commit locally'):
        publisher.push_committed(source, folder)
    validated = publisher.validate(source, folder, ['src/ready.js'])
    assert git(remote, 'rev-parse', 'main') == base
    assert git(Path(validated['worktree']), 'rev-parse', 'HEAD') == base
    assert len(checks) == 7
    (source / 'src/ready.js').write_text('const version = 99;\n')
    committed = publisher.commit_selected(source, folder, 'Local update')
    assert git(remote, 'rev-parse', 'main') == base
    assert git(source, 'rev-parse', committed['branch']) == committed['commit']
    assert git(source, 'rev-parse', 'HEAD') == original_head
    assert git(source, 'ls-files', '-s') == original_index
    with pytest.raises(ValueError, match='already has a local commit'):
        publisher.validate(source, folder, ['src/unfinished.js'])
    published = publisher.push_committed(source, folder)
    assert published['commit'] == committed['commit'] == git(remote, 'rev-parse', 'main')
    assert git(remote, 'show', 'main:src/ready.js') == 'const version = 2;'
    assert len(checks) == 7  # Commit/push reuse validation; neither repeats tests.


@pytest.mark.parametrize('tamper', ['working', 'index', 'head'])
def test_local_commit_rejects_changes_to_validated_checkout(repositories, tamper):
    source, _, remote, storage, _ = repositories
    result = publisher.prepare(source, storage)
    folder = Path(result['folder'])
    stage = publisher.validate(source, folder, ['src/ready.js'])
    workspace = Path(stage['worktree'])
    if tamper == 'head':
        git(workspace, 'commit', '-m', 'Unexpected commit')
    else:
        (workspace / 'src/ready.js').write_text('Unvalidated changes\n')
        if tamper == 'index':
            git(workspace, 'add', 'src/ready.js')
    with pytest.raises(ValueError, match='changed after validation'):
        publisher.commit_selected(source, folder, 'Update')
    assert git(remote, 'rev-parse', 'main') == result['preview']['base']


def test_failed_revalidation_invalidates_the_previous_selection(repositories, monkeypatch):
    source, _, remote, storage, _ = repositories
    result = publisher.prepare(source, storage)
    folder = Path(result['folder'])
    publisher.validate(source, folder, ['src/ready.js'])
    original_run = publisher.subprocess.run
    def failure(command, **options):
        return subprocess.CompletedProcess(command, 1) if command[-1] == 'test' else original_run(command, **options)
    monkeypatch.setattr(publisher.subprocess, 'run', failure)
    with pytest.raises(RuntimeError):
        publisher.validate(source, folder, ['src/unfinished.js'])
    with pytest.raises(ValueError, match='Validate'):
        publisher.commit_selected(source, folder, 'Update')
    assert not (folder / 'validated.json').exists()
    assert git(remote, 'rev-parse', 'main') == result['preview']['base']


def test_push_failure_retains_local_commit_for_retry(repositories, monkeypatch):
    source, _, remote, storage, _ = repositories
    result = publisher.prepare(source, storage)
    folder = Path(result['folder'])
    publisher.validate(source, folder, ['src/ready.js'])
    committed = publisher.commit_selected(source, folder, 'Update')
    original_git = publisher.git
    def failure(root, log, *args, **options):
        if args[0] == 'push':
            raise RuntimeError('Simulated authentication failure')
        return original_git(root, log, *args, **options)
    with monkeypatch.context() as simulated:
        simulated.setattr(publisher, 'git', failure)
        with pytest.raises(RuntimeError, match='authentication'):
            publisher.push_committed(source, folder)
    assert Path(committed['worktree']).is_dir()
    assert git(source, 'rev-parse', committed['branch']) == committed['commit']
    assert git(remote, 'rev-parse', 'main') == result['preview']['base']
    publisher.push_committed(source, folder)
    assert git(remote, 'rev-parse', 'main') == committed['commit']


def test_push_recovers_when_remote_already_received_the_commit(repositories):
    source, _, remote, storage, _ = repositories
    result = publisher.prepare(source, storage)
    folder = Path(result['folder'])
    publisher.validate(source, folder, ['src/ready.js'])
    committed = publisher.commit_selected(source, folder, 'Update')
    git(Path(committed['worktree']), 'push', str(remote), 'HEAD:main')
    assert publisher.push_committed(source, folder)['commit'] == committed['commit']
    assert not Path(committed['worktree']).exists()
    assert publisher.push_committed(source, folder)['commit'] == committed['commit']


def test_remote_changes_after_review_are_never_overwritten(repositories):
    source, seed, remote, storage, _ = repositories
    result = publisher.prepare(source, storage)
    (seed / 'README.md').write_text('Concurrent public update\n')
    git(seed, 'add', '.'); git(seed, 'commit', '-m', 'Concurrent update'); git(seed, 'push', 'origin', 'main')
    current = git(remote, 'rev-parse', 'main')
    with pytest.raises(ValueError, match='GitHub changed'):
        publisher.publish(source, Path(result['folder']), ['src/ready.js'], 'Publish source')
    assert git(remote, 'rev-parse', 'main') == current


def test_failed_checks_never_commit_or_push(repositories, monkeypatch):
    source, _, remote, storage, _ = repositories
    result = publisher.prepare(source, storage)
    original_run = publisher.subprocess.run
    def failure(command, **options):
        if command[-1] == 'test':
            return subprocess.CompletedProcess(command, 1)
        return original_run(command, **options)
    monkeypatch.setattr(publisher.subprocess, 'run', failure)
    with pytest.raises(RuntimeError, match='Testing frontend failed'):
        publisher.publish(source, Path(result['folder']), ['src/ready.js'], 'Publish source')
    assert git(remote, 'rev-parse', 'main') == result['preview']['base']


def test_reviewed_source_tampering_prevents_publication(repositories):
    source, _, remote, storage, checks = repositories
    result = publisher.prepare(source, storage)
    (Path(result['folder']) / 'capture/src/ready.js').write_text('Changed after review\n')
    with pytest.raises(ValueError, match='Captured source was changed'):
        publisher.publish(source, Path(result['folder']), ['src/ready.js'], 'Update')
    assert not checks
    assert git(remote, 'rev-parse', 'main') == result['preview']['base']


def test_selected_source_deletion_preserves_development_history(repositories):
    source, _, remote, storage, _ = repositories
    original_head = git(source, 'rev-parse', 'HEAD')
    (source / 'src/ready.js').unlink()
    result = publisher.prepare(source, storage)
    assert next(item for item in result['preview']['changes'] if item['path'] == 'src/ready.js')['status'] == 'deleted'
    publisher.publish(source, Path(result['folder']), ['src/ready.js'], 'Remove obsolete source')
    assert git(remote, 'ls-tree', '-r', '--name-only', 'main') == '.gitignore'
    assert git(source, 'rev-parse', 'HEAD') == original_head


def test_ignore_updates_retain_public_data_exclusions(repositories):
    source, _, remote, storage, _ = repositories
    local = '.env\nlocal-only/\n'
    (source / '.gitignore').write_text(local)
    result = publisher.prepare(source, storage)
    publisher.publish(source, Path(result['folder']), ['.gitignore'], 'Extend source exclusions')
    assert git(remote, 'show', 'main:.gitignore').splitlines() == ['node_modules/', 'data/', '.env', 'local-only/']
    assert (source / '.gitignore').read_text() == local


def test_generated_review_metadata_cannot_introduce_private_ancestry(repositories, monkeypatch):
    source, _, remote, storage, _ = repositories
    result = publisher.prepare(source, storage)
    original_run = publisher.subprocess.run
    def private_metadata(command, **options):
        if command[-1] == 'build':
            docs = Path(options['cwd']) / 'docs/application-review'
            (docs / 'snapshots').mkdir(parents=True)
            (docs / 'review.json').write_text('{}')
            (docs / 'snapshots/generated.json').write_text(json.dumps({
                'commits': [{'hash': 'private-history'}], 'git': {'head': result['preview']['base']},
                'committed_baseline': {'git': {'head': result['preview']['base']}}
            }))
        return original_run(command, **options)
    monkeypatch.setattr(publisher.subprocess, 'run', private_metadata)
    with pytest.raises(ValueError, match='history outside the public'):
        publisher.publish(source, Path(result['folder']), ['src/ready.js'], 'Publish source')
    assert git(remote, 'rev-parse', 'main') == result['preview']['base']


def test_inherited_git_identity_and_index_do_not_leak_or_change_live_staging(repositories, monkeypatch):
    source, _, remote, storage, _ = repositories
    original_index = git(source, 'ls-files', '-s')
    with monkeypatch.context() as environment:
        environment.setenv('GIT_AUTHOR_EMAIL', 'private@example.org')
        environment.setenv('GIT_COMMITTER_EMAIL', 'private@example.org')
        environment.setenv('GIT_INDEX_FILE', str(source / '.git/index'))
        result = publisher.prepare(source, storage)
        publisher.publish(source, Path(result['folder']), ['src/ready.js'], 'Update selected source')
    assert git(source, 'ls-files', '-s') == original_index
    assert git(remote, 'log', '-1', '--format=%ae %ce') == 'local-ai-workstation@localhost local-ai-workstation@localhost'


@pytest.mark.parametrize('url', ['https://github.com/example/app', 'git@github.com:example/app.git'])
def test_github_destinations(url):
    assert publisher.remote_url(url) == 'https://github.com/example/app'


@pytest.mark.parametrize('url', ['https://token@github.com/example/app', 'https://other.example/app', '--upload-pack=bad', 'https://github.com/example/app;cmd'])
def test_credential_and_arbitrary_destinations_rejected(url):
    with pytest.raises(ValueError):
        publisher.remote_url(url)
