"""Owned assets and revision-checked drafts. No imports from runtime services.

The app serves one backend process. Its RLock serializes read/check/write units;
unique temporary files + replace keep readers from observing partial records.
Assets are intentionally independent of chat blobs and their deletion policy.
"""

import hashlib
import io
import json
import os
import re
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from pydantic import ValidationError

from config import settings
from services import storage_libraries as storage
from .contracts import Asset, Draft, Snapshot, UpdateRequest, Workflow
from .planning import preflight

ROOT = settings.image_workflows_dir
# Stage/export processing budgets; these do not restrict stored input files.
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_IMAGE_PIXELS = 24_000_000
_lock = threading.RLock()


class NotFound(Exception):
    pass


class Conflict(Exception):
    pass


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _directory(workflow_id: str, *, create=False) -> Path:
    if not re.fullmatch(r"[0-9a-f]{32}", workflow_id):
        raise NotFound("Unknown workflow")
    return confined(storage.resolve(ROOT / workflow_id, create=create))


def confined(path: Path) -> Path:
    """Refuse escaped paths and existing symlinks/junctions before any I/O."""
    return storage.confined(path, ROOT)


def _atomic_bytes(path: Path, content: bytes):
    path = confined(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".pending-", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _write(path: Path, record: dict):
    _atomic_bytes(path, json.dumps(record, indent=2, ensure_ascii=False, allow_nan=False).encode("utf-8"))


def get(workflow_id: str, *, allow_deleting=False) -> Workflow:
    path = confined(_directory(workflow_id) / "workflow.json")
    marker = confined(_directory(workflow_id) / "deletion.json")
    if marker.exists():
        if not allow_deleting: raise Conflict("Workflow deletion is incomplete. Retry Delete selected workflows to finish cleanup.")
        if not path.exists():
            try:
                record = json.loads(marker.read_bytes())
                return Workflow(id=workflow_id, name=record["name"], revision=record["revision"], created_at=record["created_at"], updated_at=record["created_at"])
            except (OSError, ValueError, KeyError) as exc:
                raise Conflict("Workflow cleanup record could not be read; files preserved.") from exc
    if not path.exists():
        raise NotFound("Workflow not found")
    try:
        record = Workflow.model_validate_json(path.read_bytes())
        if record.id != workflow_id:
            raise ValueError("Record ID mismatch")
        return record
    except (OSError, ValidationError, ValueError) as exc:
        raise Conflict("Workflow could not be read. Its file has been preserved; do not overwrite it.") from exc


def _check_revision(workflow: Workflow, revision: int):
    if workflow.revision != revision:
        raise Conflict("This workflow changed elsewhere. Reload it before saving or preparing again.")


def list_workflows():
    result, errors = [], []
    paths = {path.parent / "workflow.json" for pattern in ("*/workflow.json", "*/deletion.json") for path in storage.glob_paths(ROOT, pattern)}
    for path in paths:
        try:
            workflow = get(path.parent.name, allow_deleting=True)
            result.append({"id": workflow.id, "name": workflow.name, "revision": workflow.revision, "updated_at": workflow.updated_at,
                           "mode": workflow.mode, "deletion_pending": (path.parent / "deletion.json").exists()})
        except (Conflict, NotFound) as exc:
            errors.append(f"{path.parent.name}: {exc}")
    return {"workflows": sorted(result, key=lambda item: item["updated_at"], reverse=True), "warnings": errors}


def _create(draft: Draft, **extra) -> Workflow:
    now = _now()
    workflow = Workflow(**draft.model_dump(), id=uuid.uuid4().hex, revision=1, created_at=now, updated_at=now, **extra)
    return workflow


def create(name: str, mode="stages") -> Workflow:
    with _lock:
        workflow = _create(Draft(name=name, mode=mode))
        _write(_directory(workflow.id, create=True) / "workflow.json", workflow.model_dump())
        return workflow


def update(workflow_id: str, request: UpdateRequest) -> Workflow:
    with _lock:
        current = get(workflow_id)
        _check_revision(current, request.revision)
        record = {**current.model_dump(), **request.model_dump(), "revision": current.revision + 1, "updated_at": _now()}
        workflow = Workflow.model_validate(record)
        _write(_directory(workflow_id) / "workflow.json", workflow.model_dump())
        return workflow


def _inspect_file(name, path):
    from services.image_library import inspect_file
    from services.image_manager_metadata import open_local_image
    metadata = inspect_file(path, name)
    formats = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp'}
    if metadata['type'] not in formats:
        raise ValueError('Use a single-frame PNG, JPEG, or WebP image.')
    width, height = metadata['width'], metadata['height']
    with open_local_image(path) as image:
        if image.getexif().get(274) in {5, 6, 7, 8}: width, height = height, width
    name = name.replace(chr(92), '/').rsplit('/', 1)[-1][:160] or 'image'
    return Asset(id=metadata['sha256'], name=name, suffix=formats[metadata['type']], media_type=metadata['type'],
                 width=width, height=height, size_bytes=metadata['size'], created_at=_now())


def _inspect_image(name: str, content: bytes) -> Asset:
    with tempfile.TemporaryDirectory(prefix='law-workflow-image-') as temporary:
        path = Path(temporary) / 'source'
        path.write_bytes(content)
        return _inspect_file(name, path)


def add_asset(workflow_id: str, revision: int, name: str, content: bytes) -> Workflow:
    return add_asset_stream(workflow_id, revision, name, io.BytesIO(content))


def add_asset_stream(workflow_id, revision, name, stream, origin=None):
    import shutil
    from services.image_vault import require_public
    _check_revision(get(workflow_id), revision)
    directory = confined(_directory(workflow_id) / 'assets')
    directory.mkdir(exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=directory, prefix='.pending-', delete=False) as output:
            temporary = Path(output.name)
            shutil.copyfileobj(stream, output, 1024 * 1024)
            output.flush()
            os.fsync(output.fileno())
        asset = _inspect_file(name, temporary)
        require_public(asset.id)
        asset.origin = origin or {}
        with _lock:
            workflow = get(workflow_id)
            _check_revision(workflow, revision)
            if any(item.id == asset.id for item in workflow.assets): return workflow
            if len(workflow.assets) >= 100: raise ValueError('A workflow can hold at most 100 images.')
            target = confined(directory / f'{asset.id}{asset.suffix}')
            temporary.replace(target)
            workflow.assets.append(asset)
            workflow.revision += 1
            workflow.updated_at = _now()
            try: _write(_directory(workflow_id) / 'workflow.json', workflow.model_dump())
            except BaseException:
                target.unlink(missing_ok=True)
                raise
            return workflow
    finally:
        if temporary is not None: temporary.unlink(missing_ok=True)


def asset_path(workflow_id: str, asset_id: str):
    workflow = get(workflow_id)
    asset = next((item for item in workflow.assets if item.id == asset_id), None)
    if asset is None:
        raise NotFound("Asset is not owned by this workflow")
    path = confined(_directory(workflow_id) / "assets" / f"{asset.id}{asset.suffix}")
    if not path.is_file():
        raise NotFound("Stored image file is missing")
    from services.image_vault import guard_path
    guard_path(path)
    return path, asset


def _report(workflow: Workflow):
    report = preflight(workflow)
    for asset in workflow.assets:
        path = _directory(workflow.id) / "assets" / f"{asset.id}{asset.suffix}"
        if not path.is_file():
            report["issues"].append({"code": "asset_missing", "stage_id": None, "message": f"Stored file is missing: {asset.name}"})
            report["inputs_valid"] = False
            report["ready"] = False
    return report


def validate(workflow_id: str, revision: int):
    with _lock:
        workflow = get(workflow_id)
        _check_revision(workflow, revision)
        return _report(workflow)


def prepare(workflow_id: str, revision: int, reporter=None):
    with _lock:
        workflow = get(workflow_id)
        _check_revision(workflow, revision)
        job_id = uuid.uuid4().hex
        report = reporter(workflow) if reporter else _report(workflow)
        job = {
            "schema_version": 1, "id": job_id, "workflow_id": workflow_id,
            "created_at": _now(), "status": "prepared" if report["ready"] else "blocked", "snapshot": workflow.model_dump(),
            "preflight": report, "outputs": [],
            "paths": {"outputs": f"jobs/{job_id}/outputs", "artifacts": f"jobs/{job_id}/artifacts"},
        }
        Snapshot.model_validate(job)
        _write(_directory(workflow_id) / "jobs" / job_id / "job.json", job)
        return job


def get_job(workflow_id: str, job_id: str, *, allow_deleting=False):
    get(workflow_id, allow_deleting=allow_deleting)
    if not re.fullmatch(r"[0-9a-f]{32}", job_id):
        raise NotFound("Unknown snapshot")
    path = confined(_directory(workflow_id) / "jobs" / job_id / "job.json")
    if not path.exists():
        raise NotFound("Snapshot not found")
    try:
        job = json.loads(path.read_bytes())
        Snapshot.model_validate(job)
        if job["id"] != job_id or job["workflow_id"] != workflow_id:
            raise ValueError("Invalid snapshot")
        return job
    except (OSError, ValueError) as exc:
        raise Conflict("Snapshot could not be read; file preserved.") from exc


def list_jobs(workflow_id: str):
    get(workflow_id)
    jobs = []
    for path in (_directory(workflow_id) / "jobs").glob("*/job.json"):
        job = get_job(workflow_id, path.parent.name)
        jobs.append({"id": job["id"], "created_at": job["created_at"], "status": job["status"], "revision": job["snapshot"]["revision"]})
    return sorted(jobs, key=lambda item: item["created_at"], reverse=True)


def branch(workflow_id: str, revision: int):
    with _lock:
        parent = get(workflow_id)
        _check_revision(parent, revision)
        draft = Draft(**{key: parent.model_dump()[key] for key in Draft.model_fields})
        draft.name = f"Next scene - {parent.name}"[:120]
        child = _create(draft, assets=parent.assets, parent={"workflow_id": parent.id, "revision": parent.revision})
        for asset in child.assets:
            source, _ = asset_path(parent.id, asset.id)
            _atomic_bytes(_directory(child.id) / "assets" / source.name, source.read_bytes())
        # Publish the workflow only after all reference bytes are safely copied.
        _write(_directory(child.id) / "workflow.json", child.model_dump())
        return child
