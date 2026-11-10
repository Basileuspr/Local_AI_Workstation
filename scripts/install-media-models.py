"""Install pinned local Qwen/Wan models and the Windows CUDA sd.cpp runtime."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import struct
import urllib.request
import zipfile

# These public, pinned downloads do not need account credentials or telemetry.
os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
os.environ.setdefault('HF_HUB_DISABLE_IMPLICIT_TOKEN', '1')

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


def prepare_model_file(source, root, asset, rule):
    """Rename only SafeTensors header keys; preserve the pinned original and payload."""
    preparation = rule['operation']
    if preparation != 'strip-diffusion-prefix-v1':
        raise ValueError('Unknown model preparation')
    relative = 'sdcpp/prepared/' + asset['sha256'] + '/' + preparation + '.safetensors'
    target = checked_path(root, relative)
    identity = {'path': relative, 'source_sha256': asset['sha256'], 'preparation': preparation}
    if target.exists():
        verify(target, rule)
        return dict(identity, size=rule['size'], sha256=rule['sha256'])
    if shutil.disk_usage(root).free < asset['size'] + 1024**3:
        raise ValueError('Insufficient disk space for the compatible model copy')
    target.parent.mkdir(parents=True, exist_ok=True)
    pending = checked_path(root, relative + '.part')
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate SafeTensors header key')
            result[key] = value
        return result
    try:
        with source.open('rb') as stream:
            prefix = stream.read(8)
            if len(prefix) != 8:
                raise ValueError('Truncated SafeTensors header')
            length = struct.unpack('<Q', prefix)[0]
            if not 2 <= length <= min(16 * 1024**2, asset['size'] - 8):
                raise ValueError('Invalid SafeTensors header length')
            original = stream.read(length)
            header = json.loads(original, object_pairs_hook=unique_object)
            if not isinstance(header, dict) or not any(key != '__metadata__' for key in header):
                raise ValueError('Invalid SafeTensors header')
            renamed = {}
            remove = 'model.diffusion_model.'
            for key, value in header.items():
                # This publisher bundles VAE tensors in both expert checkpoints.
                # Leave them unchanged; the explicitly selected standalone VAE is used.
                if key != '__metadata__' and not key.startswith('vae.'):
                    if not key.startswith(remove) or key == remove:
                        raise ValueError('Unexpected SafeTensors tensor prefix')
                    key = key[len(remove):]
                if key in renamed:
                    raise ValueError('Conflicting SafeTensors tensor names')
                renamed[key] = value
            encoded = json.dumps(renamed, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode('utf-8')
            encoded += b' ' * (-len(encoded) % 8)
            source_hash = hashlib.sha256(prefix + original)
            output_hash = hashlib.sha256()
            with pending.open('wb') as output:
                new_header = struct.pack('<Q', len(encoded)) + encoded
                output.write(new_header); output_hash.update(new_header)
                for chunk in iter(lambda: stream.read(1024**2), b''):
                    source_hash.update(chunk); output_hash.update(chunk); output.write(chunk)
        if source_hash.hexdigest() != asset['sha256']:
            raise ValueError('Source SHA-256 changed during model preparation')
        receipt = dict(identity, size=pending.stat().st_size, sha256=output_hash.hexdigest())
        verify(pending, rule)
        if target.exists():
            verify(target, receipt)
        else:
            pending.replace(target)
        return receipt
    finally:
        pending.unlink(missing_ok=True)


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
        if previous.get('spec', {}).get('files') != spec['files']:
            raise ValueError('Preserving a different model revision: ' + name)
    files = {}; prepared = {}
    for role, asset in spec['files'].items():
        relative = 'sdcpp/shared/' + asset['repo'].replace('/', '--') + '/' + asset['revision'] + '/' + asset['file']
        target = checked_path(root, relative)
        if not target.exists():
            staging = checked_path(root, '.installing/sdcpp/' + asset['repo'].replace('/', '--') + '/' + asset['revision'])
            staging.mkdir(parents=True, exist_ok=True)
            if shutil.disk_usage(root).free < asset['size'] + 1024**3:
                raise ValueError('Insufficient disk space for ' + asset['file'])
            print(json.dumps({'model': name, 'file': asset['file'], 'status': 'downloading'}), flush=True)
            downloaded = Path(hf_hub_download(asset['repo'], asset['file'], revision=asset['revision'], local_dir=staging, token=False))
            verify(downloaded, asset)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(downloaded), target)
        else:
            verify(target, asset)
        files[role] = relative
        print(json.dumps({'model': name, 'file': asset['file'], 'status': 'verified'}), flush=True)
        preparation = CATALOG.get('preparations', {}).get(name, {}).get(role)
        if preparation:
            prepared[role] = prepare_model_file(target, root, asset, preparation)
            print(json.dumps({'model': name, 'file': asset['file'], 'status': 'prepared'}), flush=True)
    directory.mkdir(parents=True, exist_ok=True)
    temporary = checked_path(root, 'sdcpp/' + name + '/installation-manifest.part')
    temporary.write_text(json.dumps({'id': name, 'spec': spec, 'files': files, 'prepared_files': prepared}, indent=2), encoding='utf-8')
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
    parser.add_argument('--models-dir', type=Path, default=Path(os.environ.get('LAW_MEDIA_MODELS_DIR') or os.environ.get('LAW_MODELS_DIR') or ROOT / 'models'))
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
