"""Pinned optional assets. Discovery only reads receipts and file sizes."""
import hashlib
import importlib.util
import json
from pathlib import Path

CATALOG_PATH = Path(__file__).resolve().parents[3] / 'scripts' / 'workflow-model-catalog.json'


def catalog():
    return json.loads(CATALOG_PATH.read_text(encoding='utf-8'))


def asset_root(name, models_root=None):
    if models_root is None:
        from config import settings
        models_root = settings.models_dir
    root = Path(models_root).resolve()
    if name not in catalog():
        raise ValueError('Unknown workflow model.')
    target = root / 'workflow-addons' / name
    if target.resolve() != target or not target.is_relative_to(root):
        raise ValueError('Workflow model folder must not traverse links.')
    return target


def require_assets(name, models_root=None, *, verify_hashes=False):
    spec = catalog()[name]
    root = asset_root(name, models_root)
    try:
        receipt_path = root / 'installation-manifest.json'
        if receipt_path.resolve() != receipt_path:
            raise ValueError('Workflow model receipt must not be a link.')
        receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
        if receipt.get('spec') != spec:
            raise ValueError('Workflow model receipt differs from the pinned catalog.')
        for asset in spec['files']:
            path = root / asset['file']
            if path.resolve() != path or not path.is_relative_to(root) or path.stat().st_size != asset['size']:
                raise ValueError('Workflow model files are incomplete or linked.')
            if verify_hashes:
                with path.open('rb') as stream:
                    if hashlib.file_digest(stream, 'sha256').hexdigest() != asset['sha256']:
                        raise ValueError('Workflow model integrity check failed.')
        return root
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError(f'Install {name} with scripts/install-workflow-models.py.') from exc


def readiness(name, packages=()):
    missing = [package for package in packages if importlib.util.find_spec(package) is None]
    if missing:
        return False, 'Install requirements-workflows.txt; missing: ' + ', '.join(missing)
    try:
        require_assets(name)
        return True, None
    except ValueError as exc:
        return False, str(exc)
