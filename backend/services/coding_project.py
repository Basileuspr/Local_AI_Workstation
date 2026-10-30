"""Project-scoped text edits. Checks are trusted local programs, not an OS sandbox."""
from __future__ import annotations

import hashlib
from contextlib import suppress
import json
import os
from pathlib import Path, PurePosixPath
import queue as thread_queue
import re
import shutil
import signal
import stat
import subprocess
import sys
import threading
import time

MAX_FILE = 128_000
RESERVED = {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}
EXCLUDED = {'.git', 'node_modules', 'venv', '.venv', '__pycache__', '.pytest_cache',
            'data', 'models', 'dist', 'build', 'outputs', '.codex', '.ssh', '.aws'}


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def git(root, *args):
    result = subprocess.run(['git', '-c', 'core.fsmonitor=false', '-C', str(root), *args],
                            capture_output=True, timeout=30, creationflags=0x08000000 if os.name == 'nt' else 0)
    if result.returncode:
        raise ValueError(result.stderr.decode('utf-8', 'replace')[:1000] or 'Git inspection failed.')
    return result.stdout


def names(raw):
    return {name for name in raw.decode('utf-8', 'strict').split('\0') if name}


def permitted(name):
    parts = PurePosixPath(name).parts
    return (bool(parts) and not any(p.lower() in EXCLUDED for p in parts)
            and not any(p.lower().startswith('.env') or p.lower() in {'credentials', 'id_rsa', 'id_ed25519'}
                        or p.lower().endswith(('.pem', '.key', '.pfx', '.p12')) for p in parts))


def dirty(root):
    return (names(git(root, 'diff', '--name-only', '-z')) |
            names(git(root, 'diff', '--cached', '--name-only', '-z')) |
            names(git(root, 'ls-files', '--others', '--exclude-standard', '-z')))


def fingerprint(path):
    return digest(path.read_bytes()) if path.exists() else None


class Project:
    def __init__(self, root, baseline=None, changes=None):
        self.root = Path(root).resolve(strict=True)
        if not self.root.is_dir() or Path(git(self.root, 'rev-parse', '--show-toplevel').decode().strip()).resolve() != self.root:
            raise ValueError('Choose the Git repository root.')
        self.changes = changes if changes is not None else {}
        self.baseline = baseline or {
            'head': git(self.root, 'rev-parse', 'HEAD').decode().strip(),
            'index': digest(git(self.root, 'diff', '--cached', '--binary')),
            'protected': sorted(dirty(self.root)),
        }
        if baseline is None:
            self.baseline['protected_hashes'] = {
                name: self.stamp(name) for name in self.baseline['protected'] if permitted(name)}

    def path(self, name, *, writing=False):
        if not isinstance(name, str) or not name or '\\' in name or ':' in name or '\0' in name:
            raise ValueError('Use a relative project path with forward slashes.')
        parts = PurePosixPath(name).parts
        if str(PurePosixPath(name)) != name or name.startswith('/') or any(p in {'.', '..'} for p in name.split('/')) or not permitted(name):
            raise ValueError('This path is outside the permitted source files.')
        if any(part.rstrip(' .') != part or part.split('.')[0].upper() in RESERVED for part in parts):
            raise ValueError('Ambiguous or reserved filename.')
        path = self.root
        for part in parts:
            path = path / part
            if path.exists() or path.is_symlink():
                info = path.lstat()
                if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
                    raise ValueError('Links and junctions are not project file targets.')
                if writing and path.is_file() and info.st_nlink > 1:
                    raise ValueError('Hard-linked files cannot be edited.')
        if not path.resolve().is_relative_to(self.root):
            raise ValueError('Path leaves the selected project.')
        if os.path.normcase(str(path)) != os.path.normcase(str(path.resolve())):
            raise ValueError('Use the canonical project path, not a filesystem alias.')
        if writing and (os.path.normcase(name) in {os.path.normcase(p) for p in self.baseline['protected']} or path.name.lower() == 'agents.md'):
            raise ValueError('Pre-existing changes and project instructions are protected.')
        return path

    def stamp(self, name):
        try:
            path = self.path(name)
            if not path.exists():
                return None
            if path.is_file() and path.stat().st_size <= MAX_FILE:
                return fingerprint(path)
            return 'unavailable'
        except (OSError, ValueError):
            return 'unavailable'

    def verify(self):
        if git(self.root, 'rev-parse', 'HEAD').decode().strip() != self.baseline['head']:
            raise RuntimeError('The project commit changed. Start a new task after reviewing the saved diff.')
        if digest(git(self.root, 'diff', '--cached', '--binary')) != self.baseline['index']:
            raise RuntimeError('The Git index changed outside this task. Review it before continuing.')
        unexpected = {p for p in dirty(self.root) - set(self.baseline['protected']) - set(self.changes) if permitted(p)}
        if unexpected:
            raise RuntimeError('Another writer changed project files: ' + ', '.join(sorted(unexpected)[:8]))
        for name, expected in self.baseline.get('protected_hashes', {}).items():
            if self.stamp(name) != expected:
                raise RuntimeError('A protected pre-existing change was modified: ' + name)
        for name, change in self.changes.items():
            if self.stamp(name) != change['after_hash']:
                raise RuntimeError('A task file changed outside this coordinator: ' + name)

    def inventory(self):
        files = sorted(p for p in names(git(self.root, 'ls-files', '-z')) |
                       names(git(self.root, 'ls-files', '--others', '--exclude-standard', '-z')) if permitted(p))
        if len(files) > 20000:
            raise ValueError('This milestone supports at most 20,000 source paths per repository.')
        return files

    def instructions(self, name='README.md'):
        parent = PurePosixPath(name).parent
        directories = [PurePosixPath('.'), *reversed(list(parent.parents)[:-1]), parent] if str(parent) != '.' else [parent]
        output = []
        for directory in dict.fromkeys(directories):
            relative = str(directory / 'AGENTS.md')
            path = self.path(relative)
            if path.is_file():
                if path.stat().st_size > 24000:
                    raise ValueError('Project instructions exceed this milestone context limit: ' + relative)
                output.append({'path': relative, 'text': path.read_text(encoding='utf-8')})
        return output

    def read(self, name, start=1, lines=100):
        path = self.path(name)
        if not path.is_file() or path.stat().st_size > MAX_FILE:
            raise ValueError('Choose a text file of at most 128 KB.')
        raw = path.read_bytes()
        text = raw.decode('utf-8')
        if '\0' in text:
            raise ValueError('Binary files are not supported.')
        content = text.splitlines()
        excerpt = '\n'.join(f'{i + 1}: {line}' for i, line in enumerate(content) if start - 1 <= i < start - 1 + lines)
        return {'path': name, 'hash': digest(raw), 'total_lines': len(content),
                'text': excerpt[:14000], 'truncated': len(excerpt) > 14000,
                'instructions': self.instructions(name)}

    def replace(self, name, expected_hash, old, new, journal):
        self.verify()
        path = self.path(name, writing=True)
        existing = path.read_bytes() if path.exists() else None
        if existing is not None and len(existing) > MAX_FILE:
            raise ValueError('The file exceeds the edit limit.')
        if (digest(existing) if existing is not None else None) != expected_hash:
            raise ValueError('Stale file hash. Read the file again before editing.')
        if existing is None:
            if old or expected_hash is not None:
                raise ValueError('New files require an empty old value and null hash.')
            content = new
        else:
            text = existing.decode('utf-8')
            # Preserve source newlines while allowing the model to supply LF snippets.
            newline = '\r\n' if b'\r\n' in existing else '\n'
            old = old.replace('\r\n', '\n').replace('\n', newline)
            new = new.replace('\r\n', '\n').replace('\n', newline)
            if not old or text.count(old) != 1:
                raise ValueError('The old text must match exactly once; read a narrower section.')
            content = text.replace(old, new, 1)
        raw = content.encode('utf-8')
        if len(raw) > MAX_FILE or '\0' in content:
            raise ValueError('The result must be UTF-8 text of at most 128 KB.')
        before = self.changes.get(name, {}).get('before', existing.decode('utf-8') if existing is not None else None)
        change = {'before': before, 'after': content, 'after_hash': digest(raw)}
        # Persist the intended write before touching a source file. Recovery never replays it.
        journal(name, change)
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(path.name + '.law-' + os.urandom(6).hex())
        try:
            with temp.open('xb') as output:
                output.write(raw)
            self.path(name, writing=True)
            if fingerprint(path) != expected_hash:
                raise RuntimeError('The file changed while preparing its patch.')
            if path.exists():
                shutil.copymode(path, temp)
            os.replace(temp, path)
        finally:
            temp.unlink(missing_ok=True)
        self.changes[name] = change
        return {'path': name, 'hash': change['after_hash']}


def terminate_tree(process):
    if process.poll() is not None:
        return
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True, timeout=15,
                       creationflags=0x08000000)
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.wait(timeout=15)


def check_arguments(check):
    argv = list(check['argv'])
    executable = shutil.which(argv[0])
    if not executable:
        raise ValueError('Check executable is not installed: ' + argv[0])
    name = Path(executable).name.lower().removesuffix('.exe')
    if not re.fullmatch(r'node|python(?:\d+(?:\.\d+)*)?', name):
        raise ValueError('This milestone runs Python or Node checks directly, e.g. node node_modules/vitest/vitest.mjs run.')
    argv[0] = executable
    return argv


def run_check(root, check, cancel, emit):
    argv = check_arguments(check)
    # Avoid passing app/session/cloud credentials to project checks.
    allowed = {'PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'HOME',
               'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'LC_ALL', 'NUMBER_OF_PROCESSORS'}
    env = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    env.update(PYTHONIOENCODING='utf-8', PYTHONDONTWRITEBYTECODE='1', PYTHONNOUSERSITE='1', CI='1', NO_COLOR='1')
    if cancel.is_set():
        raise RuntimeError('Check cancelled before launch.')
    # On Windows a trusted wrapper waits until it belongs to a private job before
    # launching project code. Closing the job reaps descendants even if their parent exited.
    launched = [sys.executable, '-I', '-c', 'import json,subprocess,sys; sys.stdin.buffer.read(1); sys.exit(subprocess.call(json.loads(sys.argv[1]), stdin=subprocess.DEVNULL))', json.dumps(argv)] if os.name == 'nt' else argv
    process = subprocess.Popen(launched, cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               stdin=subprocess.PIPE if os.name == 'nt' else subprocess.DEVNULL, start_new_session=os.name != 'nt',
                               creationflags=(0x08000000 | 0x00000200) if os.name == 'nt' else 0)
    close_job = lambda: None
    if os.name == 'nt':
        try:
            from services.coding_process import contain
            close_job = contain(process)
            process.stdin.write(b'1')
            process.stdin.close()
        except BaseException:
            close_job()
            terminate_tree(process)
            process.stdout.close()
            if process.stdin:
                process.stdin.close()
            raise
    chunks = thread_queue.Queue(maxsize=64)
    stopped = threading.Event()
    def reader():
        try:
            while data := process.stdout.read1(4096):
                while not stopped.is_set():
                    try:
                        chunks.put(data, timeout=.1)
                        break
                    except thread_queue.Full:
                        pass
        finally:
            process.stdout.close()
    thread = threading.Thread(target=reader, daemon=True)
    thread.start()
    started = time.monotonic()
    tail = ''
    timed_out = False
    try:
        while process.poll() is None or thread.is_alive() or not chunks.empty():
            if process.poll() is not None:
                close_job()
            if cancel.is_set() or time.monotonic() - started > check['timeout_seconds']:
                timed_out = not cancel.is_set()
                terminate_tree(process)
                break
            try:
                tail = (tail + chunks.get(timeout=.1).decode('utf-8', 'replace'))[-32000:]
                emit(tail)
            except thread_queue.Empty:
                pass
    finally:
        stopped.set()
        close_job()
        terminate_tree(process)
        if os.name != 'nt':
            with suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
        thread.join(timeout=2)
    return {'name': check['name'], 'argv': check['argv'], 'exit_code': process.returncode, 'output': tail,
            'timed_out': timed_out, 'cancelled': cancel.is_set(), 'seconds': round(time.monotonic() - started, 2),
            'passed': process.returncode == 0 and not timed_out and not cancel.is_set()}
