"""Explicit source-only GitHub publication; never pushes the development branch."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
ROOT_FILES = {'.gitignore', 'LICENSE', 'package.json', 'package-lock.json', 'vite.config.mjs', 'vitest.config.mjs', 'pytest.ini'}
EXTENSIONS = {'.py', '.js', '.jsx', '.mjs', '.cjs', '.css', '.html', '.md', '.json', '.txt', '.ps1', '.svg', '.ini', '.toml'}
PRIVATE_PARTS = {'data', 'models', 'logs', 'exports', 'backups', 'reports', 'artifacts', 'node_modules', 'venv', '.venv', '.git', '.codex', '.claude', 'runs', 'test-work', '__pycache__', 'dist', 'captures'}
GENERATED_DOCS = {'docs/application-review/index.html', 'docs/application-review/HISTORY.md', 'docs/application-review/AUDIT.md', 'build-info.json'}
# Public, licensed dependency asset required by the offline piano converter.
# Exact bytes are checked before capture and again in the outgoing tree.
BUNDLED_ASSETS = {'src/assets/piano-model/basic-pitch.bin': (742392, 'b142a95737a52e1e412d5f92e73d8bb80dfe8d04941acc0702f11f4524fb377c')}
TOKEN = re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|hf_[A-Za-z0-9]{25,}|sk-(?:proj-)?[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}')
HOME = re.compile(r'(?i)[a-z]:[\\/]+Users[\\/]+(?!Public\b|Default\b)[^\\/\s"\'<>]+|/(?:home|Users)/[^/\s"\'<>]+')
SECRET = re.compile(r'''(?i)(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*["'][^"'\r\n]{8,}["']''')
EMAIL = re.compile(r'(?i)[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}')


def emit(kind, **values):
    print(json.dumps({'kind': kind, **values}), flush=True)


def allowed(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or not path.parts or ':' in name or '\\' in name:
        return False
    if any(part.lower() in PRIVATE_PARTS for part in path.parts) or re.search(r'HANDOFF|ARCHITECTURE_CURRENT|ROADMAP_ORIGINAL|(^|/)\.env|(^|/)\.(npmrc|netrc|pypirc)$', name, re.I):
        return False
    if name in GENERATED_DOCS or name.startswith('docs/application-review/snapshots/'):
        return False
    if name in BUNDLED_ASSETS:
        return True
    if name in ROOT_FILES:
        return True
    if len(path.parts) == 1:
        return path.suffix == '.md' or (name.startswith('requirements') and path.suffix == '.txt')
    return (path.suffix.lower() in EXTENSIONS or path.name in {'LICENSE', 'NOTICE'}) and (path.parts[0] in {'src', 'backend', 'electron', 'scripts', 'tests', 'docs'} or name.startswith(('media-manager/frontend/', 'media-manager/tests/', 'media-manager/media_organizer/')) or name in {'media-manager/package.json', 'media-manager/README.md'})


def privacy_problem(name, raw):
    if name in BUNDLED_ASSETS:
        size, checksum = BUNDLED_ASSETS[name]
        return None if len(raw) == size and hashlib.sha256(raw).hexdigest() == checksum else 'Bundled dependency asset does not match its verified checksum'
    if len(raw) > 5 * 1024 * 1024:
        return 'Source file exceeds 5 MiB'
    try:
        text = raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        return 'Binary or non-UTF-8 file'
    if '\0' in text:
        return 'Binary file'
    if TOKEN.search(text):
        return 'Possible credential or private key'
    if not name.startswith('tests/') and (HOME.search(text) or SECRET.search(text) or EMAIL.search(text)):
        return 'Possible personal path or embedded credential'
    return None


def digest(raw):
    return hashlib.sha256(raw.replace(b'\r\n', b'\n')).hexdigest()


def publication_environment():
    environment = dict(os.environ)
    for key in ('GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_AUTHOR_DATE', 'GIT_COMMITTER_DATE'):
        environment.pop(key, None)
    environment.update(GIT_TERMINAL_PROMPT='0', GCM_INTERACTIVE='Never', GIT_AUTHOR_NAME='Local AI Workstation',
                       GIT_COMMITTER_NAME='Local AI Workstation', GIT_AUTHOR_EMAIL='local-ai-workstation@localhost',
                       GIT_COMMITTER_EMAIL='local-ai-workstation@localhost')
    return environment


def run(args, cwd, log, *, label='Git operation', input=None, timeout=120):
    environment = publication_environment()
    result = subprocess.run(args, cwd=cwd, input=input, capture_output=True, timeout=timeout, env=environment,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    with log.open('ab') as handle:
        handle.write((label + '\n').encode() + result.stdout + result.stderr)
    if result.returncode:
        raise RuntimeError(label + ' failed. See the publication log; sign in with Git for Windows if authentication is required.')
    return result.stdout


def git(root, log, *args, input=None):
    return run(['git', '-c', 'core.safecrlf=false', '-c', 'core.autocrlf=false', '-c', 'core.hooksPath=' + str(log.parent / 'no-hooks'),
                '-c', 'push.followTags=false', '-c', 'commit.gpgSign=false', '-c', 'push.gpgSign=false',
                '-c', 'user.name=Local AI Workstation', '-c', 'user.email=local-ai-workstation@localhost', *args], root, log, input=input)


def remote_url(value):
    match = re.fullmatch(r'(?:https://github\.com/|git@github\.com:)([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?/?', value)
    if not match:
        raise ValueError('Configure origin as a GitHub HTTPS or SSH repository URL without embedded credentials.')
    return 'https://github.com/' + match[1]


def blobs(root, log, revision):
    entries = []
    for item in git(root, log, 'ls-tree', '-r', '-z', revision).split(b'\0'):
        if item:
            header, name = item.split(b'\t', 1)
            mode, kind, oid = header.split()
            if mode not in {b'100644', b'100755'} or kind != b'blob':
                raise ValueError('Public source contains a link or submodule; review it outside the app.')
            entries.append((name.decode(), oid.decode()))
    raw = git(root, log, 'cat-file', '--batch', input=''.join(oid + '\n' for _, oid in entries).encode())
    files, offset = {}, 0
    for name, _ in entries:
        end = raw.index(b'\n', offset)
        size = int(raw[offset:end].split()[2])
        files[name] = raw[end + 1:end + 1 + size]
        offset = end + size + 2
    return files


def prepare(root, storage):
    folder = Path(tempfile.mkdtemp(prefix='github-', dir=storage))
    log = folder / 'publication.log'
    emit('progress', phase='Reviewing GitHub', log=str(log))
    url = git(root, log, 'remote', 'get-url', 'origin').decode().strip()
    display = remote_url(url)
    # Use the validated literal destination, not arbitrary push URLs/refspecs.
    head = git(root, log, 'ls-remote', '--symref', url, 'HEAD').decode()
    match = re.search(r'^ref: refs/heads/([^\s]+)\s+HEAD$', head, re.M)
    if not match:
        raise ValueError('GitHub default branch could not be determined.')
    branch = match[1]
    git(root, log, 'check-ref-format', 'refs/heads/' + branch)
    git(root, log, 'fetch', '--no-tags', url, 'refs/heads/' + branch)
    base = git(root, log, 'rev-parse', 'FETCH_HEAD').decode().strip()
    public = blobs(root, log, base)
    names = {value.decode() for value in git(root, log, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').split(b'\0') if value}
    deleted = {value.decode() for value in git(root, log, 'diff', '--name-only', '--diff-filter=D', '-z', 'HEAD').split(b'\0') if value}
    changes, blocked = [], []
    capture = folder / 'capture'
    capture.mkdir()
    emit('progress', phase='Capturing source changes')
    for name in sorted((names | deleted) & {name for name in names | deleted if allowed(name)}):
        source = root / name
        if name in deleted and not source.exists() and name in public:
            changes.append({'path': name, 'status': 'deleted', 'bytes': 0, 'sha256': None})
            continue
        if not source.is_file():
            continue
        if source.is_symlink() or source.resolve() != source.absolute() or not source.resolve().is_relative_to(root.resolve()):
            blocked.append({'path': name, 'reason': 'Linked or external source file'})
            continue
        before = source.stat()
        raw = source.read_bytes()
        after = source.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError('Source changed while capturing. Wait for edits to finish, then review again.')
        if name not in BUNDLED_ASSETS:
            raw = raw.replace(b'\r\n', b'\n')
        if name == '.gitignore':
            baseline = public.get(name, b'').decode()
            extra = [line for line in raw.decode().splitlines() if line and line not in baseline.splitlines()]
            raw = ((baseline.rstrip() + '\n' if baseline else '') + ('\n'.join(extra) + '\n' if extra else '')).encode()
        if name in public and digest(raw) == digest(public[name]):
            continue
        problem = privacy_problem(name, raw)
        if problem:
            blocked.append({'path': name, 'reason': problem})
            continue
        target = capture / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        changes.append({'path': name, 'status': 'modified' if name in public else 'added', 'bytes': len(raw), 'sha256': digest(raw)})
    preview = {'id': str(uuid.uuid4()), 'repository': display, 'branch': branch, 'base': base,
               'captured_at': datetime.now(timezone.utc).isoformat(), 'changes': changes, 'blocked': blocked}
    (folder / 'review.json').write_text(json.dumps({**preview, 'url': url}), encoding='utf-8')
    return {'preview': preview, 'folder': str(folder), 'log': str(log)}


def selected_changes(review, paths):
    if not isinstance(paths, list) or not paths or len(paths) > 5000 or any(not isinstance(value, str) for value in paths) or len(set(paths)) != len(paths):
        raise ValueError('Select at least one source change.')
    available = {item['path']: item for item in review['changes']}
    if any(path not in available for path in paths):
        raise ValueError('Selection does not match the reviewed source snapshot.')
    return [available[path] for path in paths]


def save_stage(folder, name, value):
    pending = folder / (name + '.pending')
    pending.write_text(json.dumps(value), encoding='utf-8')
    pending.replace(folder / name)


def validate(root, folder, paths):
    log = folder / 'publication.log'
    review = json.loads((folder / 'review.json').read_text(encoding='utf-8'))
    remote_url(review['url'])
    selected = selected_changes(review, paths)
    if (folder / 'committed.json').exists():
        raise ValueError('This snapshot already has a local commit. Review a new snapshot to change the selection.')
    # A failed revalidation must never leave an earlier selection marked valid.
    (folder / 'validated.json').unlink(missing_ok=True)
    workspace = folder / ('worktree-' + uuid.uuid4().hex[:8])
    emit('progress', phase='Preparing selected update')
    git(root, log, 'worktree', 'add', '--detach', str(workspace), review['base'])
    for item in selected:
        target = workspace / item['path']
        if item['status'] == 'deleted':
            target.unlink()
        else:
            raw = (folder / 'capture' / item['path']).read_bytes()
            if digest(raw) != item['sha256'] or privacy_problem(item['path'], raw):
                raise ValueError('Captured source was changed. Review a new snapshot.')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
    # Dependencies belong to this newly-created checkout. Never share a junction.
    node = shutil.which('node')
    npm = shutil.which('npm.cmd') if os.name == 'nt' else shutil.which('npm')
    npm_cli = Path(npm).parent / 'node_modules/npm/bin/npm-cli.js' if npm else Path('missing')
    if not node or not npm_cli.is_file():
        raise ValueError('Install Node.js with npm before publishing.')
    environment = {**publication_environment(), 'LAW_PYTHON': sys.executable, 'LAW_DATA_DIR': str(folder / 'test-data'),
                   'LAW_LOG_DIR': str(folder / 'test-data/logs'), 'LAW_MODELS_DIR': str(folder / 'test-models')}
    commands = [('Installing isolated dependencies', [node, str(npm_cli), 'ci', '--no-fund', '--no-audit']),
                ('Checking JavaScript dependencies', [node, str(npm_cli), 'audit']),
                ('Checking Python dependencies', [sys.executable, '-m', 'pip', 'check']),
                ('Testing frontend', [node, str(npm_cli), 'test']),
                ('Testing backend', [sys.executable, '-B', '-m', 'pytest', '--basetemp', str(folder / ('pytest-' + uuid.uuid4().hex[:8]))]),
                ('Testing Media Manager', [node, str(npm_cli), 'run', 'test:media']),
                ('Building application', [node, str(npm_cli), 'run', 'build'])]
    for label, command in commands:
        emit('progress', phase=label)
        with log.open('ab') as output:
            result = subprocess.run(command, cwd=workspace, env=environment, stdout=output, stderr=output, timeout=1200,
                                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode:
            raise RuntimeError(label + ' failed. Nothing was pushed. Open the publication log for details.')
    # Capture/build may regenerate public review documents, but never local history.
    for name in GENERATED_DOCS - {'build-info.json'}:
        file = workspace / name
        if file.is_file():
            file.write_bytes(file.read_bytes().rstrip() + b'\n')
    staged = {item['path'] for item in selected}
    if (workspace / 'docs/application-review/review.json').is_file():
        staged.update(name for name in GENERATED_DOCS if name != 'build-info.json' and (workspace / name).is_file())
        staged.update(file.relative_to(workspace).as_posix() for file in (workspace / 'docs/application-review/snapshots').glob('*.json'))
    # Only the selected paths and explicit regenerated reader assets are staged.
    source_paths = {item['path'] for item in selected}
    git(workspace, log, '--literal-pathspecs', 'add', '--pathspec-from-file=-', '--pathspec-file-nul', input=b'\0'.join(path.encode() for path in sorted(source_paths)) + b'\0')
    generated_paths = staged - source_paths
    if generated_paths:
        # Shared local excludes may hide reader snapshots. Only these explicit
        # generated assets may bypass ignores; the outgoing audit still applies.
        git(workspace, log, '--literal-pathspecs', 'add', '--force', '--pathspec-from-file=-', '--pathspec-file-nul', input=b'\0'.join(path.encode() for path in sorted(generated_paths)) + b'\0')
    emit('progress', phase='Auditing outgoing files')
    tree = git(workspace, log, 'write-tree').decode().strip()
    content = blobs(workspace, log, tree)
    public_commits = set(git(workspace, log, 'rev-list', review['base']).decode().splitlines())
    changed = {name.decode() for name in git(workspace, log, 'diff', '--cached', '--name-only', '-z').split(b'\0') if name}
    if not changed:
        raise ValueError('Selected source already matches GitHub. Nothing to publish.')
    for name in changed:
        if name not in staged or (name not in GENERATED_DOCS and not name.startswith('docs/application-review/snapshots/') and not allowed(name)):
            raise ValueError('Unexpected outgoing file. Review outside the app.')
        if name in content and privacy_problem(name, content[name]):
            raise ValueError('Outgoing privacy scan blocked ' + name + '. Nothing was pushed.')
        if name in content and name.startswith('docs/application-review/snapshots/'):
            snapshot = json.loads(content[name])
            references = {item['hash'] for item in snapshot['commits']}
            references.add(snapshot['git']['head'])
            references.add(snapshot['committed_baseline']['git']['head'])
            if snapshot.get('build_identity'):
                references.add(snapshot['build_identity']['source_commit'])
            if not references <= public_commits:
                raise ValueError('Review metadata contains history outside the public GitHub base. Nothing was pushed.')
    git(workspace, log, 'diff', '--cached', '--check')
    result = {'id': review['id'], 'base': review['base'], 'tree': tree, 'paths': sorted(paths),
              'changed': sorted(changed), 'files': len(changed), 'worktree': str(workspace),
              'validated_at': datetime.now(timezone.utc).isoformat()}
    save_stage(folder, 'validated.json', result)
    return result


def load_stage(root, folder, *, committed=False):
    log = folder / 'publication.log'
    review = json.loads((folder / 'review.json').read_text(encoding='utf-8'))
    remote_url(review['url'])
    name = 'committed.json' if committed else 'validated.json'
    if not (folder / name).is_file():
        raise ValueError('Commit locally before pushing.' if committed else 'Validate the selected changes before committing.')
    stage = json.loads((folder / name).read_text(encoding='utf-8'))
    workspace = Path(stage['worktree']).resolve()
    if workspace.parent != folder.resolve() or not workspace.name.startswith('worktree-') or not workspace.is_dir():
        raise ValueError('Prepared checkout is unavailable. Review and validate a new snapshot.')
    if stage['id'] != review['id'] or stage['base'] != review['base']:
        raise ValueError('Prepared update differs from the reviewed snapshot.')
    # Recheck both the index and files; never commit or push tampered validation.
    head = git(workspace, log, 'rev-parse', 'HEAD').decode().strip()
    expected_head = stage['commit'] if committed else review['base']
    if head != expected_head or git(workspace, log, 'write-tree').decode().strip() != stage['tree']:
        raise ValueError('Prepared checkout changed after validation. Review and validate again.')
    if committed and (git(workspace, log, 'rev-parse', 'HEAD^').decode().strip() != review['base'] or
                      git(workspace, log, 'rev-parse', 'HEAD^{tree}').decode().strip() != stage['tree']):
        raise ValueError('Local commit differs from the validated tree or public history.')
    content = blobs(workspace, log, stage['tree'])
    for name in stage['changed']:
        target = workspace / name
        if name not in content:
            if target.exists() or target.is_symlink():
                raise ValueError('Prepared source changed after validation.')
        elif (target.is_symlink() or not target.is_file() or target.resolve() != target.absolute() or
              target.read_bytes() != content[name]):
            raise ValueError('Prepared source changed after validation.')
    return review, stage, workspace, log


def commit_selected(root, folder, message):
    if (folder / 'committed.json').exists():
        raise ValueError('This update already has a local commit. Push it or review a new snapshot.')
    review, stage, workspace, log = load_stage(root, folder)
    if not isinstance(message, str) or not message.strip() or len(message) > 500 or '\0' in message:
        raise ValueError('Enter a commit message of at most 500 characters.')
    if privacy_problem('commit-message.txt', message.encode()):
        raise ValueError('Commit message may contain personal information or a credential.')
    emit('progress', phase='Committing selected update')
    body = folder / 'commit-message.txt'
    body.write_text(message.strip() + '\n', encoding='utf-8')
    git(workspace, log, 'commit', '-F', str(body))
    commit = git(workspace, log, 'rev-parse', 'HEAD').decode().strip()
    parent = git(workspace, log, 'rev-parse', 'HEAD^').decode().strip()
    if parent != review['base']:
        raise ValueError('Outgoing history differs from the reviewed GitHub base.')
    if git(workspace, log, 'rev-parse', 'HEAD^{tree}').decode().strip() != stage['tree']:
        raise ValueError('Local commit differs from the validated files.')
    # Keep a named ref so the local commit remains recoverable without a push.
    branch = 'codex/github-update-' + review['id']
    git(root, log, 'update-ref', 'refs/heads/' + branch, commit, '0' * len(commit))
    result = {**stage, 'commit': commit, 'branch': branch, 'message': message.strip(),
              'committed_at': datetime.now(timezone.utc).isoformat()}
    save_stage(folder, 'committed.json', result)
    return result


def push_committed(root, folder):
    # Remote verification may have finished before the desktop got its result.
    # The retained local branch permits verification even after checkout cleanup.
    if (folder / 'published.json').is_file():
        review = json.loads((folder / 'review.json').read_text(encoding='utf-8'))
        remote_url(review['url'])
        result = json.loads((folder / 'published.json').read_text(encoding='utf-8'))
        log, commit = folder / 'publication.log', result['commit']
        if (result['id'] != review['id'] or result['base'] != review['base'] or
                git(root, log, 'rev-parse', commit + '^').decode().strip() != review['base'] or
                git(root, log, 'rev-parse', commit + '^{tree}').decode().strip() != result['tree']):
            raise ValueError('Saved publication differs from the validated local commit.')
        remote = git(root, log, 'ls-remote', review['url'], 'refs/heads/' + review['branch']).decode().split()[0]
        if remote != commit:
            raise ValueError('GitHub no longer points to this published commit. Review a new snapshot.')
        return result
    review, stage, workspace, log = load_stage(root, folder, committed=True)
    commit = stage['commit']
    latest = git(workspace, log, 'ls-remote', review['url'], 'refs/heads/' + review['branch']).decode().split()[0]
    if latest not in {review['base'], commit}:
        raise ValueError('GitHub changed after review. The local commit is retained; review a new snapshot before pushing.')
    emit('progress', phase='Pushing to GitHub')
    if latest != commit:
        git(workspace, log, 'push', review['url'], commit + ':refs/heads/' + review['branch'])
    remote = git(workspace, log, 'ls-remote', review['url'], 'refs/heads/' + review['branch']).decode().split()[0]
    if remote != commit:
        raise RuntimeError('Push completed but remote verification differed. Check GitHub before retrying.')
    result = {**stage, 'url': review['repository'] + '/commit/' + commit}
    save_stage(folder, 'published.json', result)
    # Only remove the worker's own checkout after a verified successful push.
    if workspace.resolve().parent != folder.resolve() or not workspace.name.startswith('worktree-'):
        raise ValueError('Publication completed; automatic checkout cleanup was skipped.')
    try:
        git(root, log, 'worktree', 'remove', '--force', str(workspace))
    except RuntimeError:
        pass  # Keep a recoverable checkout if Windows still holds an output open.
    return result


def publish(root, folder, paths, message):
    """Compatibility helper for release scripts; the desktop exposes separate steps."""
    validate(root, folder, paths)
    commit_selected(root, folder, message)
    return push_committed(root, folder)


def main():
    request = json.load(sys.stdin)
    storage = Path(request['storage']).resolve()
    storage.mkdir(parents=True, exist_ok=True)
    if request['action'] == 'prepare':
        result = prepare(ROOT, storage)
    elif request['action'] in {'validate', 'commit', 'push'}:
        folder = Path(request['folder']).resolve()
        if folder.parent != storage or not folder.name.startswith('github-'):
            raise ValueError('Invalid publication snapshot.')
        if request['action'] == 'validate':
            result = validate(ROOT, folder, request['paths'])
        elif request['action'] == 'commit':
            result = commit_selected(ROOT, folder, request['message'])
        else:
            result = push_committed(ROOT, folder)
    else:
        raise ValueError('Unknown publication action.')
    emit('result', result=result)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit('error', error=str(error) if isinstance(error, (ValueError, RuntimeError)) else 'Publication could not finish. Review the local log and retry; no force push is used.')
        sys.exit(1)
