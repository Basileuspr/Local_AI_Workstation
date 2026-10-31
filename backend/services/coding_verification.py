"""Read-only project discovery, verification profiles and explicit command grants."""
from __future__ import annotations

import configparser
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import threading
import time
import tomllib

from services.coding_project import Project, check_arguments, digest
from services.coding_language_checks import extend, CONFIG_NAMES, EXTENSIONS

MODES = {'ask', 'approved', 'manual'}
CONFIGS = {'package.json', 'package-lock.json', 'npm-shrinkwrap.json', '.npmrc',
           'pyproject.toml', 'pytest.toml', '.pytest.toml', 'pytest.ini', '.pytest.ini',
           'setup.cfg', 'tox.ini', 'requirements.txt', 'Cargo.toml', 'Cargo.lock',
           'go.mod', 'go.sum', 'tsconfig.json', 'vitest.config.js', 'vitest.config.mjs',
           'vitest.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.ts'}
LANGUAGES = {'python': {'.py', '.pyi'}, 'javascript': {'.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.css', '.scss', '.less', '.html', '.htm', '.json'},
             'rust': {'.rs', '.toml'}, 'go': {'.go', '.mod', '.sum'}}
CONFIGS |= CONFIG_NAMES
LANGUAGES.update(EXTENSIONS)


def command_category(name):
    first = re.split(r'[:_-]', name.lower())[0]
    return {'test': 'tests', 'tests': 'tests', 'lint': 'lint', 'typecheck': 'types',
            'type': 'types', 'check': 'types', 'build': 'build', 'audit': 'security',
            'security': 'security'}.get(first)


def _text(project, name):
    path = project.path(name)
    if path.stat().st_size > 128000:
        raise ValueError('Manifest exceeds the 128 KB inspection limit.')
    return path.read_text(encoding='utf-8-sig')


def _python(root):
    for folder in ('.venv', 'venv'):
        for relative in ('Scripts/python.exe', 'bin/python'):
            candidate = root / folder / relative
            if candidate.is_file():
                return str(candidate)
    return sys.executable


def _npm():
    node = shutil.which('node')
    npm = shutil.which('npm')
    if not node or not npm:
        return [], 'Node and npm must already be installed.'
    # Invoke npm's installed JavaScript entry point directly, never a .cmd shell wrapper.
    candidates = [Path(npm).resolve().parent / 'node_modules/npm/bin/npm-cli.js',
                  Path(npm).resolve().parent / 'npm-cli.js',
                  Path(node).parent / 'node_modules/npm/bin/npm-cli.js',
                  Path(node).parent.parent / 'lib/node_modules/npm/bin/npm-cli.js']
    cli = next((p for p in candidates if p.is_file()), None)
    return ([node, str(cli)] if cli else []), ('' if cli else 'Could not locate npm-cli.js; use an advanced Node check.')


def _fingerprint(project, check):
    inputs = {}
    for name in check['inputs']:
        try:
            path = project.path(name)
            inputs[name] = digest(path.read_bytes()) if path.is_file() and path.stat().st_size <= 128000 else 'unavailable'
        except (OSError, ValueError):
            inputs[name] = 'unavailable'
    tools = {}
    for arg in [*check['argv'][:2], *check.get('tool_inputs', [])]:
        path = Path(arg)
        if path.is_absolute() and path.is_file():
            stat = path.stat()
            tools[str(path)] = digest(path.read_bytes()) if stat.st_size <= 128000 else [stat.st_size, stat.st_mtime_ns]
        elif path.is_absolute() and path.is_dir():
            tools[str(path)] = path.stat().st_mtime_ns
    return digest(json.dumps({'policy_version': 1, 'argv': check['argv'], 'cwd': check['cwd'], 'timeout': check['timeout_seconds'],
                              'inputs': inputs, 'tools': tools}, sort_keys=True).encode())


def discover(root):
    project = root if isinstance(root, Project) else Project(root)
    paths = project.inventory()
    manifests = [name for name in paths if PurePosixPath(name).name in CONFIGS and len(PurePosixPath(name).parts) <= 6]
    warnings, checks, environments = [], [], set()
    if len(manifests) > 100:
        warnings.append('Inspection is limited to the first 100 configuration files. Use custom checks for additional packages.')
        manifests = manifests[:100]
    configs = set(manifests)
    npm, npm_error = _npm()

    def add(source, key, title, category, argv, language, *, definition='', unavailable='', runner=None, risk='',
            cwd=None, extra_inputs=(), tool_inputs=(), display_command='', recommended=None, timeout_seconds=120, identity=None):
        cwd = cwd if cwd is not None else str(PurePosixPath(source).parent)
        inputs = sorted(set(p for p in configs if str(PurePosixPath(p).parent) in {'.', cwd}) | set(extra_inputs))
        row = {'id': digest((identity or source + ':' + key).encode())[:24], 'name': f'{title} · {cwd}',
               'category': category, 'argv': argv, 'cwd': cwd, 'source': source, 'definition': definition,
               'language': language, 'inputs': inputs, 'timeout_seconds': timeout_seconds, 'kind': 'detected',
               'tool_inputs': list(tool_inputs), 'display_command': display_command,
               'runner': runner, 'recommended': recommended if recommended is not None else category in {'tests', 'lint', 'types'} and key in {'test', 'tests', 'pytest', 'check', 'lint', 'typecheck', 'type-check', 'ruff', 'mypy'},
               'risk': risk or 'Executes project code with your account permissions.', 'unavailable': unavailable}
        try:
            if not argv:
                raise ValueError(unavailable or 'Required tool is not installed.')
            row['argv'] = check_arguments(row)
        except ValueError as error:
            row['unavailable'] = str(error)
        row['fingerprint'] = _fingerprint(project, row)
        checks.append(row)
        return row

    python_roots = set()
    for name in manifests:
        base = PurePosixPath(name).name
        parent = PurePosixPath(name).parent
        try:
            if base == 'package.json':
                package = json.loads(_text(project, name))
                environments.add('JavaScript / Node.js')
                deps = {**package.get('dependencies', {}), **package.get('devDependencies', {})}
                if 'typescript' in deps or str(parent / 'tsconfig.json') in configs:
                    environments.add('TypeScript')
                scripts = package.get('scripts', {})
                if not isinstance(scripts, dict):
                    raise ValueError('scripts must be an object.')
                for script, command in list(scripts.items())[:60]:
                    category = command_category(script)
                    if not category or not isinstance(command, str):
                        continue
                    lifecycle = {key: scripts[key] for key in ('pre' + script, script, 'post' + script) if key in scripts}
                    unavailable = npm_error
                    if re.search(r'\b(watch|serve|dev|start)\b', script) or re.search(r'--watch\b|\b(vite|webpack)\s+serve\b', command):
                        unavailable = 'Interactive/watch commands are not eligible for automatic verification.'
                    language = 'python' if 'backend' in script or 'pytest' in command else 'javascript'
                    if re.search(r'android|gradle|mvn|javac', script + ' ' + command, re.I): language = 'jvm'
                    elif re.search(r'sqlfluff|(^|:)sql($|:)', script + ' ' + command, re.I): language = 'sql'
                    add(name, script, script, category, npm + ['run', script] if npm else [], language,
                        definition=json.dumps(lifecycle, ensure_ascii=False), unavailable=unavailable,
                        risk='npm scripts include pre/post lifecycle scripts and may run arbitrary project commands.')
            elif base == 'Cargo.toml':
                tomllib.loads(_text(project, name))
                environments.add('Rust')
                for command, title, category in [('test', 'Rust tests', 'tests'), ('check', 'Rust type check', 'types'), ('build', 'Rust build', 'build')]:
                    add(name, command, title, category, ['cargo', command, '--offline'], 'rust', runner='cargo',
                        risk='Cargo may execute build scripts; offline mode requires dependencies to be installed already.')
            elif base == 'go.mod':
                environments.add('Go')
                for command, title, category in [('test', 'Go tests', 'tests'), ('vet', 'Go static analysis', 'lint'), ('build', 'Go build', 'build')]:
                    add(name, command, title, category, ['go', command, './...'], 'go', runner='go',
                        risk='Go executes project tools/tests. Module downloads are disabled for these checks.')
            elif base in {'pyproject.toml', 'pytest.toml', '.pytest.toml', 'pytest.ini', '.pytest.ini', 'setup.cfg', 'tox.ini'}:
                text = _text(project, name)
                environments.add('Python')
                tools = {}
                if base.endswith('.toml'):
                    parsed = tomllib.loads(text)
                    tools = parsed.get('tool', {})
                    pytest = base in {'pytest.toml', '.pytest.toml'} or 'pytest' in tools
                else:
                    parser = configparser.ConfigParser(interpolation=None)
                    parser.read_string(text)
                    pytest = base in {'pytest.ini', '.pytest.ini'} or parser.has_section('pytest') or parser.has_section('tool:pytest')
                python = _python(project.root / str(parent))
                if pytest and str(parent) not in python_roots:
                    add(name, 'pytest', 'Python tests', 'tests', [python, '-m', 'pytest', '-q'], 'python')
                    python_roots.add(str(parent))
                for tool, category, args in [('ruff', 'lint', ['check', '.']), ('mypy', 'types', ['.'])]:
                    if tool in tools:
                        add(name, tool, tool, category, [python, '-m', tool, *args], 'python')
            elif base == 'requirements.txt':
                environments.add('Python')
        except (ValueError, OSError, TypeError, AttributeError, configparser.Error) as error:
            warnings.append(f'{name}: {str(error)[:180]}')
    if not python_roots and any(re.search(r'(^|/)test_[^/]+\.py$', p) for p in paths):
        source = next(p for p in paths if re.search(r'(^|/)test_[^/]+\.py$', p))
        add(source, 'pytest', 'Discovered Python tests', 'tests', [_python(project.root), '-m', 'pytest', '-q'], 'python',
            definition='Test filenames detected; no pytest configuration was found.')
        checks[-1]['cwd'] = '.'
        checks[-1]['fingerprint'] = _fingerprint(project, checks[-1])
        environments.add('Python')
    extend(project, paths, add, warnings, environments)
    if len(checks) > 80:
        warnings.append('Only the first 80 detected checks are shown.')
    checks.sort(key=lambda c: (c['cwd'] != '.', c['cwd'], not c['recommended'], c['category'], c['name']))
    return {'root': str(project.root), 'environments': sorted(environments), 'checks': checks[:80],
            'warnings': warnings[:30], 'inspection': 'Configuration files only; no project commands were executed.'}


def custom_check(project, value):
    argv = check_arguments(value)
    inputs = []
    for arg in argv[1:]:
        try:
            path = (project.root / arg).resolve()
            if path.is_file() and path.is_relative_to(project.root):
                name = path.relative_to(project.root).as_posix()
                project.path(name)
                inputs.append(name)
        except (ValueError, OSError):
            pass
    row = {'id': 'custom-' + digest(json.dumps([argv, value['timeout_seconds']], sort_keys=True).encode())[:24],
           'name': value['name'], 'argv': argv, 'timeout_seconds': value['timeout_seconds'], 'cwd': '.',
           'category': 'custom', 'language': 'all', 'kind': 'custom', 'inputs': inputs, 'source': 'Custom check',
           'definition': '', 'recommended': False, 'risk': 'User-defined Python/Node code; review arguments before approval.', 'unavailable': ''}
    row['fingerprint'] = _fingerprint(project, row)
    return row


def prepare(root, selected, custom):
    project = Project(root)
    catalog = {item['id']: item for item in discover(project)['checks']}
    if len(selected) != len(set(selected)) or any(key not in catalog for key in selected):
        raise ValueError('A selected check changed or disappeared. Inspect the project again.')
    checks = [catalog[key] for key in selected] + [custom_check(project, value) for value in custom]
    if not 1 <= len(checks) <= 12 or len({c['name'] for c in checks}) != len(checks):
        raise ValueError('Choose one to twelve checks with distinct names.')
    if any(c['unavailable'] for c in checks):
        raise ValueError('A selected tool is unavailable or interactive. Review the detected checks.')
    return checks


def refresh(project, check):
    if check.get('kind') != 'detected':
        return custom_check(project, check)
    current = next((c for c in discover(project)['checks'] if c['id'] == check['id']), None)
    if not current or current['unavailable']:
        raise ValueError('The selected check is no longer available. Inspect its project configuration.')
    return current


def applies(check, changed):
    if not changed or check.get('language', 'all') == 'all':
        return True
    cwd = check.get('cwd', '.')
    for name in changed:
        if name in check.get('inputs', []):
            return True
        if cwd != '.' and not name.startswith(cwd + '/'):
            continue
        if Path(name).suffix.lower() in LANGUAGES.get(check.get('language'), set()):
            return True
    return False


class VerificationStore:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.lock = threading.RLock()

    def _read(self, root):
        root = str(Path(root).resolve())
        path = self.directory / (digest(os.path.normcase(root).encode()) + '.json')
        value = {'version': 1, 'root': root, 'profiles': {}, 'grants': {}}
        if path.exists():
            try:
                value = json.loads(path.read_text(encoding='utf-8'))
                if not isinstance(value, dict) or value.get('root') != root or value.get('version') != 1 or not isinstance(value['profiles'], dict) or not isinstance(value['grants'], dict):
                    raise ValueError()
                for name, profile in value['profiles'].items():
                    if (not isinstance(profile, dict) or profile.get('name') != name or profile.get('verification_mode') not in MODES
                            or not isinstance(profile.get('selected_checks'), list) or not isinstance(profile.get('checks'), list)):
                        raise ValueError()
                if any(not isinstance(grant, dict) or not isinstance(grant.get('fingerprint'), str) for grant in value['grants'].values()):
                    raise ValueError()
            except (ValueError, KeyError, TypeError) as error:
                raise ValueError('Saved verification settings need recovery; the original file was retained.') from error
        return path, value

    def read(self, root):
        with self.lock:
            return self._read(root)[1]

    def update(self, root, *, profile=None, checks=None, revoke=False):
        with self.lock:
            path, value = self._read(root)
            if profile:
                value['profiles'][profile['name']] = profile
                if len(value['profiles']) > 20:
                    raise ValueError('At most twenty profiles can be saved per project.')
            if revoke:
                value['grants'] = {}
            for check in checks or []:
                value['grants'][check['id']] = {'fingerprint': check['fingerprint'], 'approved_at': time.time()}
            path.parent.mkdir(parents=True, exist_ok=True)
            temp = path.with_suffix('.tmp')
            temp.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
            os.replace(temp, path)
            return value

    def approved(self, root, check):
        return self.read(root)['grants'].get(check['id'], {}).get('fingerprint') == check['fingerprint']

    def inspect(self, root):
        catalog = discover(root)
        settings = self.read(root)
        for check in catalog['checks']:
            check['approved'] = settings['grants'].get(check['id'], {}).get('fingerprint') == check['fingerprint']
        return {**catalog, 'profiles': list(settings['profiles'].values())}
