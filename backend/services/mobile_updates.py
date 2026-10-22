"""Build and publish immutable phone shells without interrupting connected clients."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
import time

from config import PROJECT_ROOT

VERSION = re.compile(r"^[a-f0-9]{24}$")
PUBLIC = {"index.html", "sw.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"}


def public_file(name):
    return name in PUBLIC or bool(re.fullmatch(r"assets/[A-Za-z0-9_.-]+\.(js|css)", name))


def fingerprint(root, directories, files=()):
    digest = hashlib.sha256()
    paths = [file for directory in directories for file in (root / directory).rglob('*')
             if file.is_file() and '__pycache__' not in file.parts and file.suffix != '.pyc']
    paths += [root / name for name in files if (root / name).is_file()]
    for file in sorted(paths):
        digest.update(str(file.relative_to(root)).encode())
        digest.update(file.read_bytes())
    return digest.hexdigest()


def runtime_fingerprint(root):
    return fingerprint(root, ['backend'], ['requirements.txt', 'requirements-core.txt'])


# Capture at backend import, not the first time the Dashboard card is opened.
RUNTIME_FINGERPRINT = runtime_fingerprint(PROJECT_ROOT)


class MobileUpdates:
    def __init__(self, assets, private_root, *, project=PROJECT_ROOT, runner=subprocess.run):
        self.assets, self.project = Path(assets).resolve(), Path(project).resolve()
        self.releases = self.assets.parent / 'mobile-releases'
        self.pointer = self.assets.parent / 'mobile-current.json'
        self.log = Path(private_root) / 'client-update.log'
        self.runner = runner
        self.runtime = RUNTIME_FINGERPRINT if self.project == PROJECT_ROOT else runtime_fingerprint(self.project)
        self.lock = threading.RLock()
        self.thread = None
        self.result = {'phase': 'idle', 'message': ''}
        self.clients = {}

    @staticmethod
    def manifest(directory):
        try:
            value = json.loads((directory / 'client-version.json').read_text(encoding='utf-8'))
            return value if VERSION.fullmatch(value.get('version', '')) else None
        except (OSError, ValueError, TypeError, AttributeError):
            return None

    def release(self, version):
        if not isinstance(version, str) or not VERSION.fullmatch(version):
            return None
        baseline = self.manifest(self.assets)
        if baseline and baseline['version'] == version:
            return self.assets
        raw = self.releases / version
        target = raw.resolve()
        if self.releases.is_symlink() or self.releases.resolve().parent != self.assets.parent or raw.is_symlink() or target.parent != self.releases:
            return None
        value = self.manifest(target)
        return target if value and value['version'] == version else None

    def current(self):
        try:
            version = json.loads(self.pointer.read_text(encoding='utf-8')).get('version')
            target = self.release(version)
            if target:
                return target, version
        except (OSError, ValueError, TypeError, AttributeError):
            pass
        value = self.manifest(self.assets)
        return self.assets, value['version'] if value else None

    def resolve(self, relative, version=None):
        if not public_file(relative):
            return None
        directory = self.release(version) if version is not None else self.current()[0]
        if directory is None:
            return None
        target = (directory / relative).resolve()
        return target if target.is_relative_to(directory) and target.is_file() else None

    def seen(self, device_id, version):
        with self.lock:
            self.clients[device_id] = {'client_version': version, 'last_seen': time.time()}

    def devices(self, devices):
        with self.lock:
            return [{**device, **self.clients.get(device['id'], {})} for device in devices]

    def status(self):
        with self.lock:
            return {**self.result, 'version': self.current()[1],
                    'can_build': self.assets == self.project / 'dist' / 'mobile' and
                    (self.project / 'node_modules/vite/bin/vite.js').is_file(),
                    'restart_required': runtime_fingerprint(self.project) != self.runtime}

    def start(self):
        with self.lock:
            if self.thread and self.thread.is_alive():
                raise ValueError('A phone update is already building.')
            if not self.status()['can_build']:
                raise ValueError('Phone updates require this desktop checkout and its installed build dependencies.')
            if runtime_fingerprint(self.project) != self.runtime:
                raise ValueError('Desktop backend code changed. Restart the desktop after active jobs finish, then update the phone.')
            if not shutil.which('node'):
                raise ValueError('Node.js is unavailable. Restore the desktop build dependencies first.')
            self.result = {'phase': 'building', 'message': 'Building the phone update. Connected phones keep their current version.'}
            self.thread = threading.Thread(target=self.build, name='law-mobile-update', daemon=True)
            self.thread.start()
            return self.status()

    def validate(self, directory):
        value = self.manifest(directory)
        if not value or not isinstance(value.get('files'), dict) or not PUBLIC.issubset(value['files']):
            raise ValueError('The phone build is incomplete. The previous version remains available.')
        for name, digest in value['files'].items():
            file = (directory / name).resolve()
            if not public_file(name) or not file.is_relative_to(directory.resolve()) or not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != digest:
                raise ValueError('The phone build failed integrity checks. The previous version remains available.')
        if not any(name.startswith('assets/') and name.endswith('.js') for name in value['files']):
            raise ValueError('The phone build has no application script.')
        return value['version']

    def build(self):
        staging = None
        try:
            self.assets.parent.mkdir(parents=True, exist_ok=True)
            staging = Path(tempfile.mkdtemp(prefix='.mobile-build-', dir=self.assets.parent)).resolve()
            before = fingerprint(self.project, ['mobile', 'src', 'scripts'], ['package.json', 'package-lock.json'])
            result = self.runner([shutil.which('node'), str(self.project / 'node_modules/vite/bin/vite.js'),
                'build', '--config', str(self.project / 'mobile/vite.config.mjs'), '--outDir', str(staging)],
                # Vite must not inherit the desktop shutdown pipe. Its stdin
                # inspection can block behind the Windows parent-watch read.
                cwd=self.project, stdin=subprocess.DEVNULL, capture_output=True, text=True, errors='replace', timeout=180,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
            self.log.parent.mkdir(parents=True, exist_ok=True)
            self.log.write_text((result.stdout or '') + (result.stderr or ''), encoding='utf-8')
            if result.returncode:
                raise ValueError('Phone build failed. The previous version is still available. See mobile/client-update.log in desktop app data.')
            if before != fingerprint(self.project, ['mobile', 'src', 'scripts'], ['package.json', 'package-lock.json']) or runtime_fingerprint(self.project) != self.runtime:
                raise ValueError('Source changed during the build. Wait for edits to finish and retry; restart if backend code changed.')
            version = self.validate(staging)
            baseline = self.manifest(self.assets)
            if baseline and baseline['version'] == version and baseline != self.manifest(staging):
                raise ValueError('Build dependencies produced a different phone bundle for the same source. Perform a full desktop build before publishing it.')
            self.releases.mkdir(exist_ok=True)
            if self.releases.is_symlink() or self.releases.resolve().parent != self.assets.parent:
                raise ValueError('Phone release storage must be inside the desktop build folder.')
            destination = self.releases / version
            if destination.exists():
                if destination.is_symlink() or self.validate(destination) != version or self.manifest(destination) != self.manifest(staging):
                    raise ValueError('An existing phone release does not match this build.')
            else:
                staging.rename(destination)
                staging = None
            # Publish only after the complete immutable release is in place.
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', prefix='.mobile-current-', dir=self.assets.parent, delete=False) as output:
                json.dump({'version': version}, output)
                output.flush()
                os.fsync(output.fileno())
            os.replace(output.name, self.pointer)
            with self.lock:
                self.result = {'phase': 'ready', 'message': 'Update ready. Open phones can tap Update phone app; disconnected phones receive it when they reconnect.'}
        except Exception as error:
            with self.lock:
                self.result = {'phase': 'error', 'message': str(error) if isinstance(error, ValueError) else 'Phone update could not finish. The previous version is still available. Check desktop storage and build dependencies.'}
        finally:
            # Only our unique staging directory; never remove a published release.
            if staging and staging.parent == self.assets.parent and staging.name.startswith('.mobile-build-') and not staging.is_symlink():
                shutil.rmtree(staging, ignore_errors=True)
