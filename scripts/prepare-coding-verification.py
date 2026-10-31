"""Explicit, separate installation of optional coding verification tools.

Nothing invokes this script during project discovery or task execution.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import urllib.request
import venv
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ARCHIVES = [
    ('apache-maven-3.10.0', 'https://dlcdn.apache.org/maven/maven-3/3.10.0/binaries/apache-maven-3.10.0-bin.zip', 'sha512',
     '22d31676d5b92ed53308c19ecded3245d0efd0cddfec51ec7bab62f4f13ad70ddddceff8e62940e0e8e2421f3cde8106737f4becec0aa034ffeff2a754e88337'),
    ('zig-x86_64-windows-0.17.0', 'https://ziglang.org/download/0.17.0/zig-x86_64-windows-0.17.0.zip', 'sha256',
     'b5663f69581dcf391293fbf16c06cb80d81d806545ce618b4d0bab7f0eb8c428'),
]


def checked(argv):
    subprocess.run(list(map(str, argv)), check=True, creationflags=0x08000000 if os.name == 'nt' else 0)


def archive(destination, name, url, algorithm, expected):
    if (destination / name).exists():
        print('Retaining existing tool: ' + name)
        return
    download = destination / (name + '.zip')
    with urllib.request.urlopen(url, timeout=90) as response, download.open('wb') as output:
        shutil.copyfileobj(response, output)
    if hashlib.new(algorithm, download.read_bytes()).hexdigest() != expected:
        raise ValueError('Archive checksum mismatch: ' + name)
    with zipfile.ZipFile(download) as bundle:
        for entry in bundle.infolist():
            target = (destination / entry.filename).resolve()
            if not target.is_relative_to(destination.resolve()) or entry.filename.startswith(('/', '\\')):
                raise ValueError('Unsafe archive member.')
        bundle.extractall(destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(os.environ.get('LAW_VERIFICATION_TOOLS', Path.home() / '.local-ai-workstation/verification-tools')))
    parser.add_argument('--native', action='store_true', help='Also install checksum-pinned Maven and portable C/C++ tools on Windows x64.')
    args = parser.parse_args()
    destination = args.root.resolve()
    if destination.is_relative_to(ROOT):
        raise ValueError('Choose a tool directory outside the source checkout.')
    destination.mkdir(parents=True, exist_ok=True)
    environment = destination / 'python'
    if not (environment / 'pyvenv.cfg').exists():
        venv.EnvBuilder(with_pip=True).create(environment)
    python = environment / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    checked([python, '-m', 'pip', 'install', '--disable-pip-version-check', '-r', ROOT / 'requirements-verification.txt'])
    checked([python, '-m', 'pip', 'check'])
    node = shutil.which('node')
    npm = shutil.which('npm')
    if not node or not npm:
        raise ValueError('Install Node.js with npm, then rerun this setup.')
    candidates = [Path(npm).resolve().parent / 'node_modules/npm/bin/npm-cli.js', Path(npm).resolve().parent / 'npm-cli.js',
                  Path(node).parent / 'node_modules/npm/bin/npm-cli.js', Path(node).parent.parent / 'lib/node_modules/npm/bin/npm-cli.js']
    cli = next((p for p in candidates if p.is_file()), None)
    if not cli:
        raise ValueError('Cannot locate npm-cli.js.')
    target = destination / 'node'; target.mkdir(exist_ok=True)
    for name in ['package.json', 'package-lock.json']:
        shutil.copy2(ROOT / 'scripts/verification-tools' / name, target / name)
    checked([node, cli, 'ci', '--prefix', target, '--ignore-scripts', '--no-fund', '--no-audit'])
    if args.native:
        if os.name != 'nt' or platform.machine().lower() not in {'amd64', 'x86_64'}:
            raise ValueError('Portable native archives are for Windows x64; install platform-native Maven and C/C++ tools instead.')
        for values in ARCHIVES:
            archive(destination, *values)
    (destination / 'installation.json').write_text(json.dumps({'format': 1, 'root': str(destination), 'native': args.native}), encoding='utf-8')
    print('Verification tools ready: ' + str(destination))
    print('Java/JVM checks also require an installed JDK. Project dependencies must be prepared before offline build/test checks.')


if __name__ == '__main__':
    main()
