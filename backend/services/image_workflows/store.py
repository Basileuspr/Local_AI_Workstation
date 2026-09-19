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
import warnings
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, UnidentifiedImageError
from pydantic import ValidationError

from config import settings
from .contracts import Asset, Draft, Snapshot, UpdateRequest, Workflow
from .planning import preflight

ROOT = settings.image_workflows_dir
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_IMAGE_PIXELS = 24_000_000
_lock = threading.RLock()


class NotFound(Exception):
    pass


class Conflict(Exception):
    pass


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _directory(workflow_id: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{32}", workflow_id):
        raise NotFound("Unknown workflow")
    return confined(ROOT / workflow_id)


def confined(path: Path) -> Path:
    """Refuse escaped paths and existing symlinks/junctions before any I/O."""
    root = ROOT.absolute()
    path = path.absolute()
    if not path.is_relative_to(root) or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("Workflow path escapes its owned directory")
    for part in [path, *path.parents]:
        if part.is_symlink() or (hasattr(part, "is_junction") and part.is_junction()):
            raise ValueError("Workflow paths cannot contain links or junctions")
        if part == root:
            break
    return path


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
    if ROOT.exists():
        paths = {path.parent / "workflow.json" for pattern in ("*/workflow.json", "*/deletion.json") for path in ROOT.glob(pattern)}
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
        _write(_directory(workflow.id) / "workflow.json", workflow.model_dump())
        return workflow


def update(workflow_id: str, request: UpdateRequest) -> Workflow:
    with _lock:
        current = get(workflow_id)
        _check_revision(current, request.revision)
        record = {**current.model_dump(), **request.model_dump(), "revision": current.revision + 1, "updated_at": _now()}
        workflow = Workflow.model_validate(record)
        _write(_directory(workflow_id) / "workflow.json", workflow.model_dump())
        return workflow


def _inspect_image(name: str, content: bytes) -> Asset:
    if not content or len(content) > MAX_UPLOAD_BYTES:
        raise ValueError("Upload a non-empty PNG, JPEG, or WebP image up to 20 MiB.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as image:
                formats = {"PNG": (".png", "image/png"), "JPEG": (".jpg", "image/jpeg"), "WEBP": (".webp", "image/webp")}
                if image.format not in formats or getattr(image, "n_frames", 1) != 1:
                    raise ValueError("Use a single-frame PNG, JPEG, or WebP image.")
                width, height = image.size
                if width * height > MAX_IMAGE_PIXELS:
                    raise ValueError("Image exceeds the 24 megapixel limit.")
                suffix, media_type = formats[image.format]
                image.verify()
            with Image.open(io.BytesIO(content)) as image:
                image.load()
                if image.getexif().get(274) in {5, 6, 7, 8}:
                    width, height = height, width
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ValueError("Could not decode this image. Use a valid PNG, JPEG, or WebP file.") from exc
    # Name is display-only; the hash and detected format define the actual path.
    name = name.replace("\\", "/").rsplit("/", 1)[-1][:160] or "image"
    return Asset(id=hashlib.sha256(content).hexdigest(), name=name, suffix=suffix, media_type=media_type, width=width, height=height, size_bytes=len(content), created_at=_now())


def add_asset(workflow_id: str, revision: int, name: str, content: bytes) -> Workflow:
    # Check existence before image decoding; repeat the revision check under the write lock.
    _check_revision(get(workflow_id), revision)
    asset = _inspect_image(name, content)
    with _lock:
        workflow = get(workflow_id)
        _check_revision(workflow, revision)
        if any(item.id == asset.id for item in workflow.assets):
            return workflow
        if len(workflow.assets) >= 100:
            raise ValueError("A workflow can hold at most 100 images.")
        _atomic_bytes(_directory(workflow_id) / "assets" / f"{asset.id}{asset.suffix}", content)
        workflow.assets.append(asset)
        workflow.revision += 1
        workflow.updated_at = _now()
        _write(_directory(workflow_id) / "workflow.json", workflow.model_dump())
        return workflow


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
