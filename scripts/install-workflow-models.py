"""Explicit, pinned and resumable workflow adapter installation; no image uploads."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from services.image_workflows.addon_models import asset_root, catalog, require_assets


def verify(path, spec):
    if path.stat().st_size != spec['size']:
        raise ValueError('Downloaded model size differs from the pinned catalog.')
    with path.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != spec['sha256']:
            raise ValueError('Downloaded model SHA-256 differs from the pinned catalog.')


def install(name, models_root):
    import requests
    spec = catalog()[name]
    target = asset_root(name, models_root)
    if (target / 'installation-manifest.json').exists():
        require_assets(name, models_root, verify_hashes=True)
        print(json.dumps({'model': name, 'status': 'verified_existing'}), flush=True)
        return
    target.mkdir(parents=True, exist_ok=True)
    remaining = sum(a['size'] for a in spec['files'] if not (target / a['file']).exists())
    if shutil.disk_usage(target).free < remaining + 1024 ** 3:
        raise ValueError('Not enough disk space for the selected assets plus 1 GiB headroom.')
    for asset in spec['files']:
        path = target / asset['file']
        if path.resolve() != path or not path.is_relative_to(target):
            raise ValueError('Model path escapes its installation folder.')
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            verify(path, asset)  # Never overwrite a different existing file.
            continue
        pending = path.with_name(path.name + '.pending')
        if pending.resolve() != pending:
            raise ValueError('Pending model file must not be a link.')
        offset = pending.stat().st_size if pending.exists() else 0
        if offset > asset['size']:
            raise ValueError('Oversized pending download was preserved for inspection.')
        if offset < asset['size']:
            print(json.dumps({'model': name, 'file': asset['file'], 'status': 'downloading', 'bytes': asset['size']}), flush=True)
            with requests.get(asset['url'], headers={'Range': f'bytes={offset}-'} if offset else {}, stream=True, timeout=(30, 120)) as response:
                if response.status_code not in (200, 206):
                    raise ValueError(f'Model download failed (HTTP {response.status_code}).')
                if response.status_code == 206 and not response.headers.get('Content-Range', '').startswith(f'bytes {offset}-'):
                    raise ValueError('Model download returned an unexpected byte range.')
                with pending.open('ab' if response.status_code == 206 else 'wb') as output:
                    for chunk in response.iter_content(1024 * 1024):
                        if output.tell() + len(chunk) > asset['size']:
                            raise ValueError('Model response exceeds the pinned size; partial download preserved.')
                        output.write(chunk)
        verify(pending, asset)
        pending.replace(path)
    receipt = target / 'installation-manifest.json'
    pending = receipt.with_suffix('.pending')
    if pending.resolve() != pending:
        raise ValueError('Pending installation receipt must not be a link.')
    pending.write_text(json.dumps({'spec': spec}, indent=2), encoding='utf-8')
    pending.replace(receipt)
    print(json.dumps({'model': name, 'status': 'installed_verified'}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('models', nargs='*', choices=list(catalog()))
    parser.add_argument('--all', action='store_true')
    parser.add_argument('--models-dir', type=Path, default=Path(os.environ.get('LAW_MODELS_DIR', ROOT / 'models')))
    args = parser.parse_args()
    names = list(catalog()) if args.all else args.models
    if not names:
        parser.error('Choose model names or --all.')
    for name in names:
        try:
            install(name, args.models_dir)
        except Exception as exc:
            # Requests errors may contain temporary access-bearing download URLs.
            print(json.dumps({'model': name, 'status': 'failed', 'error': str(exc) if isinstance(exc, ValueError) else type(exc).__name__}), flush=True)
            return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
