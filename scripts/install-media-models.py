"""Install pinned local Qwen/Wan models and the Windows CUDA sd.cpp runtime."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CATALOG = json.loads((Path(__file__).with_name('media-model-catalog.json')).read_text())


def checked_path(root, relative):
    path = PurePosixPath(relative)
    if path.is_absolute() or '..' in path.parts or '\\' in relative or ':' in relative:
        raise ValueError('Unsafe relative installation path')
    target = root.joinpath(*path.parts)
    if target.resolve() != target or not target.resolve().is_relative_to(root.resolve()):
        raise ValueError('Installation paths must not traverse links or junctions')
    return target


def verify(path, spec):
    if path.stat().st_size != spec['size']:
        raise ValueError('Downloaded file size mismatch: ' + path.name)
    with path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if digest != spec['sha256']:
        raise ValueError('Downloaded SHA-256 mismatch: ' + path.name)


def install_model(name, root):
    from huggingface_hub import hf_hub_download
    spec = CATALOG['models'][name]
    directory = checked_path(root, 'sdcpp/' + name)
    manifest_path = checked_path(root, 'sdcpp/' + name + '/installation-manifest.json')
    if directory.exists() and not manifest_path.exists():
        # A crash after verified weights are installed can leave only the pending receipt.
        if any(path.name != 'installation-manifest.part' for path in directory.iterdir()):
            raise ValueError('Preserving an unrecognized model directory: ' + name)
    if manifest_path.exists():
        previous = json.loads(manifest_path.read_text())
        if previous.get('spec') != spec:
            raise ValueError('Preserving a different model revision: ' + name)
    files = {}
    for role, asset in spec['files'].items():
        relative = 'sdcpp/shared/' + asset['repo'].replace('/', '--') + '/' + asset['revision'] + '/' + asset['file']
        target = checked_path(root, relative)
        if not target.exists():
            staging = checked_path(root, '.installing/sdcpp/' + asset['repo'].replace('/', '--') + '/' + asset['revision'])
            staging.mkdir(parents=True, exist_ok=True)
            if shutil.disk_usage(root).free < asset['size'] + 1024**3:
                raise ValueError('Insufficient disk space for ' + asset['file'])
            print(json.dumps({'model': name, 'file': asset['file'], 'status': 'downloading'}), flush=True)
            downloaded = Path(hf_hub_download(asset['repo'], asset['file'], revision=asset['revision'], local_dir=staging))
            verify(downloaded, asset)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(downloaded), target)
        else:
            verify(target, asset)
        files[role] = relative
        print(json.dumps({'model': name, 'file': asset['file'], 'status': 'verified'}), flush=True)
    directory.mkdir(parents=True, exist_ok=True)
    temporary = checked_path(root, 'sdcpp/' + name + '/installation-manifest.part')
    temporary.write_text(json.dumps({'id': name, 'spec': spec, 'files': files}, indent=2), encoding='utf-8')
    temporary.replace(manifest_path)
    print(json.dumps({'model': name, 'status': 'installed'}), flush=True)


def install_runtime(root, cache=None):
    spec = CATALOG['runtime']
    target = checked_path(root, 'runtimes/sd-cpp/' + spec['release'])
    cache = (cache or root / '.installing/sdcpp-runtime').resolve()
    cache.mkdir(parents=True, exist_ok=True)
    target.mkdir(parents=True, exist_ok=True)
    installed = {}
    for asset in spec['assets']:
        archive = checked_path(cache, asset['file'])
        if not archive.exists():
            if shutil.disk_usage(root).free < asset['size'] * 4:
                raise ValueError('Insufficient runtime installation disk space')
            part = archive.with_suffix('.part')
            with urllib.request.urlopen(asset['url'], timeout=60) as response, part.open('wb') as output:
                shutil.copyfileobj(response, output)
            verify(part, asset)
            part.replace(archive)
        verify(archive, asset)
        with zipfile.ZipFile(archive) as zipped:
            for item in zipped.infolist():
                destination = checked_path(target, item.filename)
                if item.is_dir():
                    destination.mkdir(parents=True, exist_ok=True)
                    continue
                if (item.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError('Runtime archive contains a symbolic link')
                # Compare before replacing existing files; never overwrite another runtime.
                data = zipped.read(item)
                digest = hashlib.sha256(data).hexdigest()
                if destination.exists():
                    verify(destination, {'size': len(data), 'sha256': digest})
                else:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    pending = checked_path(target, item.filename + '.part')
                    pending.write_bytes(data)
                    pending.replace(destination)
                installed[item.filename] = {'size': len(data), 'sha256': digest}
    manifest = checked_path(target, 'installation-manifest.json')
    pending = checked_path(target, 'installation-manifest.part')
    pending.write_text(json.dumps({'spec': spec, 'files': installed}, indent=2), encoding='utf-8')
    pending.replace(manifest)
    print(json.dumps({'runtime': spec['release'], 'status': 'installed'}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('models', nargs='*', choices=list(CATALOG['models']))
    parser.add_argument('--all', action='store_true')
    parser.add_argument('--runtime', action='store_true')
    parser.add_argument('--runtime-cache', type=Path)
    parser.add_argument('--models-dir', type=Path, default=Path(os.environ.get('LAW_MODELS_DIR') or ROOT / 'models'))
    args = parser.parse_args()
    root = args.models_dir.resolve(); root.mkdir(parents=True, exist_ok=True)
    if not args.models and not args.all and not args.runtime:
        parser.print_help(); return 0
    if args.runtime:
        install_runtime(root, args.runtime_cache)
    for name in CATALOG['models'] if args.all else args.models:
        install_model(name, root)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        # Remote exception strings can contain signed download URLs.
        print(json.dumps({'status': 'failed', 'error': type(error).__name__}), flush=True)
        raise SystemExit(1)
