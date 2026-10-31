"""Locate installed verification tools without executing project configuration."""
from __future__ import annotations
import json
import os
from pathlib import Path
import shutil
import re


def managed_root():
    return Path(os.environ.get('LAW_VERIFICATION_TOOLS', Path.home() / '.local-ai-workstation/verification-tools')).resolve()


def first_file(values):
    return next((str(Path(p).resolve()) for p in values if p and Path(p).is_file()), '')


def installed():
    root = managed_root()
    exe = '.exe' if os.name == 'nt' else ''
    python = root / ('python/Scripts/python.exe' if os.name == 'nt' else 'python/bin/python')
    android = {}
    try:
        android = json.loads((Path(os.environ.get('LOCALAPPDATA', '')) / 'LocalAIWorkstation/AndroidToolchain/toolchain.json').read_text())
        if not isinstance(android, dict):
            android = {}
    except (ValueError, OSError):
        pass
    java_homes = [Path(p) for p in [os.environ.get('JAVA_HOME'), android.get('java')] if p]
    # Portable verification installs need not modify the user's global PATH.
    java_homes += [root / 'jdk', *sorted((root / 'jdk').glob('*'), reverse=True)]
    javac = first_file([shutil.which('javac'), *(p / ('bin/javac' + exe) for p in java_homes)])
    java = first_file([Path(javac).with_name('java' + exe) if javac else None, shutil.which('java')])
    gradle_homes = [Path(p) for p in [os.environ.get('GRADLE_HOME')] if p]
    if android.get('gradle'):
        gradle_homes.append(Path(android['gradle']).parent.parent)
    gradle_command = shutil.which('gradle')
    if gradle_command:
        gradle_homes.insert(0, Path(gradle_command).resolve().parent.parent)
    gradle_homes += sorted(root.glob('gradle-*'), reverse=True)
    gradle = next((str(p.resolve()) for p in gradle_homes if (p / 'lib').is_dir()), '')
    maven_homes = [Path(p) for p in [os.environ.get('MAVEN_HOME'), os.environ.get('M2_HOME')] if p]
    if shutil.which('mvn'):
        maven_homes.insert(0, Path(shutil.which('mvn')).resolve().parent.parent)
    maven_homes += sorted(root.glob('apache-maven-*'), reverse=True)
    maven = next((str(p.resolve()) for p in maven_homes if (p / 'bin/m2.conf').is_file()), '')
    dotnet = first_file([Path(os.environ.get('ProgramFiles', '/nonexistent')) / 'dotnet/dotnet.exe', shutil.which('dotnet')])
    if dotnet and not (Path(dotnet).parent / 'sdk').is_dir():
        dotnet = ''
    cmake = first_file([shutil.which('cmake'), *root.glob('python/**/cmake/data/bin/cmake' + exe)])
    ninja = first_file([shutil.which('ninja'), root / ('python/Scripts/ninja.exe' if os.name == 'nt' else 'python/bin/ninja')])
    zig = first_file([shutil.which('zig'), *sorted(root.glob('zig-*/zig' + exe), reverse=True)])
    return {'root': str(root), 'python': str(python) if python.is_file() else '', 'node': shutil.which('node') or '',
            'java': java, 'javac': javac, 'gradle': gradle, 'maven': maven, 'dotnet': dotnet,
            'cmake': cmake, 'ninja': ninja, 'zig': zig,
            'cc': shutil.which('clang') or shutil.which('gcc') or '',
            'cxx': shutil.which('clang++') or shutil.which('g++') or ''}


def node_package(project, scope, package):
    """Prefer the project's dependency, then the optional managed validator set."""
    directory = project.root if scope == '.' else project.path(scope)
    while directory.is_relative_to(project.root):
        candidate = directory / 'node_modules' / package
        if (candidate / 'package.json').is_file():
            return str(candidate.resolve())
        if directory == project.root:
            break
        directory = directory.parent
    candidate = managed_root() / 'node/node_modules' / package
    return str(candidate.resolve()) if (candidate / 'package.json').is_file() else ''


def build_home(project, scope, kind, tools):
    """Honor a wrapper's declared version using installed files; never run/download it."""
    directory = project.root if scope == '.' else project.path(scope)
    relative = 'gradle/wrapper/gradle-wrapper.properties' if kind == 'gradle' else '.mvn/wrapper/maven-wrapper.properties'
    while directory.is_relative_to(project.root):
        wrapper = directory / relative
        if wrapper.is_file():
            wrapper = project.path(wrapper.relative_to(project.root).as_posix())
            if wrapper.stat().st_size > 128000:
                return '', 'Build wrapper properties exceed the inspection limit.'
            value = wrapper.read_text(encoding='utf-8-sig')
            pattern = r'gradle-([\w.\-]+)-(?:bin|all)\.zip' if kind == 'gradle' else r'apache-maven-([\w.\-]+)-bin\.zip'
            match = re.search(r'^distributionUrl\s*=.*?' + pattern, value, re.M)
            if not match:
                return '', 'Cannot determine the wrapper distribution version. Install and select a supported distribution explicitly.'
            version = match[1]
            candidates = [Path(tools[kind])] if tools[kind] else []
            candidates += list(Path(tools['root']).glob(('gradle-' if kind == 'gradle' else 'apache-maven-') + version))
            if kind == 'gradle':
                candidates += list((Path.home() / '.gradle/wrapper/dists').glob('gradle-' + version + '-*/*/gradle-' + version))
                found = next((p for p in candidates if (p / ('lib/gradle-core-' + version + '.jar')).is_file()), None)
            else:
                found = next((p for p in candidates if (p / ('lib/maven-core-' + version + '.jar')).is_file() and (p / 'bin/m2.conf').is_file()), None)
            return (str(found.resolve()), '') if found else ('', f'{kind.title()} {version} is required by {wrapper.relative_to(project.root).as_posix()} but is not installed. Prepare that version before verification; no wrapper download will run.')
        if directory == project.root:
            break
        directory = directory.parent
    return tools[kind], ''
